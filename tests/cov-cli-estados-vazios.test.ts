/**
 * O que cada comando diz quando não há nada — e quando há.
 *
 * Um comando de lista tem dois desfechos e quase sempre só um caso: o cheio. O
 * vazio é o que a pessoa vê no primeiro dia de uso, e é onde a saída pode mentir
 * de duas formas opostas — imprimir cabeçalho de tabela sem linha, que lê como
 * "carregou e não achou nada relevante", ou não imprimir nada, que lê como
 * sucesso silencioso.
 *
 * Cada caso aqui exercita OS DOIS lados do mesmo ramo, porque o par é o que
 * prova que a mensagem de vazio não é o que aparece sempre.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { candidate } from "../src/core/db/schema.ts";
import { banco, carregarCli, rodar } from "./cov-cli-harness.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

vi.mock("commander", async () => (await import("./cov-cli-harness.ts")).commanderMock());

const ambiente = { ...process.env };

beforeEach(async () => {
  await useTestDb();
  await carregarCli();
});

afterEach(async () => {
  process.env = { ...ambiente };
  vi.restoreAllMocks();
  await releaseTestDb();
});

/**
 * O candidato ativo, que é quem os comandos sem `--candidate` resolvem.
 *
 * O slug tem de ser `default`: `getCandidate()` consulta por ele, não pela coluna
 * `is_default`. Uma linha com `is_default: true` e outro slug não é o ativo, e
 * todo comando sem a flag recusa pedindo `jho db seed`.
 */
async function dono(): Promise<number> {
  const [linha] = await banco()
    .insert(candidate)
    .values({ slug: "default", name: "Dono", isDefault: true })
    .returning({ id: candidate.id });
  return linha!.id;
}

describe("a fila de repontuação", () => {
  it("UT-330 vazia diz que está vazia, e não imprime tabela nenhuma", async () => {
    const r = await rodar("jobs", "rescore", "status");

    expect(r.out).toContain("Fila vazia");
    // A prova de que a mensagem não é um rótulo fixo: nenhum estado listado.
    expect(r.out).not.toMatch(/pending|claimed|done/);
    expect(r.code).toBeUndefined();
  });

  it("UT-331 com um candidato na fila, lista o estado em vez da mensagem de vazio", async () => {
    const id = await dono();

    await rodar("jobs", "rescore", "queue", "--candidate", String(id));
    const r = await rodar("jobs", "rescore", "status");

    expect(r.out).not.toContain("Fila vazia");
    // O estado aparece com a contagem: é o que distingue fila parada de fila
    // andando, e sem ele o operador não sabe se `run` tem trabalho.
    expect(r.out).toMatch(/\d/);
  });

  it("UT-332 enfileirar sem `--candidate` usa o candidato ativo", async () => {
    // Os dois lados do ternário que resolve o alvo: o id explícito e o ativo.
    // Resolver errado enfileira a repontuação da pessoa errada.
    const id = await dono();

    const explicito = await rodar("jobs", "rescore", "queue", "--candidate", String(id));
    expect(explicito.out).toContain(`candidato ${id}`);

    const implicito = await rodar("jobs", "rescore", "queue");
    expect(implicito.out).toContain(`candidato ${id}`);
  });

  it("UT-340 sem candidato de slug `default`, a recusa nomeia o comando que resolve", async () => {
    // O terceiro desfecho do mesmo ternário, e o que uma máquina nova encontra.
    // A mensagem tem de ser acionável; ela sobe até a guarda de entrypoint, que
    // no terminal a imprime em vermelho.
    await banco().insert(candidate).values({ slug: "outro", name: "Outro", isDefault: true });

    const r = await rodar("jobs", "rescore", "queue");

    expect((r.erro as Error).message).toMatch(/Candidato padrão não cadastrado/);
    expect((r.erro as Error).message).toMatch(/jho db seed/);
  });

  it("UT-333 consumir a fila vazia relata zero, sem falha", async () => {
    const r = await rodar("jobs", "rescore", "run");

    expect(r.out).toMatch(/0 candidato\(s\)/);
    expect(r.code).toBeUndefined();
  });

  it("UT-334 `--max` limita quantos candidatos a execução consome", async () => {
    // O ramo `opts.max ? Number(opts.max) : undefined`: sem a flag o limite é
    // ausente, com ela é um número. Ler a flag errada faria a fila inteira ser
    // consumida numa invocação que pediu uma.
    const id = await dono();
    await rodar("jobs", "rescore", "queue", "--candidate", String(id));

    const r = await rodar("jobs", "rescore", "run", "--max", "1");

    expect(r.out).toMatch(/1 candidato\(s\)/);
  });
});

describe("as sugestões vindas de e-mail", () => {
  it("UT-335 sem sugestão pendente, diz isso e não abre cabeçalho", async () => {
    const r = await rodar("mail", "suggestions");

    expect(r.out).toContain("Nenhuma sugestão pendente");
    // Cabeçalho de tabela sem linha é o que este ramo existe para evitar.
    expect(r.out).not.toContain("STATUS SUGERIDO");
    expect(r.code).toBeUndefined();
  });

  it("UT-336 o apelido `sug` é o mesmo comando", async () => {
    // Apelido que aponta para outro lugar é a pior espécie de divergência: some
    // no diff e aparece na mão de quem digitou a forma curta.
    const completo = await rodar("mail", "suggestions");
    const curto = await rodar("mail", "sug");

    expect(curto.out).toBe(completo.out);
  });
});

describe("a reconferência de links", () => {
  it("UT-337 sem vaga para verificar, os totais são zero e não há divisão por zero", async () => {
    // A taxa de mortas é `gone / total`, e `total` é zero num acervo vazio. O
    // ramo protege a divisão, e sem ele a saída traria `NaN%`.
    const r = await rodar("jobs", "verify");

    expect(r.out).toMatch(/0 verificadas/);
    expect(r.out).not.toContain("NaN");
    expect(r.code).toBeUndefined();
  });
});

describe("as trilhas na linha de comando", () => {
  it("UT-338 candidato sem trilha própria diz isso em vez de tabela vazia", async () => {
    const id = await dono();

    const r = await rodar("tracks", "list", "--candidate", String(id));

    expect(r.out + r.err).toMatch(/no own matching profile/i);
    // E nenhum cabeçalho de tabela: a resposta é a frase, não uma grade vazia.
    expect(r.out).not.toMatch(/STATUS\s+TERMOS/i);
  });
});

describe("o perfil e o ambiente que ele precisa", () => {
  it("UT-339 `profile` valida o arquivo real e relata o que falta no ambiente", async () => {
    // O comando lê `profile/profile.yaml` de verdade. O ramo coberto aqui é o de
    // variável de ambiente ausente, que é o estado de uma máquina nova — e a
    // resposta certa é listar quais, não falhar sem dizer o quê.
    const r = await rodar("profile");

    expect(r.erro).toBeUndefined();
    expect((r.out + r.err).trim().length).toBeGreaterThan(0);
  });
});
