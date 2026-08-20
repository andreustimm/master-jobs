/**
 * Suíte: os últimos comandos de `src/cli.ts` que gravam sem precisar de rede —
 * `db migrate`, `jobs score`, `auth seed`, `skills detect`, `scrape queue` e
 * `mail import`.
 *
 * ## Por que fecham o corte do E-08
 *
 * A meta escrita no item é "nenhum comando que grava esteja sem uma passada".
 * Os arquivos `cov-cli-funil`, `cov-cli-acervo`, `cov-cli-candidato` e
 * `cov-cli-posicionamento` cobrem o resto; aqui ficam os que sobraram porque
 * cada um depende de um pré-requisito diferente (banco migrado, currículo
 * salvo, diretório de `.eml`) e agrupá-los com os outros embaralharia o
 * cenário de quem lê.
 *
 * ## O que estes casos observam, e o que ignoram
 *
 * `mail import` e `skills detect` têm suíte de domínio exaustiva em
 * `cov-mail-run` e `cov-skills-*`. O que se confere aqui é só o que pertence à
 * CLI: que `--dry-run` interrompe antes da escrita, que o comando sem
 * pré-requisito orienta em vez de estourar, e que a contagem impressa é a
 * contagem real. Nada de reencenar classificação de e-mail nem extração de
 * skill.
 *
 * Fronteira DENTRO: pré-requisitos, flags, ordem dos efeitos, persistência.
 * Fronteira FORA: rede — `mail auth`, `mail fetch`, `jobs sync`, `jobs verify`,
 * `scrape run`, `fx refresh` e `analyze` só chegam à escrita depois de um
 * socket, e ficam com as suítes que já dublam a porta HTTP.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { saveDocument, syncCandidateFromProfile } from "../src/core/candidate.ts";
import {
  authUser,
  candidateSkill,
  job,
  jobScore,
  mailMessage,
  scrapeTask,
  source,
} from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { banco, carregarCli, rodar } from "./cov-cli-harness.ts";

vi.mock("commander", async () => (await import("./cov-cli-harness.ts")).commanderMock());

let emailOriginal: string | undefined;

beforeAll(async () => {
  // `loadProfile` guarda o perfil expandido em cache no primeiro uso, então a
  // variável precisa sumir ANTES de qualquer carga para o cenário ser o mesmo
  // em qualquer máquina: clone sem `.env`, que é onde `auth seed` sem
  // argumento tem de recusar em vez de criar conta com e-mail vazio.
  emailOriginal = process.env.JHO_CANDIDATE_EMAIL;
  delete process.env.JHO_CANDIDATE_EMAIL;
  await carregarCli();
});

afterAll(() => {
  if (emailOriginal !== undefined) process.env.JHO_CANDIDATE_EMAIL = emailOriginal;
});

beforeEach(async () => {
  await useTestDb();
});

afterEach(() => {
  releaseTestDb();
});

/** Vaga sem descrição: é a que interessa ao robô de raspagem. */
async function semearVaga(externalId = "v1"): Promise<number> {
  const db = banco();
  await db
    .insert(source)
    .values({ id: "manual:teste", kind: "manual", handle: "teste", label: "Teste" })
    .onConflictDoNothing();
  const [linha] = await db
    .insert(job)
    .values({
      fingerprint: `fp-${externalId}`,
      contentHash: `hash-${externalId}`,
      sourceId: "manual:teste",
      externalId,
      companyName: "Acme",
      title: "Senior AI Software Architect",
      url: `https://exemplo.test/${externalId}`,
      postedAt: new Date().toISOString(),
      raw: {},
    })
    .returning({ id: job.id });
  return linha!.id;
}

describe("jho db migrate", () => {
  it("é seguro rodar sobre um banco já migrado", async () => {
    const r = await rodar("db", "migrate");

    // O comando é o primeiro que qualquer pessoa roda, e o segundo que ela roda
    // por engano. Falhar na segunda vez transformaria o passo de instalação em
    // passo com estado.
    expect(r.code).toBeUndefined();
    expect(r.out).toContain("schema is up to date");
  });
});

describe("jho db check", () => {
  it("dá o verde quando não há órfão nem violação de chave estrangeira", async () => {
    const r = await rodar("db", "check");

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("foreign keys íntegros");
  });
});

describe("jho jobs score", () => {
  it("pontua o que ainda não tem nota e imprime o melhor fit", async () => {
    const candidatoId = await syncCandidateFromProfile();
    await semearVaga();

    const r = await rodar("jobs", "score");

    expect(r.code).toBeUndefined();
    expect(r.out).toMatch(/scored 1 job\(s\)/);
    const notas = await banco()
      .select()
      .from(jobScore)
      .where(eq(jobScore.candidateId, candidatoId));
    expect(notas).toHaveLength(1);
  });

  it("sem `--all` não repontua o que já tem nota; com `--all`, repontua", async () => {
    await syncCandidateFromProfile();
    await semearVaga();
    await rodar("jobs", "score");

    const semAll = await rodar("jobs", "score");
    const comAll = await rodar("jobs", "score", "--all");

    // A distinção é o que torna o comando barato no uso diário: sem `--all` ele
    // toca só o que entrou desde a última passada.
    expect(semAll.out).toMatch(/scored 0 job\(s\)/);
    expect(comAll.out).toMatch(/scored 1 job\(s\)/);
  });

  it("exige candidato cadastrado", async () => {
    await semearVaga();

    const r = await rodar("jobs", "score");

    expect((r.erro as Error).message).toContain("jho db seed");
  });
});

describe("jho auth seed [email]", () => {
  it("cria a conta do dono com os dois papéis e mostra a senha uma vez", async () => {
    const r = await rodar("auth", "seed", "dono@exemplo.test", "--password", "senha-bem-longa-2026");

    expect(r.code).toBeUndefined();
    const [conta] = await banco().select().from(authUser);
    // Quem instala é as duas coisas: administra e é o candidato.
    expect(conta?.roles).toEqual(["admin", "candidate"]);
    expect(conta?.passwordHash).toMatch(/^scrypt\$/);
    // Senha vinda por `--password` não é reimpressa: quem a escolheu já a tem,
    // e ecoá-la só a copiaria para mais um lugar.
    expect(r.out).not.toContain("senha-bem-longa-2026");
  });

  it("rodar de novo preserva a senha e diz como trocá-la", async () => {
    await rodar("auth", "seed", "dono@exemplo.test", "--password", "senha-bem-longa-2026");
    const [antes] = await banco().select().from(authUser);

    const r = await rodar("auth", "seed", "dono@exemplo.test");

    expect(r.out).toContain("senha atual foi preservada");
    const [depois] = await banco().select().from(authUser);
    // Semear não é derrubar: trocar a senha de quem já usa o sistema por causa
    // de um segundo `db seed` tiraria a pessoa de dentro do próprio sistema.
    expect(depois?.passwordHash).toBe(antes?.passwordHash);
  });

  it("`--force` redefine a senha de propósito", async () => {
    await rodar("auth", "seed", "dono@exemplo.test", "--password", "senha-bem-longa-2026");
    const [antes] = await banco().select().from(authUser);

    const r = await rodar(
      "auth", "seed", "dono@exemplo.test", "--password", "outra-senha-bem-longa", "--force",
    );

    expect(r.code).toBeUndefined();
    const [depois] = await banco().select().from(authUser);
    expect(depois?.passwordHash).not.toBe(antes?.passwordHash);
  });

  it("sem e-mail no argumento nem no perfil, sai com código 1 e diz o que fazer", async () => {
    const r = await rodar("auth", "seed");

    // Criar conta com e-mail vazio seria pior que recusar: o índice único
    // aceitaria uma linha `""`, e a próxima tentativa colidiria com ela.
    expect(r.code).toBe(1);
    expect(r.err).toContain("jho auth seed <email>");
    expect(await banco().select().from(authUser)).toHaveLength(0);
  });
});

describe("jho skills detect", () => {
  it("orienta em vez de estourar quando não há currículo salvo", async () => {
    await syncCandidateFromProfile();

    const r = await rodar("skills", "detect");

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("jho cv set");
    expect(await banco().select().from(candidateSkill)).toHaveLength(0);
  });

  it("detecta a partir do currículo salvo e grava como `detected`, nunca confirmada", async () => {
    const candidatoId = await syncCandidateFromProfile();
    await rodar("skills", "seed");
    await saveDocument({
      candidateId: candidatoId,
      kind: "cv",
      label: "cv.md",
      format: "text",
      content: [
        "Construí pipelines de RAG em produção, com avaliação offline e",
        "observabilidade de custo por consulta. Kubernetes para orquestração,",
        "PostgreSQL como armazenamento primário e Python no processamento.",
      ].join("\n"),
    });

    const r = await rodar("skills", "detect");

    expect(r.code).toBeUndefined();
    const linhas = await banco().select().from(candidateSkill);
    expect(linhas.length).toBeGreaterThan(0);
    // Regra 7 do CLAUDE.md na coluna: o sistema afirma que ENCONTROU, jamais
    // que a pessoa TEM. Nascer como `confirmed` seria o sistema inventando
    // experiência a partir de uma menção.
    expect(linhas.every((l) => l.status === "detected")).toBe(true);
    expect(r.out).toContain("Detectada não é confirmada");
  });

  it("não sobrescreve o que já foi auditado à mão", async () => {
    const candidatoId = await syncCandidateFromProfile();
    await rodar("skills", "seed");
    await saveDocument({
      candidateId: candidatoId,
      kind: "cv",
      label: "cv.md",
      format: "text",
      content: "Construí pipelines de RAG em produção com avaliação offline e Kubernetes.",
    });
    await rodar("skills", "detect");
    const [primeira] = await banco().select().from(candidateSkill).limit(1);
    await rodar("skills", "reject", String(primeira!.id));

    const r = await rodar("skills", "detect");

    expect(r.out).toContain("preservada");
    const linhas = await banco().select().from(candidateSkill);
    const auditada = linhas.find((l) => l.id === primeira!.id);
    // Redetectar e reverter o veredito humano faria a auditoria virar trabalho
    // que se desfaz sozinho na próxima execução.
    expect(auditada?.status).toBe("rejected");
  });
});

describe("jho scrape queue", () => {
  it("enfileira as vagas sem descrição acima do fit pedido", async () => {
    await syncCandidateFromProfile();
    await semearVaga("sem-descricao");
    await rodar("jobs", "score");

    const r = await rodar("scrape", "queue", "--min-fit", "0");

    expect(r.code).toBeUndefined();
    expect(r.out).toMatch(/\d+ na fila/);
    expect((await banco().select().from(scrapeTask)).length).toBeGreaterThan(0);
  });

  it("`--limit` chega como número e limita mesmo", async () => {
    await syncCandidateFromProfile();
    await semearVaga("a");
    await semearVaga("b");
    await semearVaga("c");
    await rodar("jobs", "score");

    await rodar("scrape", "queue", "--min-fit", "0", "-n", "2");

    // `Number(opts.limit)` é a fronteira: com a string do argv o `limit` do
    // Drizzle recebe texto e o teto some sem erro nenhum.
    expect(await banco().select().from(scrapeTask)).toHaveLength(2);
  });

  it("enfileirar duas vezes não duplica a tarefa", async () => {
    await syncCandidateFromProfile();
    await semearVaga();
    await rodar("jobs", "score");
    await rodar("scrape", "queue", "--min-fit", "0");
    const depoisDaPrimeira = (await banco().select().from(scrapeTask)).length;

    await rodar("scrape", "queue", "--min-fit", "0");

    expect((await banco().select().from(scrapeTask)).length).toBe(depoisDaPrimeira);
  });
});

describe("jho mail import <path>", () => {
  /** Um .eml de uma parte só — é o formato que os ATS realmente mandam. */
  async function pastaComEml(nome: string, corpo: string, assunto: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "jho-cli-mail-"));
    const cabecalho = [
      `Message-ID: <${nome}@acme.test>`,
      "From: no-reply@acme.test",
      "To: eu@exemplo.test",
      `Subject: ${assunto}`,
      "Date: Mon, 17 Aug 2026 10:00:00 +0000",
      "Content-Type: text/plain; charset=utf-8",
    ].join("\n");
    await writeFile(join(dir, nome), `${cabecalho}\n\n${corpo}`);
    return dir;
  }

  it("`--dry-run` classifica e não grava mensagem nenhuma", async () => {
    await syncCandidateFromProfile();
    const dir = await pastaComEml(
      "recebido.eml",
      "We have received your application and will review it shortly.",
      "We received your application",
    );

    const r = await rodar("mail", "import", dir, "--dry-run");

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("nada foi gravado");
    expect(await banco().select().from(mailMessage)).toHaveLength(0);
  });

  it("grava a mensagem e conta duplicata na segunda passada", async () => {
    await syncCandidateFromProfile();
    const dir = await pastaComEml(
      "recebido.eml",
      "We have received your application and will review it shortly.",
      "We received your application",
    );

    const primeira = await rodar("mail", "import", dir);
    const segunda = await rodar("mail", "import", dir);

    expect(primeira.out).toContain("1 novo(s)");
    // Reimportar a mesma caixa é o uso normal — a pasta cresce, não é trocada.
    // Dedupe por Message-ID é o que permite rodar o comando sem pensar.
    expect(segunda.out).toContain("1 já conhecido(s)");
    expect(await banco().select().from(mailMessage)).toHaveLength(1);
  });

  it("avisa quando não há arquivo de e-mail no caminho", async () => {
    await syncCandidateFromProfile();
    const dir = await mkdtemp(join(tmpdir(), "jho-cli-mail-"));
    await writeFile(join(dir, "leiame.pdf"), "não é e-mail");

    const r = await rodar("mail", "import", dir);

    expect(r.out).toContain("Nenhum arquivo .eml");
  });

  /**
   * Regra 2 do CLAUDE.md, no comando que mais poderia quebrá-la: importar
   * e-mail mexe em `mail_message` e produz SUGESTÃO — nunca escreve direto em
   * `application`. Um ATS mandando "we received your application" não pode
   * mover o funil sozinho.
   */
  it("nunca escreve na candidatura, só produz sugestão", async () => {
    const candidatoId = await syncCandidateFromProfile();
    const vagaId = await semearVaga();
    const { application } = await import("../src/core/db/schema.ts");
    await banco()
      .insert(application)
      .values({ candidateId: candidatoId, jobId: vagaId, status: "applied" });
    const dir = await pastaComEml(
      "rejeicao.eml",
      "Unfortunately we decided to move forward with other candidates.",
      "Update on your application",
    );

    await rodar("mail", "import", dir);

    const [linha] = await banco().select().from(application);
    expect(linha?.status).toBe("applied");
  });
});
