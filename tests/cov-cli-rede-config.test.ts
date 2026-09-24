/**
 * Suíte: os comandos de `src/cli.ts` que configuram a máquina antes de
 * qualquer outra coisa — `fx refresh`, `fx show`, `db migrate`, `db check` e o
 * `db seed` no caminho em que a conta do dono realmente nasce.
 *
 * ## Por que estes três grupos moram juntos
 *
 * Todos são pré-requisito de outra coisa, e todos falham de um jeito que só
 * aparece depois. Cotação ausente não quebra `jobs score`: ela faz toda vaga em
 * EUR ou BRL entrar no ranking com a nota de compensação errada. Violação de
 * chave estrangeira não quebra consulta nenhuma: ela some com a linha filha na
 * próxima leitura com `join`. E um `db seed` que engole a criação da conta
 * deixa o sistema instalado e inacessível.
 *
 * ## Rede
 *
 * `fx refresh` fala com dois provedores públicos (Frankfurter/BCE e
 * open.er-api) pela porta HTTP do projeto, então `setHttpPort(fixtureHttp(…))`
 * é suficiente — nenhum socket é aberto. A cadeia de fallback é justamente o
 * que precisa de teste: ela existe porque um dos dois vai estar fora do ar
 * algum dia, e nesse dia ninguém vai estar olhando.
 *
 * Fronteira DENTRO: flags, escolha de provedor, mensagem de falha, o que é
 * gravado e o código de saída.
 * Fronteira FORA: o formato de cada provedor (`cov-*`/`fx-context`) e a
 * matemática de conversão.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authUser, candidate, positioningTask, skill } from "../src/core/db/schema.ts";
import { fixtureHttp, resetHttpPort, setHttpPort } from "../src/core/sources/http-port.ts";
import "../src/core/sources/http.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { banco, carregarCli, rodar } from "./cov-cli-harness.ts";

vi.mock("commander", async () => (await import("./cov-cli-harness.ts")).commanderMock());

const EMAIL = "dona@exemplo.test";

let emailOriginal: string | undefined;

beforeAll(async () => {
  emailOriginal = process.env.JHO_CANDIDATE_EMAIL;
  // Este arquivo é o oposto de `cov-cli-ingestao`: lá o cenário é o clone SEM
  // `.env`, aqui é a máquina configurada. `loadProfile` guarda o perfil
  // expandido em cache no primeiro uso, então a variável precisa existir antes
  // de qualquer carga — depois disso não haveria como mudá-la.
  process.env.JHO_CANDIDATE_EMAIL = EMAIL;
  await carregarCli();
});

afterAll(async () => {
  if (emailOriginal === undefined) delete process.env.JHO_CANDIDATE_EMAIL;
  else process.env.JHO_CANDIDATE_EMAIL = emailOriginal;
});

beforeEach(async () => {
  await useTestDb();
});

afterEach(async () => {
  resetHttpPort();
  await releaseTestDb();
});

const COTACAO_FRANKFURTER = {
  amount: 1,
  base: "USD",
  date: "2026-08-17",
  rates: { BRL: 5.4123, EUR: 0.9187 },
};

/* ----------------------------------- fx ----------------------------------- */

describe("jho fx refresh", () => {
  it("busca no provedor preferido e diz de onde veio a cotação", async () => {
    setHttpPort(fixtureHttp({ "api.frankfurter.dev": COTACAO_FRANKFURTER }));

    const r = await rodar("fx", "refresh");

    expect(r.code).toBeUndefined();
    // Dizer o provedor não é vaidade: quando duas execuções discordam do valor,
    // a primeira pergunta é qual das duas fontes respondeu.
    expect(r.out).toContain("2 cotações de 2026-08-17");
    expect(r.out).toContain("base USD, via frankfurter");
    expect(r.out).toContain("BRL EUR");
  });

  it("`--base` é normalizado para maiúsculas — ninguém digita moeda gritando", async () => {
    setHttpPort(
      fixtureHttp({
        "api.frankfurter.dev": { amount: 1, base: "EUR", date: "2026-08-17", rates: { USD: 1.09 } },
      }),
    );

    const r = await rodar("fx", "refresh", "--base", "eur");

    expect(r.out).toContain("base EUR");
  });

  it("cai para o segundo provedor quando o primeiro não responde", async () => {
    // Sem fixture para o Frankfurter: é o que um provedor fora do ar produz.
    setHttpPort(
      fixtureHttp({
        "open.er-api.com": {
          result: "success",
          base_code: "USD",
          time_last_update_utc: "Mon, 17 Aug 2026 00:00:01 +0000",
          rates: { BRL: 5.41, EUR: 0.92, GBP: 0.78 },
        },
      }),
    );

    const r = await rodar("fx", "refresh");

    // A cadeia existe porque um dos dois vai estar fora do ar algum dia, e
    // nesse dia ninguém está olhando. Ela só vale se for exercitada.
    expect(r.code).toBeUndefined();
    expect(r.out).toContain("via erapi");
    expect(r.out).toContain("3 cotações");
  });

  it("resposta sem cotação válida é tratada como falha, não gravada como tabela vazia", async () => {
    setHttpPort(
      fixtureHttp({
        // Zero e infinito são filtrados: dividir por eles seria pior que não ter.
        "api.frankfurter.dev": { amount: 1, base: "USD", date: "2026-08-17", rates: { BRL: 0 } },
        "open.er-api.com": { result: "error", base_code: "USD", rates: {} },
      }),
    );

    const r = await rodar("fx", "refresh");

    // A mensagem soma os dois motivos porque diagnosticar isto sem eles seria
    // adivinhar qual dos provedores está mal.
    const mensagem = (r.erro as Error).message;
    expect(mensagem).toContain("Não foi possível obter cotações");
    expect(mensagem).toContain("frankfurter: resposta sem cotações válidas");
    expect(mensagem).toContain("erapi: er-api returned error");
    const semCotacao = await rodar("fx", "show");
    expect(semCotacao.out).toContain("Nenhuma cotação em cache");
  });
});

describe("jho fx show", () => {
  it("sem cache, manda buscar em vez de imprimir uma tabela vazia", async () => {
    const r = await rodar("fx", "show");

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("Nenhuma cotação em cache");
    expect(r.out).toContain("jho fx refresh");
  });

  it("mostra a tabela em ordem alfabética, com quatro casas", async () => {
    setHttpPort(fixtureHttp({ "api.frankfurter.dev": COTACAO_FRANKFURTER }));
    await rodar("fx", "refresh");

    const r = await rodar("fx", "show");

    expect(r.out).toContain("Base USD · cotação de 2026-08-17");
    expect(r.out).toContain("1 USD =");
    // Quatro casas porque duas arredondam BRL o suficiente para mover uma vaga
    // de faixa; a ordem alfabética é para achar a moeda sem ler tudo.
    expect(r.out).toContain("5.4123 BRL");
    expect(r.out.indexOf("BRL")).toBeLessThan(r.out.indexOf("EUR"));
  });

  it("cotação velha aparece com a idade e um pedido explícito de atualização", async () => {
    setHttpPort(
      fixtureHttp({
        "api.frankfurter.dev": { amount: 1, base: "USD", date: "2020-01-02", rates: { BRL: 4.02 } },
      }),
    );
    await rodar("fx", "refresh");

    const r = await rodar("fx", "show");

    // Uma cotação de 2020 usada em silêncio é pior que nenhuma: ela produz um
    // número plausível e errado, e nada na tela denuncia isso.
    expect(r.out).toMatch(/2020-01-02 \(\d+d\)/);
    expect(r.out).toContain("Cotações com mais de 7 dias");
  });
});

/* ----------------------------------- db ----------------------------------- */

describe("jho db migrate", () => {
  it("cria o esquema do zero e continua válido ao repetir", async () => {
    const primeira = await rodar("db", "migrate");
    const segunda = await rodar("db", "migrate");

    // É o primeiro comando que alguém roda, e o segundo que roda por engano.
    // Falhar na segunda vez transformaria a instalação em passo com estado.
    expect(primeira.code).toBeUndefined();
    expect(segunda.code).toBeUndefined();
    expect(segunda.out).toContain("schema is up to date");
    expect(segunda.out).not.toContain("aplicadas:");
  });

  it("--additive-only aplica uma aditiva pendente e diz qual", async () => {
    await rodar("db", "migrate");
    // A CLI lê `./drizzle/postgres`; uma cópia com uma migração sintética no
    // fim do journal simula o próximo push sem desfazer objeto real.
    const raiz = mkdtempSync(join(tmpdir(), "master-jobs-cli-migrate-"));
    const pasta = join(raiz, "drizzle", "postgres");
    cpSync("./drizzle/postgres", pasta, { recursive: true });
    const caminho = join(pasta, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(caminho, "utf8")) as { entries: Array<{ idx: number; when: number; tag: string }> };
    const ultima = journal.entries.at(-1)!;
    journal.entries.push({ ...ultima, idx: ultima.idx + 1, when: ultima.when + 1000, tag: "9999_cli_aditiva" });
    writeFileSync(caminho, JSON.stringify(journal));
    writeFileSync(join(pasta, "9999_cli_aditiva.sql"), 'CREATE TABLE "production"."cli_aditiva" ("id" integer);');
    const original = process.cwd();
    process.chdir(raiz);
    try {
      const aditiva = await rodar("db", "migrate", "--additive-only");
      expect(aditiva.code).toBeUndefined();
      expect(aditiva.out).toContain("aplicadas: 9999_cli_aditiva");
      expect(aditiva.out).toContain("schema is up to date");
    } finally {
      process.chdir(original);
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  it("--additive-only recusa lote não aditivo sem aplicar nada, e passa quando nada falta", async () => {
    await rodar("db", "migrate");
    // Recria a pendência só na tabela de controle: a 0014 reescreve dado. A
    // recusa vem antes de qualquer DDL, então os objetos já criados não
    // atrapalham, e devolver as linhas restaura o estado — sem depender de
    // qual é a última migração do repositório.
    const removidas = await banco().execute(sql.raw(
      "delete from drizzle.__drizzle_migrations where id >= 15 returning id, hash, created_at",
    ));
    const recusa = await rodar("db", "migrate", "--additive-only");
    expect(recusa.code).toBe(1);
    expect(recusa.err).toContain("exige execução manual");
    expect(recusa.err).toContain("0014_clear_contact_candidate_names: reescreve ou apaga dado");
    const [depois] = await banco().execute(sql.raw("select count(*)::int as n from drizzle.__drizzle_migrations"));
    expect(depois!.n).toBe(14);

    for (const linha of removidas) {
      await banco().execute(sql`insert into drizzle.__drizzle_migrations (id, hash, created_at) values (${linha.id}, ${linha.hash}, ${linha.created_at})`);
    }
    const emDia = await rodar("db", "migrate", "--additive-only");
    expect(emDia.code).toBeUndefined();
    expect(emDia.out).toContain("schema is up to date");
    expect(emDia.out).not.toContain("aplicadas:");
  });
});

describe("jho db check", () => {
  it("aponta a violação de chave estrangeira e sai com 1", async () => {
    const db = banco();
    // Só dá para criar a violação com a checagem desligada — que é exatamente
    // como ela nasce de verdade: por migração aplicada com o pragma em off, ou
    // por um cliente que nunca o ligou.
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
    await tx.execute(
      sql.raw(
        "insert into production.auth_session (token_hash, user_id, expires_at) " +
        "values ('orfa', 999999, '2030-01-01T00:00:00.000Z')",
      ),
    );
    });

    const r = await rodar("db", "check");

    // Código 1 é o que faz este comando servir num gancho de CI: silêncio verde
    // seria a única coisa pior que a violação em si.
    expect(r.code).toBe(1);
    expect(r.err).toContain("1 violação(ões) de foreign key");
    expect(r.err).toContain("auth_session");
    // A sessão órfã vem com o conserto ao lado, porque a migração 0014 já sabe
    // limpá-la — não é um diagnóstico sem saída.
    expect(r.err).toContain("sessão(ões) órfã(s)");
    expect(r.err).toContain("jho db migrate");
  });
});

describe("jho db seed", () => {
  it("cria a conta do dono e mostra a senha uma única vez", async () => {
    const r = await rodar("db", "seed");

    expect(r.code).toBeUndefined();
    expect(r.out).toContain(`conta ${EMAIL}`);
    expect(r.out).toContain("anote, aparece só aqui");
    const [conta] = await banco().select().from(authUser);
    // Quem instala é as duas coisas: administra e é o candidato.
    expect(conta?.email).toBe(EMAIL);
    expect(conta?.roles).toEqual(["admin", "candidate"]);
    expect(conta?.passwordHash).toMatch(/^scrypt\$/);
    // A senha aparece no terminal e em lugar nenhum mais: o banco guarda o
    // hash, e é ele que viaja no backup.
    expect(conta?.passwordHash).not.toContain(r.out.trim());
  });

  it("semeia o resto no mesmo comando: candidato, catálogo, provedores e plano", async () => {
    const r = await rodar("db", "seed");

    expect(r.out).toContain("catálogo de skills");
    expect(r.out).toContain("provedor(es) de LLM");
    expect(r.out).toContain("posicionamento");
    expect((await banco().select().from(candidate)).length).toBeGreaterThan(0);
    expect((await banco().select().from(skill)).length).toBeGreaterThan(0);
    expect((await banco().select().from(positioningTask)).length).toBeGreaterThan(0);
  });

  it("rodar de novo preserva a senha de quem já está usando o sistema", async () => {
    await rodar("db", "seed");
    const [antes] = await banco().select().from(authUser);

    const r = await rodar("db", "seed");

    expect(r.out).toContain("senha preservada");
    const [depois] = await banco().select().from(authUser);
    // Semear não é derrubar: trocar a senha num segundo `db seed` tiraria a
    // pessoa de dentro do próprio sistema, e o comando é feito para repetir.
    expect(depois?.passwordHash).toBe(antes?.passwordHash);
  });

  it("`--skip-auth` semeia o resto sem tocar em conta nenhuma", async () => {
    const r = await rodar("db", "seed", "--skip-auth");

    expect(r.code).toBeUndefined();
    expect(r.out).not.toContain("conta");
    expect(await banco().select().from(authUser)).toHaveLength(0);
    expect((await banco().select().from(skill)).length).toBeGreaterThan(0);
  });
});
