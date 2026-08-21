/**
 * Suíte: os comandos de `src/cli.ts` que **só leem o acervo e imprimem** —
 * `jobs list`, `jobs show`, `pipeline`, `referrals` e `prep`.
 *
 * ## Por que eles ficaram de fora do primeiro corte, e por que entram agora
 *
 * O argumento original do E-08 era: cobrir o que escreve, deixar de fora o que
 * só imprime, porque asserir texto formatado congela a interface — o teste
 * passa a reprovar quando alguém troca uma coluna de lugar, que é exatamente o
 * tipo de mudança que deveria ser barata. O argumento continua válido, e a
 * consequência dele NÃO é "não teste"; é "não asserte o texto".
 *
 * Então o contrato verificado aqui é outro, e é o que de fato quebra em
 * produção:
 *
 *   1. o comando roda sem lançar e termina com `process.exitCode` limpo;
 *   2. cada flag chega ao lugar certo da consulta — provado por DIFERENÇA de
 *      resultado (com e sem a flag), não por comparação de string;
 *   3. o caminho de banco vazio não estoura nem mente;
 *   4. argumento inválido falha como erro de uso, não como travessia.
 *
 * Onde existe `--json`, a asserção é sobre o JSON: essa saída é contrato de
 * máquina, tem consumidor, e mudar o formato dela é quebra de verdade — ao
 * contrário do alinhamento de uma tabela de terminal.
 *
 * Fronteira DENTRO: tradução de argumento, filtros, defaults, ramos de
 * "vazio", código de saída. Fronteira FORA: rede (nenhum caso abre socket; as
 * URLs usadas não pertencem a nenhum ATS conhecido) e o layout das tabelas.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { syncCandidateFromProfile } from "../src/core/candidate.ts";
import { application, job, jobPage, jobScore, source } from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { banco, carregarCli, rodar } from "./cov-cli-harness.ts";

beforeAll(async () => {
  await carregarCli();
});

beforeEach(async () => {
  await useTestDb();
});

afterEach(() => {
  releaseTestDb();
});

/**
 * Descrição rica em palavras do `profile.yaml`, e longa de propósito.
 *
 * Longa porque `jobs show` corta em 1200 caracteres e o ramo de corte só
 * existe acima disso; rica porque o scorer real roda sobre este texto — sem
 * palavra-chave nenhuma a vaga cai abaixo do corte padrão de fit 45 e sumiria
 * das listagens que o teste quer justamente exercitar.
 */
const DESCRICAO_FORTE = [
  "We are hiring an AI Solutions Architect to own the software architecture of",
  "our agentic platform. You will design multi-agent systems, production ai",
  "pipelines with rag (retrieval augmented generation), llm orchestration,",
  "evals, guardrails and observability. Strong distributed systems and system",
  "design background required, plus technical leadership across squads.",
  "Stack: typescript, python, node, postgres, kubernetes, terraform, aws,",
  "docker, langchain, openai and anthropic. Multi-tenant saas, event-driven",
  "microservices, api design and platform engineering are part of the daily",
  "work. Fully remote, worldwide, contractor friendly, B2B accepted.",
].join(" ") + " Extra context about llmops, embeddings and reranking.".repeat(40);

/**
 * Currículo mínimo que diz "rag" e nunca "retrieval augmented generation".
 *
 * A grafia é o ponto: a vaga escreve por extenso, o CV escreve a sigla, e o
 * `prep` existe justamente para apontar essa diferença antes de a pessoa
 * enviar a candidatura para um filtro que compara strings.
 */
const CURRICULO_CURTO = [
  "Andreus Timm — Senior AI Software Architect.",
  "Plataformas com rag e agentes em produção, com evals e guardrails.",
  "Experiência com typescript, python e postgres em ambientes multi-tenant.",
  "Liderança técnica de squads distribuídos e mentoria de engenheiros.",
].join("\n");

/**
 * Texto da página capturada pelo robô — escrito para NÃO conter a sigla.
 *
 * A descrição do adaptador (`DESCRICAO_FORTE`) diz "rag (retrieval augmented
 * generation)", com as duas grafias, e nesse caso o termo de mercado empata
 * com o do CV e a lacuna de vocabulário desaparece. A página capturada vence a
 * descrição na análise, então é ela que fixa a assimetria que o caso mede.
 */
const PAGINA_CAPTURADA = [
  "About the role. You will own the architecture of our agentic platform,",
  "designing retrieval augmented generation pipelines that serve millions of",
  "requests. We expect strong distributed systems fundamentals, system design",
  "maturity and technical leadership across squads. Day to day you will work",
  "with typescript and python services deployed on kubernetes with terraform,",
  "instrumenting evals, guardrails and observability for every model call.",
  "Multi-tenant saas, event-driven microservices and platform engineering are",
  "part of the landscape. Remote worldwide, contractor friendly, B2B accepted.",
].join(" ");

/** Curta e sem nada do perfil: existe para cair fora do corte de fit. */
const DESCRICAO_FRACA =
  "WordPress developer for a small agency. Manual testing and sharepoint tickets.";

/** Dispara um bloqueador do `profile.yaml` (§ blockers, padrão US-only). */
const DESCRICAO_BLOQUEADA = [
  "Software Architect for our llm platform. You must be located in the united",
  "states and be authorized to work in the us. Agentic systems, rag, evals,",
  "guardrails, distributed systems, system design, typescript and python.",
].join(" ");

type Semente = {
  externo: string;
  empresa: string;
  titulo: string;
  descricao?: string | null;
  local?: string | null;
  fechadaEm?: string | null;
  applyUrl?: string | null;
  fonte?: string;
};

async function semearFonte(id: string, kind: string, handle: string, label: string): Promise<void> {
  await banco().insert(source).values({ id, kind, handle, label }).onConflictDoNothing();
}

async function semearVaga(s: Semente): Promise<number> {
  const fonte = s.fonte ?? "manual:teste";
  await semearFonte(fonte, fonte.split(":")[0]!, fonte.split(":")[1] ?? "", "Fonte de teste");
  const [linha] = await banco()
    .insert(job)
    .values({
      fingerprint: `fp-${s.externo}`,
      contentHash: `hash-${s.externo}`,
      sourceId: fonte,
      externalId: s.externo,
      companyName: s.empresa,
      title: s.titulo,
      descriptionText: s.descricao ?? null,
      locationRaw: s.local === undefined ? "Remote — Worldwide" : s.local,
      remote: true,
      url: `https://vagas.empresa-interna.test/${s.externo}`,
      applyUrl: s.applyUrl ?? null,
      // Recente para o componente de frescor não zerar e o fit não afundar.
      postedAt: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10),
      closedAt: s.fechadaEm ?? null,
      raw: {},
    })
    .returning({ id: job.id });
  return linha!.id;
}

/**
 * O acervo padrão dos casos: uma vaga forte, uma bloqueada, uma fraca e uma
 * fechada. Pontuadas pelo scorer REAL — nota inventada à mão não prova que o
 * filtro `--min-fit` conversa com o que o resto do sistema grava.
 */
async function semearAcervoPontuado(): Promise<{
  candidatoId: number;
  forte: number;
  bloqueada: number;
  fraca: number;
  fechada: number;
}> {
  const candidatoId = await syncCandidateFromProfile();
  const forte = await semearVaga({
    externo: "forte",
    empresa: "AlfaCorp",
    titulo: "AI Solutions Architect",
    descricao: DESCRICAO_FORTE,
    applyUrl: "https://vagas.empresa-interna.test/forte/apply",
  });
  const bloqueada = await semearVaga({
    externo: "bloqueada",
    empresa: "BetaCorp",
    titulo: "Software Architect",
    descricao: DESCRICAO_BLOQUEADA,
  });
  const fraca = await semearVaga({
    externo: "fraca",
    empresa: "GamaCorp",
    titulo: "WordPress Developer",
    descricao: DESCRICAO_FRACA,
  });
  const fechada = await semearVaga({
    externo: "fechada",
    empresa: "DeltaCorp",
    titulo: "AI Software Architect",
    descricao: DESCRICAO_FORTE,
    fechadaEm: new Date().toISOString(),
  });
  await rodar("jobs", "score");
  return { candidatoId, forte, bloqueada, fraca, fechada };
}

describe("jho jobs list", () => {
  it("sem candidato cadastrado, recusa em vez de listar o acervo de ninguém", async () => {
    // `activeCandidateId()` lança, e o `withDb` só fecha a conexão — o erro
    // sobe até o `parseAsync`. No terminal quem o converte em código 1 é o
    // `.catch` da guarda de entrypoint; aqui ele chega cru, e é isso que
    // precisa ser verdade: o comando NÃO devolve uma lista vazia fingindo
    // sucesso quando não sabe de quem é a lista.
    const r = await rodar("jobs", "list");
    expect(r.erro).toBeInstanceOf(Error);
    expect((r.erro as Error).message).toMatch(/Candidato padrão não cadastrado/);
  });

  it("com candidato e acervo vazio, imprime o relatório vazio e sai com sucesso", async () => {
    await syncCandidateFromProfile();
    const r = await rodar("jobs", "list");
    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();
    // Banco vazio não é erro: é a primeira tela de quem acabou de instalar.
    expect(r.out.length).toBeGreaterThan(0);
  });

  it("aplica o corte de fit padrão: a vaga fora do eixo não aparece, a forte sim", async () => {
    const { forte } = await semearAcervoPontuado();

    const padrao = await rodar("jobs", "list");
    expect(padrao.code).toBeUndefined();
    expect(padrao.out).toContain("AlfaCorp");
    // GamaCorp é WordPress + testes manuais: o perfil pune, o fit fica abaixo
    // do corte 45 e ela não deve ocupar linha na tela de trabalho diária.
    expect(padrao.out).not.toContain("GamaCorp");

    // A prova de que o corte é o corte, e não um acaso do scorer: baixando-o
    // a mesma vaga entra. Isto afirma o caminho do argumento até a consulta
    // sem depender de nenhuma coluna da tabela.
    const semCorte = await rodar("jobs", "list", "--min-fit", "0");
    expect(semCorte.out).toContain("GamaCorp");
    expect(semCorte.out).toContain("AlfaCorp");

    // E a vaga forte continua sendo a mesma linha do banco.
    const [nota] = await banco().select().from(jobScore).where(eq(jobScore.jobId, forte));
    expect(nota!.fit).toBeGreaterThanOrEqual(45);
  });

  it("nunca lista vaga fechada, com ou sem corte", async () => {
    await semearAcervoPontuado();
    const r = await rodar("jobs", "list", "--min-fit", "0");
    // Vaga fechada é histórico. Mostrá-la custa uma candidatura enviada para
    // um anúncio que não existe mais — o único erro desta tela que gasta o
    // tempo de outra pessoa.
    expect(r.out).not.toContain("DeltaCorp");
  });

  it("`--limit` corta o número de linhas, e o corte é sobre o resultado final", async () => {
    await semearAcervoPontuado();
    const um = await rodar("jobs", "list", "--min-fit", "0", "--limit", "1", "--json");
    const muitos = await rodar("jobs", "list", "--min-fit", "0", "--limit", "10", "--json");
    expect(JSON.parse(um.out)).toHaveLength(1);
    // O comando pede `limit * 3` ao repositório e fatia depois, porque o filtro
    // de cluster é aplicado em memória. Se a fatia sumisse, este caso ficaria
    // com 3 linhas.
    expect(JSON.parse(muitos.out).length).toBeGreaterThan(1);
  });

  it("`--cluster` filtra em memória, depois da consulta", async () => {
    await semearAcervoPontuado();
    const todos = JSON.parse((await rodar("jobs", "list", "--min-fit", "0", "--json")).out) as
      Array<{ cluster: string | null; companyName: string }>;
    const cluster = todos.find((linha) => linha.cluster)?.cluster;
    expect(cluster).toBeTruthy();

    const filtrado = await rodar("jobs", "list", "--min-fit", "0", "--cluster", cluster!, "--json");
    const linhas = JSON.parse(filtrado.out) as Array<{ cluster: string | null }>;
    expect(linhas.length).toBeGreaterThan(0);
    expect(linhas.every((linha) => linha.cluster === cluster)).toBe(true);

    // Cluster inexistente devolve lista vazia — e sai com sucesso, porque
    // "nenhuma vaga deste tipo" é uma resposta, não uma falha.
    const vazio = await rodar("jobs", "list", "--min-fit", "0", "--cluster", "nao-existe", "--json");
    expect(JSON.parse(vazio.out)).toEqual([]);
    expect(vazio.code).toBeUndefined();
  });

  it("`--status` aceita um estado do funil, mais `unfiled` e `any`", async () => {
    const { forte } = await semearAcervoPontuado();
    await rodar("track", String(forte), "shortlisted");

    const triadas = JSON.parse(
      (await rodar("jobs", "list", "--min-fit", "0", "--status", "shortlisted", "--json")).out,
    ) as Array<{ jobId: number }>;
    expect(triadas.map((linha) => linha.jobId)).toEqual([forte]);

    // `unfiled` não é um estado gravado em lugar nenhum: é a ausência de
    // candidatura. O comando o traduz para `application.id is null`, e é essa
    // tradução — que não existe no domínio — que precisa de teste.
    const naoTriadas = JSON.parse(
      (await rodar("jobs", "list", "--min-fit", "0", "--status", "unfiled", "--json")).out,
    ) as Array<{ jobId: number }>;
    expect(naoTriadas.map((linha) => linha.jobId)).not.toContain(forte);
    expect(naoTriadas.length).toBeGreaterThan(0);

    // `any` é o mesmo que não filtrar; existe para quem escreve script.
    const qualquer = JSON.parse(
      (await rodar("jobs", "list", "--min-fit", "0", "--status", "any", "--json")).out,
    ) as unknown[];
    const semFiltro = JSON.parse((await rodar("jobs", "list", "--min-fit", "0", "--json")).out) as unknown[];
    expect(qualquer).toHaveLength(semFiltro.length);
  });

  it("`--status` desconhecido é erro, e o erro diz quais valores existem", async () => {
    await semearAcervoPontuado();
    const r = await rodar("jobs", "list", "--status", "entrevistado");
    // "entrevistado" é o que um falante de português tentaria; o estado real é
    // `interviewing`. Cair calado numa lista vazia seria pior que falhar: a
    // pessoa concluiria que não tem nenhuma entrevista.
    expect(r.erro).toBeInstanceOf(Error);
    expect((r.erro as Error).message).toContain("interviewing");
  });

  it("`--json` é contrato de máquina: as linhas são as mesmas da tela", async () => {
    const { forte } = await semearAcervoPontuado();
    const r = await rodar("jobs", "list", "--min-fit", "0", "--json");
    expect(r.code).toBeUndefined();

    const linhas = JSON.parse(r.out) as Array<{ jobId: number; fit: number | null; companyName: string }>;
    const naBase = await banco().select().from(job);
    // Todo id devolvido existe, nenhuma vaga fechada entra, e a nota é a
    // gravada — três coisas que a tabela de terminal também promete, mas que
    // só aqui podem ser asseridas sem congelar o layout.
    expect(linhas.length).toBe(naBase.filter((v) => v.closedAt === null).length);
    const forteJson = linhas.find((linha) => linha.jobId === forte);
    expect(forteJson?.companyName).toBe("AlfaCorp");
  });

  it("flag inexistente falha como erro de uso do Commander", async () => {
    await syncCandidateFromProfile();
    const r = await rodar("jobs", "list", "--fit-minimo", "50");
    expect((r.erro as { code?: string }).code).toBe("commander.unknownOption");
    // O texto de uso sai pelo canal do Commander, não por console.log — sem
    // isto a pessoa recebe o erro sem saber qual flag existe.
    expect(r.uso).toContain("--fit-minimo");
  });

  it("na tabela, a vaga já triada mostra o estado ao lado", async () => {
    const { forte } = await semearAcervoPontuado();
    await rodar("track", String(forte), "shortlisted");

    const r = await rodar("jobs", "list", "--min-fit", "0");
    expect(r.code).toBeUndefined();
    // A coluna de estado é o que evita candidatar-se duas vezes à mesma vaga:
    // sem ela a lista de trabalho e o funil viram duas verdades separadas.
    const linha = r.out.split("\n").find((l) => l.includes("AlfaCorp"))!;
    expect(linha).toContain("shortlisted");
  });

  it("vaga ainda não pontuada aparece com fit em branco, não com zero", async () => {
    await semearAcervoPontuado();
    // Inserida depois do `jobs score`: é o estado de toda vaga entre o `sync`
    // e o `score` seguinte, que na prática é metade do acervo depois de uma
    // varredura noturna.
    await semearVaga({ externo: "sem-nota", empresa: "SigmaCorp", titulo: "Staff Engineer" });

    const r = await rodar("jobs", "list", "--min-fit", "0");
    expect(r.code).toBeUndefined();
    expect(r.out).toContain("SigmaCorp");

    // "sem nota" e "nota zero" são coisas diferentes: a primeira pede um
    // `jobs score`, a segunda pede esquecer a vaga. Imprimir 0 nas duas
    // apagaria a distinção justamente onde ela decide o próximo comando.
    const linha = r.out.split("\n").find((l) => l.includes("SigmaCorp"))!;
    expect(linha).toContain("—");
    expect(linha).not.toMatch(/\b0\b/);
  });

  it("o apelido `ls` é o mesmo comando", async () => {
    await semearAcervoPontuado();
    const porApelido = await rodar("jobs", "ls", "--min-fit", "0", "--json");
    const porNome = await rodar("jobs", "list", "--min-fit", "0", "--json");
    expect(JSON.parse(porApelido.out)).toEqual(JSON.parse(porNome.out));
  });
});

describe("jho jobs show <id>", () => {
  it("imprime a vaga com nota, bloqueios e estado de funil", async () => {
    const { bloqueada } = await semearAcervoPontuado();
    await rodar("track", String(bloqueada), "shortlisted");

    const r = await rodar("jobs", "show", String(bloqueada));
    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();
    // Identificadores, não formatação: se a consulta tivesse ido para a vaga
    // errada nenhum destes apareceria, e é isso que o caso mede.
    expect(r.out).toContain("BetaCorp");
    expect(r.out).toContain("shortlisted");

    // A vaga tem bloqueador de perfil (US-only). O texto renderizado depende
    // do i18n; o que se afirma é que ele saiu do banco e chegou à tela.
    const [nota] = await banco().select().from(jobScore).where(eq(jobScore.jobId, bloqueada));
    expect((nota!.blockers as unknown[]).length).toBeGreaterThan(0);
  });

  it("imprime nota, próximo passo e data da candidatura quando existem", async () => {
    const { forte } = await semearAcervoPontuado();
    await rodar("track", String(forte), "applied", "-n", "enviado pelo site");
    // `notes`, `nextAction` e `nextActionAt` entram pela UI, não pela CLI — o
    // comando é a única forma de LÊ-LOS no terminal, e cada um tem ramo
    // próprio. Sem dado neles, três `if` ficam mortos e o dia em que a UI
    // parasse de gravá-los ninguém notaria por aqui.
    await banco()
      .update(application)
      .set({
        notes: "enviado pelo site",
        nextAction: "follow-up com a recrutadora",
        nextActionAt: "2026-09-01T12:00:00.000Z",
      })
      .where(eq(application.jobId, forte));

    const r = await rodar("jobs", "show", String(forte));
    expect(r.code).toBeUndefined();
    expect(r.out).toContain("enviado pelo site");
    expect(r.out).toContain("follow-up com a recrutadora");
    expect(r.out).toContain("2026-09-01");
  });

  it("nota sem palavras casadas nem faltantes não imprime as duas listas", async () => {
    const { candidatoId } = await semearAcervoPontuado();
    const nua = await semearVaga({ externo: "nua", empresa: "IotaCorp", titulo: "Staff Engineer" });
    // Nota montada à mão com os vetores vazios: é o estado de uma vaga cuja
    // descrição o `sync` não trouxe, e o comando não pode imprimir cabeçalho
    // de lista para lista nenhuma.
    await banco().insert(jobScore).values({
      candidateId: candidatoId,
      jobId: nua,
      fit: 50, titleScore: 20, keywordScore: 10, seniorityScore: 5,
      geoScore: 10, compScore: 0, cluster: "architect",
      matchedKeywords: [], missingKeywords: [], reasons: [], blockers: [],
      scorerVersion: "teste",
    });
    // Próximo passo SEM data: o prazo é opcional e a linha tem de sair mesmo
    // assim — do contrário um lembrete sem data vira lembrete invisível.
    await rodar("track", String(nua), "shortlisted");
    await banco()
      .update(application)
      .set({ nextAction: "pedir indicação" })
      .where(eq(application.jobId, nua));

    const r = await rodar("jobs", "show", String(nua));
    expect(r.code).toBeUndefined();
    expect(r.out).toContain("pedir indicação");
    expect(r.out).not.toContain("Matched:");
    expect(r.out).not.toContain("Missing:");
  });

  it("corta a descrição em 1200 caracteres, e `--full` desliga o corte", async () => {
    const { forte } = await semearAcervoPontuado();

    const cortado = await rodar("jobs", "show", String(forte));
    const inteiro = await rodar("jobs", "show", String(forte), "--full");

    // O corte não é enfeite: a descrição média do acervo real tem ~7.400
    // caracteres e despejá-la inteira torna o comando ilegível. A asserção é
    // sobre TAMANHO relativo, que sobrevive a qualquer mudança de layout.
    expect(DESCRICAO_FORTE.length).toBeGreaterThan(2400);
    // A diferença entre as duas saídas é o pedaço que ficou de fora, e ela tem
    // de ser da ordem do texto suprimido — não de uma linha a mais.
    expect(inteiro.out.length - cortado.out.length).toBeGreaterThan(1000);
  });

  it("vaga sem nota, sem candidatura, sem descrição e sem local ainda imprime", async () => {
    await semearAcervoPontuado();
    // Inserida DEPOIS do `jobs score`: fica sem linha em `job_score`, que é o
    // estado real de toda vaga entre o `sync` e o `score` seguinte.
    const crua = await semearVaga({
      externo: "crua",
      empresa: "EpsilonCorp",
      titulo: "Backend Engineer",
      descricao: null,
      local: null,
    });

    const r = await rodar("jobs", "show", String(crua));
    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();
    expect(r.out).toContain("EpsilonCorp");
  });

  it("marca a vaga fechada como fechada", async () => {
    const { fechada } = await semearAcervoPontuado();
    const r = await rodar("jobs", "show", String(fechada));
    expect(r.code).toBeUndefined();
    // `jobs list` esconde a fechada; `jobs show` a mostra e avisa. São
    // decisões opostas de propósito: a lista é para agir, a ficha é para
    // entender por que aquele link não abre mais.
    expect(r.out).toContain("CLOSED");
  });

  it("id inexistente sai com código 1 e diz que não achou", async () => {
    await syncCandidateFromProfile();
    const r = await rodar("jobs", "show", "9999");
    expect(r.code).toBe(1);
    expect(r.err).toContain("9999");
  });

  /**
   * Este caso já foi uma caracterização de defeito, e a nota dizia: "no dia em
   * que a validação entrar, este é o teste que reprova". Entrou, ele reprovou,
   * e agora afirma a correção.
   *
   * O defeito era `Number("abc")` = NaN chegando ao driver como bind inválido.
   * Saía um `DrizzleQueryError` cujo `message` é o SELECT inteiro, impresso em
   * vermelho no terminal de quem só errou o id — enquanto o ramo educado ficava
   * logo abaixo, inalcançável, porque a exceção acontecia antes da consulta.
   */
  it("id não numérico é recusado sem vazar consulta nenhuma", async () => {
    await syncCandidateFromProfile();
    const r = await rodar("jobs", "show", "abc");

    // Sem exceção escapando: quem digita errado recebe uma frase, não um dump.
    expect(r.erro).toBeUndefined();
    expect(r.code).toBe(1);
    expect(r.err).toContain("abc");
    // A asserção que dá o nome ao defeito. `select` viria do SQL vazado;
    // `Failed query` é a moldura que o Drizzle põe em volta dele.
    expect(`${r.err}${r.out}`.toLowerCase()).not.toContain("select");
    expect(`${r.err}${r.out}`).not.toContain("Failed query");
  });

  it("id fracionário e negativo também são recusados", async () => {
    await syncCandidateFromProfile();
    // Todo id do sistema é `integer primary key autoincrement`, que começa em 1.
    // Aceitar "1.5" ou "-3" só adiaria a mesma confusão para dentro da consulta.
    for (const invalido of ["1.5", "-3", "0"]) {
      const r = await rodar("jobs", "show", invalido);
      expect(r.code).toBe(1);
      expect(r.erro).toBeUndefined();
    }
  });

  it("sem o argumento obrigatório, é erro de uso", async () => {
    const r = await rodar("jobs", "show");
    expect((r.erro as { code?: string }).code).toBe("commander.missingArgument");
  });
});

describe("jho pipeline", () => {
  it("sem candidato, recusa", async () => {
    const r = await rodar("pipeline");
    expect(r.erro).toBeInstanceOf(Error);
  });

  it("com o funil vazio, imprime o convite a começar e sai com sucesso", async () => {
    await syncCandidateFromProfile();
    const r = await rodar("pipeline");
    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();
    expect(r.out.length).toBeGreaterThan(0);
  });

  it("lista as candidaturas e o próximo passo de cada uma", async () => {
    const { candidatoId, forte, bloqueada } = await semearAcervoPontuado();
    await rodar("track", String(forte), "shortlisted");
    await rodar("track", String(bloqueada), "shortlisted");
    // `next_action` não tem comando próprio; entra pela UI. O funil o imprime,
    // então o ramo existe e precisa de dado para ser andado.
    await banco()
      .update(application)
      .set({ nextAction: "responder o recrutador" })
      .where(eq(application.jobId, forte));

    const r = await rodar("pipeline");
    expect(r.code).toBeUndefined();
    expect(r.out).toContain("AlfaCorp");
    expect(r.out).toContain("responder o recrutador");

    const linhas = await banco()
      .select()
      .from(application)
      .where(eq(application.candidateId, candidatoId));
    expect(linhas).toHaveLength(2);
  });

  it("`--json` devolve contagens e candidaturas juntas", async () => {
    const { forte } = await semearAcervoPontuado();
    await rodar("track", String(forte), "shortlisted");

    const r = await rodar("pipeline", "--json");
    expect(r.code).toBeUndefined();
    const payload = JSON.parse(r.out) as {
      counts: Record<string, number>;
      applications: Array<{ id: number; status: string }>;
    };
    // As duas metades no mesmo objeto são o contrato: um consumidor que
    // recebesse só a lista teria de recontar por status, e recontar é onde as
    // duas visões divergem.
    expect(payload.counts.shortlisted).toBe(1);
    expect(payload.applications).toHaveLength(1);
    expect(payload.applications[0]!.status).toBe("shortlisted");
  });
});

describe("jho referrals", () => {
  it("sem nenhum contato, explica como cadastrar o primeiro", async () => {
    await semearAcervoPontuado();
    const r = await rodar("referrals");
    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();
    // Dois vazios diferentes com mensagens diferentes: "você não tem contato"
    // e "você tem contato mas nenhum abriu vaga" pedem ações opostas, e o
    // comando ramifica exatamente aí.
    expect(r.out).toContain("contacts add");
  });

  it("com contato em empresa sem vaga aberta, diz que a rede existe mas não bate", async () => {
    await semearAcervoPontuado();
    await rodar("contacts", "add", "Ana Lima", "-c", "OmegaCorp", "-k", "former");

    const r = await rodar("referrals");
    expect(r.code).toBeUndefined();
    expect(r.out).not.toContain("contacts add");
  });

  it("lista a vaga onde já existe alguém conhecido, com e sem estado de funil", async () => {
    const { forte, bloqueada } = await semearAcervoPontuado();
    await rodar("contacts", "add", "Rafael Souza", "-c", "AlfaCorp", "-k", "former");
    await rodar("contacts", "add", "Marina Reis", "-c", "BetaCorp", "-k", "peer");
    await rodar("track", String(bloqueada), "shortlisted");
    void forte;

    const r = await rodar("referrals", "--min-fit", "0");
    expect(r.code).toBeUndefined();
    expect(r.out).toContain("Rafael Souza");
    // A vaga já triada aparece com o estado ao lado — o ramo `o.status` do
    // comando. Sem ele a pessoa pediria indicação para algo já respondido.
    expect(r.out).toContain("shortlisted");
  });

  it("`--json` devolve as oportunidades com os contatos de cada uma", async () => {
    const { forte } = await semearAcervoPontuado();
    await rodar("contacts", "add", "Rafael Souza", "-c", "AlfaCorp", "-k", "former");

    const r = await rodar("referrals", "--min-fit", "0", "--json");
    const oportunidades = JSON.parse(r.out) as Array<{ jobId: number; contacts: string[] }>;
    const alvo = oportunidades.find((o) => o.jobId === forte);
    // O domínio anexa "(ex-colega)" ao nome de quem é categoria `former`, e
    // esse rótulo é dele, não do comando: o teste afirma que o contato certo
    // chegou ao JSON, sem congelar a decoração.
    expect(alvo?.contacts.some((nome) => nome.startsWith("Rafael Souza"))).toBe(true);
  });

  it("`--min-fit` alto esvazia a lista sem transformar isso em erro", async () => {
    await semearAcervoPontuado();
    await rodar("contacts", "add", "Rafael Souza", "-c", "AlfaCorp", "-k", "former");

    const r = await rodar("referrals", "--min-fit", "200", "--json");
    expect(r.code).toBeUndefined();
    expect(JSON.parse(r.out)).toEqual([]);
  });
});

describe("jho prep <id>", () => {
  it("vaga inexistente sai com código 1", async () => {
    await semearAcervoPontuado();
    const r = await rodar("prep", "9999");
    expect(r.code).toBe(1);
    expect(r.err).toContain("9999");
  });

  it("monta o dossiê da vaga com bloqueios, rede e vocabulário", async () => {
    const { bloqueada } = await semearAcervoPontuado();
    await rodar("contacts", "add", "Marina Reis", "-c", "BetaCorp", "-k", "peer");

    const r = await rodar("prep", String(bloqueada));
    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();
    // A rede na empresa é a informação mais cara da tela: uma indicação vale
    // cerca de dez candidaturas frias, e o comando fecha sugerindo
    // `--channel referral` justamente quando ela existe.
    expect(r.out).toContain("Marina Reis");
    expect(r.out).toContain("referral");
  });

  it("com currículo salvo e página capturada, cruza vocabulário e lista requisitos", async () => {
    const { forte } = await semearAcervoPontuado();
    // O cruzamento de vocabulário compara contra o CATÁLOGO de skills; sem
    // ele todo termo é desconhecido e as duas seções saem vazias.
    await rodar("skills", "seed");
    // O CV escreve "rag"; a descrição da vaga escreve por extenso. É essa
    // assimetria que produz a seção "Trocar a palavra" — a experiência está
    // documentada e só a grafia difere, que é o conserto mais barato que
    // existe num currículo.
    const dir = await mkdtemp(join(tmpdir(), "jho-cv-"));
    const caminho = join(dir, "cv.md");
    await writeFile(caminho, CURRICULO_CURTO, "utf8");
    await rodar("cv", "set", caminho);

    // A página capturada vence a descrição do adaptador na análise, e é a
    // única origem de `requirements` — o robô é quem os extrai.
    await banco().insert(jobPage).values({
      jobId: forte,
      finalUrl: "https://vagas.empresa-interna.test/forte",
      httpStatus: 200,
      text: PAGINA_CAPTURADA,
      extracted: { requirements: ["8+ anos em arquitetura", "Inglês fluente"] },
      contentHash: "hash-pagina",
      parsedAt: new Date().toISOString(),
    });

    const r = await rodar("prep", String(forte));
    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();
    expect(r.out).toContain("Trocar a palavra");
    expect(r.out).toContain("Pedem e o CV não mostra");
    expect(r.out).toContain("8+ anos em arquitetura");
  });

  it("vaga sem local declarado não imprime local vazio", async () => {
    await semearAcervoPontuado();
    const semLocal = await semearVaga({
      externo: "sem-local",
      empresa: "KappaCorp",
      titulo: "AI Solutions Architect",
      descricao: DESCRICAO_FORTE,
      local: null,
    });
    await rodar("jobs", "score");

    const r = await rodar("prep", String(semLocal));
    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();
    expect(r.out).toContain("KappaCorp");
  });

  it("sem descrição suficiente, avisa em vez de inventar lacuna", async () => {
    await semearAcervoPontuado();
    const magra = await semearVaga({
      externo: "magra",
      empresa: "ZetaCorp",
      titulo: "AI Engineer",
      descricao: "Curta demais para analisar.",
    });

    const r = await rodar("prep", String(magra));
    expect(r.code).toBeUndefined();
    // O aviso é o produto aqui. Comparar vocabulário contra 30 caracteres
    // produziria uma lista de "lacunas" que são só ausência de texto, e a
    // pessoa reescreveria o CV com base em ruído.
    expect(r.out).toContain("scrape");
  });

  it("sem currículo salvo, ainda roda e avisa que não há como cruzar vocabulário", async () => {
    const { forte } = await semearAcervoPontuado();
    const r = await rodar("prep", String(forte));
    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();
    expect(r.out).toContain("currículo");
  });

  it("sem o argumento obrigatório, é erro de uso", async () => {
    const r = await rodar("prep");
    expect((r.erro as { code?: string }).code).toBe("commander.missingArgument");
  });
});
