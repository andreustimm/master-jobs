/**
 * Suíte: os dois comandos de `src/cli.ts` que abrem **um registro por vez** —
 * `tasks show <id>` e `auth status`.
 *
 * ## O que os dois têm em comum
 *
 * Ambos são a tela que alguém abre quando já desconfia de alguma coisa. `tasks
 * show` é o detalhe de um item do plano depois que a lista mostrou pouco;
 * `auth status` é a pergunta "quem consegue entrar aqui, e sob que modo".
 * O modo de falhar de uma tela dessas não é estourar — é **responder menos do
 * que a pergunta**: esconder que o item existe, ou esconder que o sistema está
 * sem proteção.
 *
 * ## Por que não se asserta o texto da tela
 *
 * Mesma razão do resto da bancada: congelar a frase transforma "reescrever o
 * cabeçalho" em "quebrar a suíte". O que se afirma aqui é código de saída,
 * ausência de exceção, e **diferença** — dois estados do banco produzindo duas
 * saídas distintas. Onde a frase é a única coisa que a pessoa tem para agir
 * (o comando que cria a primeira conta, o nome da variável que abriu o
 * sistema), aí sim a asserção é sobre o conteúdo, porque ali a frase É o
 * contrato.
 *
 * Fronteira DENTRO: busca por id, normalização do id, ramo de não-encontrado,
 * campos opcionais ausentes, lista de contas vazia e cheia, conta desabilitada,
 * modo aberto contra modo autenticado.
 * Fronteira FORA: rede e disco. Nenhum dos dois comandos sai da máquina —
 * `auth status` roda migração no banco de teste e lê `process.env`, nada mais.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authUser, positioningTask } from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { banco, carregarCli, rodar } from "./cov-cli-harness.ts";

/** Variáveis de ambiente tocadas por algum caso, restauradas no `afterEach`. */
const AMBIENTE_TOCADO = ["JHO_AUTH_MODE"] as const;
let ambienteOriginal: Record<string, string | undefined> = {};

beforeAll(async () => {
  await carregarCli();
});

beforeEach(async () => {
  ambienteOriginal = Object.fromEntries(AMBIENTE_TOCADO.map((k) => [k, process.env[k]]));
  await useTestDb();
});

afterEach(() => {
  for (const chave of AMBIENTE_TOCADO) {
    const valor = ambienteOriginal[chave];
    if (valor === undefined) delete process.env[chave];
    else process.env[chave] = valor;
  }
  releaseTestDb();
});

/** Primeiro item do plano semeado, que é o alvo estável dos casos de `show`. */
async function primeiraTarefa(): Promise<{ id: string }> {
  await rodar("db", "seed", "--skip-auth");
  const [t] = await banco().select().from(positioningTask).orderBy(positioningTask.id);
  if (!t) throw new Error("db seed não semeou plano — o caso perdeu o alvo");
  return t;
}

describe("jho tasks show", () => {
  it("abre o item que a lista só resumiu", async () => {
    const t = await primeiraTarefa();
    const r = await rodar("tasks", "show", t.id);

    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();
    // O id é o que liga esta tela ao item da lista e ao commit que o fecha.
    // É a única coisa da saída que não pode mudar de forma.
    expect(r.out).toContain(t.id);
  });

  it("aceita o id em minúscula — quem digita não repete o caixa alta", async () => {
    const t = await primeiraTarefa();
    const maiuscula = await rodar("tasks", "show", t.id);
    const minuscula = await rodar("tasks", "show", t.id.toLowerCase());

    // A normalização existe para o id copiado de um texto corrido. Se ela cair,
    // o comando passa a dizer "não existe" sobre algo que existe — o pior
    // desfecho possível para uma tela de detalhe.
    expect(minuscula.code).toBeUndefined();
    expect(minuscula.out).toBe(maiuscula.out);
  });

  it("id inexistente sai com 1 e repete o id procurado", async () => {
    await primeiraTarefa();
    const r = await rodar("tasks", "show", "TASK-9999");

    expect(r.code).toBe(1);
    // Repetir o id é o que separa "não existe" de "digitei errado", e só quem
    // digitou sabe qual dos dois foi.
    expect(r.err).toContain("TASK-9999");
  });

  it("item sem campo opcional nenhum ainda mostra título e id", async () => {
    const t = await primeiraTarefa();
    // `why`, `how`, `expected` e `sourceRef` são opcionais no plano, e cada um
    // é impresso sob `if`. Uma tarefa recém-criada à mão não tem nenhum deles:
    // é o caso em que quatro ramos caem juntos, e a tela não pode ficar vazia.
    await banco()
      .update(positioningTask)
      .set({ why: null, how: null, expected: null, sourceRef: null, effort: null })
      .where(eq(positioningTask.id, t.id));

    const r = await rodar("tasks", "show", t.id);

    expect(r.code).toBeUndefined();
    expect(r.out).toContain(t.id);
    // Sem os quatro, os rótulos não podem sobrar sozinhos na tela.
    expect(r.out).not.toContain("Por que");
    expect(r.out).not.toContain("Espera");
  });
});

describe("jho auth status", () => {
  it("sem conta nenhuma, ensina o comando que cria a primeira", async () => {
    const r = await rodar("auth", "status");

    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();
    // Aqui a frase É o contrato: quem instalou agora não tem outro caminho para
    // descobrir como entrar, e a tela de login manda exatamente para cá.
    expect(r.out).toContain("add-user");
  });

  it("lista a conta criada, com o papel que ela recebeu", async () => {
    await rodar("auth", "add-user", "alguem@exemplo.test", "--role", "recruiter");
    const r = await rodar("auth", "status");

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("alguem@exemplo.test");
    // O papel é o que decide o que a conta enxerga. Uma lista de contas que não
    // mostra papel não responde à pergunta que fez alguém abrir a tela.
    expect(r.out).toContain("recruiter");
  });

  it("conta desabilitada não se parece com uma ativa", async () => {
    await rodar("auth", "add-user", "ativa@exemplo.test", "--role", "recruiter");
    const ativa = await rodar("auth", "status");

    await banco()
      .update(authUser)
      .set({ disabledAt: new Date().toISOString() })
      .where(eq(authUser.email, "ativa@exemplo.test"));
    const desabilitada = await rodar("auth", "status");

    expect(desabilitada.code).toBeUndefined();
    // Desabilitar é a ação de segurança mais barata que existe aqui. Se as duas
    // telas fossem iguais, ninguém teria como conferir que ela pegou.
    expect(desabilitada.out).not.toBe(ativa.out);
  });

  it("modo aberto é anunciado, e nomeia a variável que o ligou", async () => {
    delete process.env.JHO_AUTH_MODE;
    const fechado = await rodar("auth", "status");

    process.env.JHO_AUTH_MODE = "open";
    const aberto = await rodar("auth", "status");

    expect(aberto.code).toBeUndefined();
    expect(aberto.out).not.toBe(fechado.out);
    // Nomear a variável é o contrato: sem o nome, quem vê o aviso num servidor
    // não sabe o que desligar. Este é o comando que existe para responder
    // "estou exposto?", e a resposta precisa vir acionável.
    expect(aberto.out).toContain("JHO_AUTH_MODE");
  });
});
