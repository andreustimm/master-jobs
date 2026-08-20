/**
 * Suíte: os comandos de `src/cli.ts` que só imprimem o **plano e a
 * infraestrutura** — `tasks list`, `posts list`, `metrics trend`, `fx show`,
 * `sources list` e `llm list`.
 *
 * ## O que estes seis têm em comum
 *
 * Nenhum deles escreve. Todos são a única janela para uma tabela que outro
 * comando alimenta, e o modo de falhar de uma janela é sempre o mesmo: mostrar
 * menos do que existe, ou estourar quando não existe nada. Os casos abaixo
 * atacam os dois — sempre com o banco recém-migrado (o vazio de quem instalou
 * agora) e depois com dado semeado pelos comandos reais.
 *
 * ## Por que não se asserta o texto
 *
 * Congelar a tabela do terminal transformaria "mover uma coluna" em "quebrar a
 * suíte", e mover coluna é barato de propósito. O que se afirma é: código de
 * saída limpo, nenhuma exceção escapando, e o FILTRO fazendo diferença — a
 * mesma consulta com e sem a flag devolvendo conjuntos diferentes. Onde o
 * comando ramifica sobre o dado (métrica com uma leitura só, cotação velha,
 * fonte que nunca sincronizou, modelo sem chave), a asserção é sobre o ramo
 * ter sido andado, não sobre a frase escolhida.
 *
 * Fronteira DENTRO: filtros, defaults, ramos de vazio, ramos de estado.
 * Fronteira FORA: rede. `fx show` lê o cache e nunca chama provedor;
 * `sources list` lê YAML de arquivo temporário; `llm list` só consulta o
 * cadastro — a chave de API nunca sai do `process.env`.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fxRate, positioningTask, source } from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { banco, carregarCli, rodar } from "./cov-cli-harness.ts";

/** Variáveis de ambiente tocadas por algum caso, restauradas no `afterEach`. */
const AMBIENTE_TOCADO = ["JHO_SOURCES_PATH", "JHO_CHAVE_DE_TESTE"] as const;
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

/** Data ISO deslocada em dias — usada para envelhecer cotação de propósito. */
function diasAtras(dias: number): string {
  return new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10);
}

async function arquivoYaml(conteudo: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "jho-sources-"));
  const caminho = join(dir, "sources.yaml");
  await writeFile(caminho, conteudo, "utf8");
  return caminho;
}

describe("jho tasks list", () => {
  it("sem plano semeado, aponta o comando que semeia — e sai com sucesso", async () => {
    const r = await rodar("tasks", "list");
    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();
    // Vazio aqui não é falha, é estado inicial. O que ele NÃO pode ser é uma
    // tela em branco: sem a dica, a pessoa conclui que o plano não existe.
    expect(r.out).toContain("db seed");
  });

  it("mostra só o que está aberto; `--all` traz o que já foi fechado", async () => {
    await rodar("db", "seed", "--skip-auth");
    const [primeira] = await banco().select().from(positioningTask).orderBy(positioningTask.id);
    await rodar("tasks", "done", primeira!.id);

    const abertas = await rodar("tasks", "list");
    const todas = await rodar("tasks", "list", "--all");

    expect(abertas.code).toBeUndefined();
    // O default esconde o concluído porque a lista é de trabalho, não de
    // histórico; `--all` existe para conferência. A diferença entre as duas
    // saídas é a prova do filtro, sem depender de nenhuma coluna.
    expect(abertas.out).not.toContain(primeira!.id);
    expect(todas.out).toContain(primeira!.id);
  });

  it("mostra o item pulado quando `--all`, com marca própria", async () => {
    await rodar("db", "seed", "--skip-auth");
    const [primeira] = await banco().select().from(positioningTask).orderBy(positioningTask.id);
    await rodar("tasks", "done", primeira!.id, "--status", "skipped");

    const todas = await rodar("tasks", "list", "--all");
    expect(todas.out).toContain(primeira!.id);
    // Concluído e pulado são resultados diferentes e a tela os separa; se a
    // marca fosse a mesma, "não fiz" viraria "fiz" na próxima leitura.
    const linha = todas.out.split("\n").find((l) => l.includes(primeira!.id));
    expect(linha).not.toContain("✓");
  });

  it("`--horizon` recorta o plano por prazo", async () => {
    await rodar("db", "seed", "--skip-auth");
    const linhas24h = await banco()
      .select()
      .from(positioningTask)
      .where(eq(positioningTask.horizon, "24h"));
    expect(linhas24h.length).toBeGreaterThan(0);

    const curto = await rodar("tasks", "list", "--horizon", "24h");
    expect(curto.code).toBeUndefined();
    for (const tarefa of linhas24h) expect(curto.out).toContain(tarefa.id);

    // Nenhuma de outro horizonte pode vazar — o valor do recorte é
    // exatamente não ver o de 90 dias na segunda-feira de manhã.
    const de90 = await banco()
      .select()
      .from(positioningTask)
      .where(eq(positioningTask.horizon, "90d"));
    for (const tarefa of de90) expect(curto.out).not.toContain(tarefa.id);
  });

  it("`--horizon` inexistente devolve vazio, não erro", async () => {
    await rodar("db", "seed", "--skip-auth");
    const r = await rodar("tasks", "list", "--horizon", "amanha");
    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();
    expect(r.out).toContain("db seed");
  });

  it("o apelido `ls` é o mesmo comando", async () => {
    await rodar("db", "seed", "--skip-auth");
    const porApelido = await rodar("tasks", "ls");
    const porNome = await rodar("tasks", "list");
    expect(porApelido.out).toBe(porNome.out);
  });

  it("flag inexistente falha como erro de uso", async () => {
    const r = await rodar("tasks", "list", "--prazo", "24h");
    expect((r.erro as { code?: string }).code).toBe("commander.unknownOption");
  });
});

describe("jho posts list", () => {
  it("sem nenhum rascunho, lembra a cadência que a auditoria pede", async () => {
    const r = await rodar("posts", "list");
    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();
    expect(r.out.length).toBeGreaterThan(0);
  });

  it("distingue rascunho de publicado na mesma listagem", async () => {
    await rodar("posts", "add", "rascunho-um", "-t", "Primeiro", "-p", "leadership", "-b", "Corpo.");
    await rodar("posts", "add", "publicado-um", "-t", "Segundo", "-p", "leadership", "-b", "Corpo.");
    await rodar("posts", "published", "publicado-um");

    const r = await rodar("posts", "list");
    expect(r.code).toBeUndefined();
    expect(r.out).toContain("rascunho-um");
    expect(r.out).toContain("publicado-um");
    // A marca de publicado é o que impede republicar por engano — e é a única
    // diferença visível entre as duas linhas.
    const linhaPublicada = r.out.split("\n").find((l) => l.includes("publicado-um"));
    const linhaRascunho = r.out.split("\n").find((l) => l.includes("rascunho-um"));
    expect(linhaPublicada).toContain("✓");
    expect(linhaRascunho).not.toContain("✓");
  });

  it("o apelido `ls` é o mesmo comando", async () => {
    await rodar("posts", "add", "slug-x", "-t", "T", "-p", "leadership", "-b", "Corpo.");
    const porApelido = await rodar("posts", "ls");
    const porNome = await rodar("posts", "list");
    expect(porApelido.out).toBe(porNome.out);
  });
});

describe("jho metrics trend", () => {
  it("sem métrica nenhuma, manda semear", async () => {
    const r = await rodar("metrics", "trend");
    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();
    expect(r.out).toContain("db seed");
  });

  it("com uma leitura só, marca que ainda não há tendência", async () => {
    await rodar("metrics", "record", "ssi_total", "59");
    const r = await rodar("metrics", "trend");
    expect(r.code).toBeUndefined();
    // Uma leitura não é tendência. Imprimir delta zero seria mentir por
    // omissão: zero significa "não mudou", e o que houve foi "não mediu duas
    // vezes".
    expect(r.out).toContain("baseline");
  });

  it("classifica a variação em subiu, caiu e não mudou", async () => {
    await rodar("metrics", "record", "subiu", "10", "--at", "2026-08-01");
    await rodar("metrics", "record", "subiu", "20", "--at", "2026-08-10");
    await rodar("metrics", "record", "caiu", "30", "--at", "2026-08-01");
    await rodar("metrics", "record", "caiu", "12", "--at", "2026-08-10");
    await rodar("metrics", "record", "parado", "7", "--at", "2026-08-01");
    await rodar("metrics", "record", "parado", "7", "--at", "2026-08-10");

    const r = await rodar("metrics", "trend");
    expect(r.code).toBeUndefined();

    const linha = (chave: string) => r.out.split("\n").find((l) => l.startsWith(`  ${chave}`))!;
    // O sinal é a informação: `+` e `-` decidem se a próxima semana repete ou
    // muda a tática. Os três ramos do ternário aninhado existem por isso.
    expect(linha("subiu")).toContain("+10");
    expect(linha("caiu")).toContain("-18");
    expect(linha("parado")).toContain("0");
  });

  it("o apelido `show` é o mesmo comando", async () => {
    await rodar("metrics", "record", "ssi_total", "59");
    const porApelido = await rodar("metrics", "show");
    const porNome = await rodar("metrics", "trend");
    expect(porApelido.out).toBe(porNome.out);
  });
});

describe("jho fx show", () => {
  it("sem cache, diz para buscar em vez de fingir uma cotação", async () => {
    const r = await rodar("fx", "show");
    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();
    // Inventar taxa aqui distorceria toda comparação de remuneração do
    // acervo; a ausência de cotação precisa aparecer como ausência.
    expect(r.out).toContain("fx refresh");
  });

  it("com cotação do dia, imprime a tabela sem aviso de validade", async () => {
    const hoje = diasAtras(0);
    await banco().insert(fxRate).values([
      { date: hoje, base: "USD", currency: "BRL", rate: 5.4321, provider: "manual" },
      { date: hoje, base: "USD", currency: "EUR", rate: 0.9123, provider: "manual" },
    ]);

    const r = await rodar("fx", "show");
    expect(r.code).toBeUndefined();
    expect(r.out).toContain("BRL");
    expect(r.out).toContain("EUR");
    expect(r.out).not.toContain("fx refresh");
  });

  it("com cotação velha, avisa duas vezes — no carimbo e no rodapé", async () => {
    await banco().insert(fxRate).values({
      date: diasAtras(30), base: "USD", currency: "BRL", rate: 5.0, provider: "manual",
    });

    const r = await rodar("fx", "show");
    expect(r.code).toBeUndefined();
    // Cotação de trinta dias atrás ainda é um número plausível na tela; sem o
    // aviso ela seria usada como se fosse de hoje.
    expect(r.out).toContain("fx refresh");
    expect(r.out).toContain("30d");
  });

  it("`--base` é normalizado para maiúsculas antes de consultar", async () => {
    const hoje = diasAtras(0);
    await banco().insert(fxRate).values({
      date: hoje, base: "EUR", currency: "BRL", rate: 6.1, provider: "manual",
    });

    // Quem digita `--base eur` quer a tabela do euro. Sem o `toUpperCase()` a
    // consulta erraria por caixa e devolveria "nenhuma cotação em cache" com
    // a cotação bem ali no banco.
    const minusculo = await rodar("fx", "show", "--base", "eur");
    expect(minusculo.code).toBeUndefined();
    expect(minusculo.out).toContain("BRL");
    expect(minusculo.out).not.toContain("fx refresh");

    // E a base sem cotação continua caindo no ramo de vazio.
    const semCotacao = await rodar("fx", "show", "--base", "gbp");
    expect(semCotacao.out).toContain("fx refresh");
  });

  it("flag inexistente falha como erro de uso", async () => {
    const r = await rodar("fx", "show", "--moeda", "USD");
    expect((r.erro as { code?: string }).code).toBe("commander.unknownOption");
  });
});

describe("jho sources list", () => {
  const YAML_TRES_FONTES = [
    "sources:",
    "  - { kind: greenhouse, handle: alfa, label: Alfa }",
    "  - { kind: lever, handle: beta, label: Beta }",
    "  - { kind: remotive, handle: '', label: Remotive }",
    "",
  ].join("\n");

  it("mostra a fonte configurada que nunca sincronizou", async () => {
    process.env.JHO_SOURCES_PATH = await arquivoYaml(YAML_TRES_FONTES);

    const r = await rodar("sources", "list");
    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();
    // A configuração é a verdade sobre o que DEVERIA rodar; o banco só sabe o
    // que rodou. Uma fonte configurada e nunca sincronizada é a falha mais
    // cara desta tela, e só aparece porque a listagem parte do YAML.
    expect(r.out).toContain("greenhouse");
    expect(r.out).toContain("lever");
    expect(r.out).toContain("never");
  });

  it("handle vazio aparece como `(all)`, que é o que ele significa", async () => {
    process.env.JHO_SOURCES_PATH = await arquivoYaml(YAML_TRES_FONTES);
    const r = await rodar("sources", "list");
    // Agregador sem handle varre o site inteiro. Linha em branco na coluna
    // faria parecer configuração pela metade.
    expect(r.out).toContain("(all)");
  });

  it("junta o resultado do último sync de cada fonte, inclusive o erro", async () => {
    process.env.JHO_SOURCES_PATH = await arquivoYaml(YAML_TRES_FONTES);
    await banco().insert(source).values([
      {
        id: "greenhouse:alfa", kind: "greenhouse", handle: "alfa", label: "Alfa",
        lastStatus: "ok", lastSyncedAt: "2026-08-17T10:00:00.000Z", lastJobCount: 42,
      },
      {
        id: "lever:beta", kind: "lever", handle: "beta", label: "Beta",
        lastStatus: "error", lastSyncedAt: "2026-08-17T10:05:00.000Z",
        lastError: "403 do board", lastJobCount: 0,
      },
    ]);

    const r = await rodar("sources", "list");
    expect(r.code).toBeUndefined();
    expect(r.out).toContain("42");
    // O erro da última varredura vem numa linha própria embaixo da fonte: é o
    // que diferencia "essa fonte não tem vaga" de "essa fonte parou de
    // responder", e as duas exigem ações opostas.
    expect(r.out).toContain("403 do board");
  });

  it("fonte no banco que não está mais no YAML não é listada", async () => {
    process.env.JHO_SOURCES_PATH = await arquivoYaml(
      "sources:\n  - { kind: greenhouse, handle: alfa, label: Alfa }\n",
    );
    await banco().insert(source).values({
      id: "lever:removida", kind: "lever", handle: "removida", label: "Removida",
      lastStatus: "ok", lastJobCount: 9,
    });

    const r = await rodar("sources", "list");
    // A listagem é dirigida pela configuração. Fonte desativada continua no
    // banco por causa das vagas que ela trouxe, e mostrá-la faria parecer que
    // ainda roda.
    expect(r.out).not.toContain("removida");
  });

  it("YAML inválido interrompe em vez de listar metade", async () => {
    process.env.JHO_SOURCES_PATH = await arquivoYaml("sources:\n  - { kind: inventado, label: X }\n");
    const r = await rodar("sources", "list");
    expect(r.erro).toBeInstanceOf(Error);
    expect((r.erro as Error).message).toContain("sources.yaml");
  });
});

describe("jho llm list", () => {
  it("sem cadastro, aponta o `llm seed`", async () => {
    const r = await rodar("llm", "list");
    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();
    expect(r.out).toContain("llm seed");
  });

  it("marca o modelo em uso e mostra quem tem chave disponível", async () => {
    process.env.JHO_CHAVE_DE_TESTE = "sk-de-mentira";
    await rodar("llm", "add-provider", "provedor-a", "--label", "Provedor A", "--key-env", "JHO_CHAVE_DE_TESTE");
    await rodar("llm", "add-provider", "provedor-b", "--label", "Provedor B", "--key-env", "JHO_CHAVE_AUSENTE");
    await rodar(
      "llm", "add-model", "provedor-a", "modelo-com-chave",
      "--label", "Com chave", "--reasoning", "--effort", "high", "--in-cost", "3", "--out-cost", "15",
    );
    await rodar("llm", "add-model", "provedor-b", "modelo-sem-chave", "--label", "Sem chave");
    await rodar("llm", "use", "modelo-com-chave");

    const r = await rodar("llm", "list");
    expect(r.code).toBeUndefined();
    expect(r.out).toContain("Com chave");
    expect(r.out).toContain("Sem chave");
    // A seta é a resposta à única pergunta que a tela existe para responder:
    // qual modelo vai gastar dinheiro no próximo `jho analyze`.
    const linhaAtiva = r.out.split("\n").find((l) => l.includes("Com chave"));
    expect(linhaAtiva).toContain("→");
    // Modelo com preço mostra preço; sem preço mostra travessão. Comparar
    // custo entre provedores é metade da razão de o cadastro existir.
    expect(linhaAtiva).toContain("$3/$15");
    // O nome da variável aparece no lugar de "ok" quando a chave falta — é a
    // instrução de conserto, e prova também que a chave em si nunca é
    // impressa nem gravada.
    expect(r.out).toContain("JHO_CHAVE_AUSENTE");
    expect(r.out).not.toContain("sk-de-mentira");
  });

  it("`--all` inclui o modelo desabilitado, que o default esconde", async () => {
    await rodar("llm", "add-provider", "provedor-a", "--label", "Provedor A", "--key-env", "JHO_CHAVE_AUSENTE");
    await rodar("llm", "add-model", "provedor-a", "modelo-ligado", "--label", "Ligado");
    await rodar("llm", "add-model", "provedor-a", "modelo-desligado", "--label", "Desligado");

    const { llmModel } = await import("../src/core/db/schema.ts");
    await banco().update(llmModel).set({ enabled: false }).where(eq(llmModel.modelId, "modelo-desligado"));

    const padrao = await rodar("llm", "list");
    const comTudo = await rodar("llm", "list", "--all");

    expect(padrao.out).not.toContain("Desligado");
    expect(comTudo.out).toContain("Desligado");
    expect(comTudo.out).toContain("Ligado");
  });

  it("é o subcomando padrão de `jho llm`", async () => {
    await rodar("llm", "add-provider", "provedor-a", "--label", "Provedor A", "--key-env", "JHO_CHAVE_AUSENTE");
    await rodar("llm", "add-model", "provedor-a", "modelo-ligado", "--label", "Ligado");

    // `isDefault: true` no registro do subcomando: `jho llm` sozinho tem de
    // cair na listagem, não na ajuda. Quem digita o grupo quer ver o estado.
    const semSubcomando = await rodar("llm");
    const explicito = await rodar("llm", "list");
    expect(semSubcomando.out).toBe(explicito.out);
  });

  it("flag inexistente falha como erro de uso", async () => {
    const r = await rodar("llm", "list", "--todos");
    expect((r.erro as { code?: string }).code).toBe("commander.unknownOption");
  });
});
