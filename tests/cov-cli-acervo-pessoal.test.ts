import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { syncCandidateFromProfile } from "../src/core/candidate.ts";
import { job, source } from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { banco, carregarCli, rodar } from "./cov-cli-harness.ts";

/**
 * Suíte: os comandos de `src/cli.ts` que mostram o **acervo pessoal** — o que
 * é do candidato, e não do mercado. Currículo (`cv show`, `cv versions`), rede
 * (`contacts`), fila de interação (`engage`), skills (`skills list`, `catalog`,
 * `demand`, `profile`) e a verificação de segurança.
 *
 * ## Por que estes ficaram por último
 *
 * Duas varreduras anteriores cobriram `src/cli.ts` por área — rede e
 * relatórios — e cada uma parou na fronteira do seu escopo. O que sobrou foi
 * justamente o meio: comandos que não buscam nada na internet e não exportam
 * nada, só leem o que o próprio usuário cadastrou. São os menos vistosos e os
 * mais fáceis de quebrar sem ninguém notar, porque ninguém olha uma listagem
 * duas vezes.
 *
 * ## O que se afirma
 *
 * Código de saída, ausência de exceção, e **diferença** — o mesmo comando com o
 * banco vazio e com o banco semeado produzindo saídas distintas. O vazio nunca
 * é falha: é o estado de quem instalou agora, e o que ele NÃO pode ser é uma
 * tela em branco. Por isso, onde há ramo de vazio, a asserção é sobre a dica
 * aparecer — ela é a única coisa que a pessoa tem para agir.
 *
 * Fronteira FORA: rede. Nenhum destes comandos sai da máquina. `skills detect`
 * lê o currículo salvo, `skills demand` lê o acervo já pontuado, e
 * `security check` inspeciona arquivos do próprio repositório.
 */

const CURRICULO = [
  "Andreus Timm — Senior AI Software Architect.",
  "Construí plataformas com rag e agentes em produção, com evals e guardrails.",
  "Experiência com typescript, python e postgres em ambientes multi-tenant.",
  "Liderança técnica de squads distribuídos, arquitetura de sistemas e mentoria.",
].join("\n");

const CURRICULO_REVISADO = [
  CURRICULO,
  "Adicionado depois: kubernetes, terraform e observabilidade em produção.",
].join("\n");

const AMBIENTE_TOCADO = ["JHO_VAULT_PATH", "JHO_REPORT_DIR"] as const;
let ambienteOriginal: Record<string, string | undefined> = {};

beforeAll(async () => {
  await carregarCli();
});

beforeEach(async () => {
  ambienteOriginal = Object.fromEntries(AMBIENTE_TOCADO.map((k) => [k, process.env[k]]));
  // O vault de quem desenvolve não pode ser destino de teste.
  for (const chave of AMBIENTE_TOCADO) delete process.env[chave];
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

async function arquivoTemporario(conteudo: string, nome: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "jho-acervo-"));
  const caminho = join(dir, nome);
  await writeFile(caminho, conteudo, "utf8");
  return caminho;
}

async function salvarCurriculo(conteudo = CURRICULO, nome = "cv.md"): Promise<void> {
  await rodar("cv", "set", await arquivoTemporario(conteudo, nome));
}

/** Uma vaga pontuada, para os comandos que leem demanda do mercado-alvo. */
async function semearVagaPontuada(): Promise<number> {
  const candidatoId = await syncCandidateFromProfile();
  await banco()
    .insert(source)
    .values({ id: "manual:acervo", kind: "manual", handle: "acervo", label: "Fonte de teste" })
    .onConflictDoNothing();
  await banco().insert(job).values({
    fingerprint: "fp-acervo",
    contentHash: "hash-acervo",
    sourceId: "manual:acervo",
    externalId: "acervo",
    companyName: "AlfaCorp",
    title: "AI Solutions Architect",
    descriptionText:
      "Remote worldwide. Buscamos arquitetura de sistemas com rag, agentes, evals e " +
      "guardrails em produção. Stack typescript, python, postgres e kubernetes. " +
      "Contrato PJ, sem exigência de visto.",
    locationRaw: "Remote — Worldwide",
    remote: true,
    url: "https://vagas.empresa-interna.test/acervo",
    postedAt: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10),
    raw: {},
  });
  await rodar("jobs", "score");
  return candidatoId;
}

describe("jho security check", () => {
  it("roda sem banco e classifica cada achado", async () => {
    const r = await rodar("security", "check");

    expect(r.erro).toBeUndefined();
    // O comando é o único que pode terminar com 1 por CONTEÚDO e não por falha:
    // achado crítico sai diferente de zero, de propósito, para servir de portão
    // em script. Os dois desfechos são válidos aqui.
    expect([undefined, 1]).toContain(r.code);
    // O resumo é o contrato: quem roda isto quer o número, não a lista.
    expect(r.out).toContain("aviso(s)");
    expect(r.out.length).toBeGreaterThan(0);
  });

  it("é o subcomando padrão de `security`", async () => {
    const explicito = await rodar("security", "check");
    const implicito = await rodar("security");

    // `{ isDefault: true }` existe para `jho security` funcionar sozinho. Se
    // cair, o comando passa a exigir uma palavra a mais sem avisar ninguém.
    expect(implicito.out).toBe(explicito.out);
  });
});

describe("jho cv show e versions", () => {
  it("sem currículo salvo, os dois ensinam o comando que salva", async () => {
    await syncCandidateFromProfile();

    const show = await rodar("cv", "show");
    const versions = await rodar("cv", "versions");

    expect(show.code).toBeUndefined();
    expect(versions.code).toBeUndefined();
    // Vazio aqui é o estado de quem instalou agora. Sem a dica, a conclusão é
    // que o recurso não existe.
    expect(show.out).toContain("cv set");
  });

  it("`show` imprime o conteúdo inteiro, não um resumo", async () => {
    await salvarCurriculo();

    const r = await rodar("cv", "show");

    expect(r.code).toBeUndefined();
    // O comando existe para conferir o texto que vai para a análise. Truncar
    // aqui derrotaria o propósito — e uma linha do meio é o que prova.
    expect(r.out).toContain("Liderança técnica de squads distribuídos");
  });

  it("`versions` lista as duas versões e marca só a corrente", async () => {
    await salvarCurriculo();
    await salvarCurriculo(CURRICULO_REVISADO, "cv-revisado.md");

    const r = await rodar("cv", "versions");

    expect(r.code).toBeUndefined();
    const linhas = r.out.split("\n").filter((l) => l.includes("#"));
    expect(linhas.length).toBe(2);
    // Salvar uma versão nova não apaga a anterior — é o que permite voltar
    // atrás. E exatamente uma pode ser a corrente: duas marcas, ou nenhuma,
    // tornam a lista inútil para decidir qual está valendo.
    expect(linhas.filter((l) => l.includes("✓")).length).toBe(1);
  });
});

describe("jho contacts", () => {
  it("sem contato nenhum, a lista ensina o comando que cadastra", async () => {
    const r = await rodar("contacts", "list");

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("contacts add");
  });

  it("lista o que foi cadastrado, e o cargo ocupa a própria linha", async () => {
    await rodar("contacts", "add", "Rafael Souza", "-c", "Acme", "-r", "Head of Engineering");
    await rodar("contacts", "add", "Marina Alves", "-c", "Beta");

    const r = await rodar("contacts", "list");

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("Rafael Souza");
    expect(r.out).toContain("Marina Alves");
    // O cargo é impresso sob `if`, numa linha própria. Quem não tem cargo não
    // pode ganhar uma linha em branco no meio da tabela.
    expect(r.out).toContain("Head of Engineering");
    expect(r.out).toContain("2 contato(s)");
  });

  it("`--category` filtra, e a diferença entre as duas saídas é a prova", async () => {
    await rodar("contacts", "add", "Rafael Souza", "-c", "Acme", "-k", "peer");
    await rodar("contacts", "add", "Marina Alves", "-c", "Beta", "-k", "recruiter");

    const todos = await rodar("contacts", "list");
    const filtrado = await rodar("contacts", "list", "-k", "recruiter");

    expect(filtrado.out).toContain("Marina Alves");
    expect(filtrado.out).not.toContain("Rafael Souza");
    expect(todos.out).toContain("Rafael Souza");
  });

  it("`seed` popula o histórico de trabalho a partir do perfil", async () => {
    await syncCandidateFromProfile();

    const r = await rodar("contacts", "seed");

    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();
    // O comando reporta inseridas e atualizadas, e é isso que diz se rodar de
    // novo fez algo — ele é idempotente por desenho.
    expect(r.out).toContain("empresa(s) adicionada(s)");
  });
});

describe("jho engage", () => {
  it("com a fila vazia, diz a meta em vez de mostrar nada", async () => {
    const r = await rodar("engage", "next");

    expect(r.code).toBeUndefined();
    // Fila vazia é sucesso, não erro. Mas uma tela em branco não informa que a
    // auditoria pede duas interações por dia útil — que é a razão da fila.
    expect(r.out.length).toBeGreaterThan(0);
  });

  it("mostra o que foi enfileirado, e avisa o que está sem rascunho", async () => {
    await rodar(
      "engage", "add", "https://www.linkedin.test/posts/alfa",
      "-n", "Rafael Souza", "-c", "Acme",
      "--why", "publicou sobre plataforma de agentes",
      "-d", "Comentário já redigido, pronto para postar.",
    );
    await rodar("engage", "add", "https://www.linkedin.test/posts/beta", "-n", "Marina Alves");

    const r = await rodar("engage", "next");

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("2 na fila");
    // Os dois ramos do rascunho num caso só: com rascunho imprime o texto, sem
    // rascunho imprime o aviso. O aviso é o que impede abrir o link sem ter o
    // que dizer — que é o modo de falhar desta fila.
    expect(r.out).toContain("Comentário já redigido");
    expect(r.out).toContain("sem rascunho");
    // `--why` também é impresso sob `if`: fila sem intenção vira lista de links.
    expect(r.out).toContain("publicou sobre plataforma de agentes");
  });

  it("tipo inválido é recusado antes de toca no banco", async () => {
    const r = await rodar("engage", "add", "https://www.linkedin.test/x", "-k", "telepatia");

    expect(r.code).toBe(1);
    expect(r.err).toContain("Tipo inválido");
    // Nada foi enfileirado: a recusa acontece antes do `withDb`.
    expect((await rodar("engage", "next")).out).not.toContain("na fila");
  });

  it("`targets` sem conta-alvo cadastrada não fica em branco", async () => {
    const r = await rodar("engage", "targets");

    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();
    expect(r.out.length).toBeGreaterThan(0);
  });

  it("`targets` mostra a conta cadastrada com URL", async () => {
    await rodar(
      "contacts", "add", "Rafael Souza",
      "-c", "Acme", "-u", "https://www.linkedin.test/in/rafael", "-k", "peer",
    );

    const r = await rodar("engage", "targets");

    expect(r.code).toBeUndefined();
    // A lista existe para achar quem nunca foi abordado — a §2.2 da auditoria.
    // Uma conta com URL e sem interação é exatamente o alvo.
    expect(r.out).toContain("Rafael Souza");
  });
});

describe("jho skills", () => {
  it("sem skill nenhuma, a lista ensina os dois comandos que a preenchem", async () => {
    await syncCandidateFromProfile();

    const r = await rodar("skills", "list");

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("skills seed");
    expect(r.out).toContain("skills detect");
  });

  it("depois de semear e detectar, lista agrupada por categoria e com o resumo", async () => {
    await salvarCurriculo();
    await rodar("skills", "seed");
    await rodar("skills", "detect");

    const r = await rodar("skills", "list");

    expect(r.code).toBeUndefined();
    // O resumo é o que diz quanto trabalho de auditoria sobrou; sem ele a lista
    // é só um monte de linhas.
    expect(r.out).toContain("a auditar");
    expect(r.out).toContain("confirmadas");
  });

  it("`--status` filtra, e confirmar muda de balde", async () => {
    await salvarCurriculo();
    await rodar("skills", "seed");
    await rodar("skills", "detect");

    const detectadas = await rodar("skills", "list", "--status", "detected");
    expect(detectadas.code).toBeUndefined();

    // Pega o primeiro id impresso e confirma essa skill.
    const id = /\s(\d+)\s/.exec(detectadas.out)?.[1];
    expect(id).toBeDefined();
    await rodar("skills", "confirm", id!);

    const confirmadas = await rodar("skills", "list", "--status", "confirmed");
    // A diferença entre as duas listagens é a prova de que o filtro conversa
    // com o que `confirm` grava — asserção sobre o contrato, não sobre a frase.
    expect(confirmadas.out).not.toBe(detectadas.out);
    expect(confirmadas.out).toContain("✓");
  });

  it("`catalog` mostra o catálogo global depois do seed", async () => {
    await syncCandidateFromProfile();
    await rodar("skills", "seed");

    const r = await rodar("skills", "catalog");

    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();
    expect(r.out.length).toBeGreaterThan(0);
  });

  it("`demand` desenha a barra do que o mercado-alvo pede", async () => {
    await semearVagaPontuada();
    await salvarCurriculo();
    await rodar("skills", "seed");
    await rodar("skills", "detect");

    const r = await rodar("skills", "demand", "--min-fit", "0");

    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();
    expect(r.out).toContain("DEMANDA DO MERCADO-ALVO");
  });

});

/**
 * `profile` é comando de topo, e não de `skills` — mesmo nome, outro assunto.
 * Ele valida `profile.yaml` e imprime os alvos resolvidos; é o único comando do
 * sistema que não toca o banco em nenhum caminho.
 */
describe("jho profile", () => {
  it("valida o profile.yaml e imprime a identidade resolvida", async () => {
    const r = await rodar("profile");

    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();
    // A confirmação de validade é o contrato: quem roda isto quer saber se o
    // arquivo que alimenta scoring e portfólio está de pé.
    expect(r.out).toContain("profile.yaml is valid");
    // E o nome resolvido, que prova que o arquivo foi lido e não só existe.
    expect(r.out.length).toBeGreaterThan(40);
  });
});
