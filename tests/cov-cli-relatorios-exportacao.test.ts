/**
 * Suíte: os comandos de `src/cli.ts` que produzem **análise e exportação** —
 * `report`, `dossiers`, `cv gap`, `skills gap` e `stats`.
 *
 * ## Por que estes cinco andam juntos
 *
 * Todos leem o acervo já pontuado e devolvem um artefato: um markdown no
 * vault, uma pasta de dossiês, uma lista de lacunas, um diagnóstico
 * estatístico. Nenhum altera o funil. O que pode dar errado neles não é o
 * conteúdo — as funções de domínio (`buildReport`, `exportDossiers`,
 * `analyseGap`, `vocabularyGap`, `scorerDiagnostics`, `funnelAnalysis`) têm
 * suíte própria — e sim a faixa que `cli.ts` monta em volta: para ONDE o
 * arquivo vai, qual corte foi usado, e o que a tela faz quando a análise volta
 * vazia.
 *
 * ## O destino do arquivo é a parte perigosa
 *
 * `report` e `dossiers` decidem o caminho com uma cadeia de precedência que só
 * existe aqui: `--stdout` vence tudo, depois `--out`, depois
 * `JHO_VAULT_PATH` + `JHO_REPORT_DIR`, e por fim um default. Errar essa ordem
 * escreve o relatório num lugar que a pessoa não abre — falha silenciosa, do
 * tipo que ninguém percebe até precisar do arquivo.
 *
 * ## `stats` e o dever de não fabricar conclusão
 *
 * O diagnóstico muda de forma conforme o tamanho da amostra: abaixo de 10
 * candidaturas ele avisa que a taxa não distingue nada, abaixo de 30 esconde
 * os recortes por cluster/fonte/canal, e só acima disso os mostra. Esses três
 * regimes são ramos de `cli.ts` tanto quanto do domínio, e os casos abaixo
 * andam os três.
 *
 * Fronteira DENTRO: precedência de caminho, criação de diretório, cortes,
 * ramos de amostra insuficiente, código de saída. Fronteira FORA: rede, e o
 * texto do markdown gerado.
 */
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { syncCandidateFromProfile } from "../src/core/candidate.ts";
import { application, job, jobScore, source } from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { banco, carregarCli, rodar } from "./cov-cli-harness.ts";

const AMBIENTE_TOCADO = ["JHO_VAULT_PATH", "JHO_REPORT_DIR"] as const;
let ambienteOriginal: Record<string, string | undefined> = {};

beforeAll(async () => {
  await carregarCli();
});

beforeEach(async () => {
  ambienteOriginal = Object.fromEntries(AMBIENTE_TOCADO.map((k) => [k, process.env[k]]));
  // O vault do desenvolvedor não pode ser destino de teste: `report` sem
  // `--out` grava direto nele se a variável estiver definida no ambiente.
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

async function pastaTemporaria(prefixo: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefixo));
}

async function existe(caminho: string): Promise<boolean> {
  try {
    await stat(caminho);
    return true;
  } catch {
    return false;
  }
}

/**
 * Descrição que fala a língua do `profile.yaml` e do catálogo de skills.
 *
 * Escrita com uma armadilha deliberada: diz "retrieval augmented generation"
 * por extenso e nunca "rag". O currículo abaixo faz o contrário. É essa
 * assimetria que produz um "ganho rápido" no `skills gap` — a experiência
 * existe, só está escrita com outra palavra — e sem ela o comando cairia
 * sempre no ramo de "nenhuma lacuna de vocabulário".
 */
const DESCRICAO_ALVO = [
  "AI Solutions Architect. Software architecture for agentic platforms with",
  "multi-agent orchestration, retrieval augmented generation pipelines, evals,",
  "guardrails, observability and llm routing. Distributed systems, system",
  "design, technical leadership, multi-tenant saas, event-driven microservices,",
  "platform engineering. Stack: typescript, python, postgres, kubernetes,",
  "terraform, aws, docker. Fully remote worldwide, contractor friendly.",
].join(" ");

/** Diz "rag" e nunca "retrieval augmented generation"; não diz kubernetes. */
const CURRICULO = [
  "Andreus Timm — Senior AI Software Architect.",
  "Construí plataformas com rag e agentes em produção, com evals e guardrails.",
  "Experiência com typescript, python e postgres em ambientes multi-tenant.",
  "Liderança técnica de squads distribuídos, arquitetura de sistemas e mentoria.",
].join("\n");

async function semearFonte(id: string): Promise<void> {
  const [kind, handle] = id.split(":");
  await banco()
    .insert(source)
    .values({ id, kind: kind!, handle: handle ?? "", label: `Fonte ${id}` })
    .onConflictDoNothing();
}

async function semearVagaAlvo(externo: string, empresa: string, fonte = "manual:teste"): Promise<number> {
  await semearFonte(fonte);
  const [linha] = await banco()
    .insert(job)
    .values({
      fingerprint: `fp-${externo}`,
      contentHash: `hash-${externo}`,
      sourceId: fonte,
      externalId: externo,
      companyName: empresa,
      title: "AI Solutions Architect",
      descriptionText: DESCRICAO_ALVO,
      locationRaw: "Remote — Worldwide",
      remote: true,
      url: `https://vagas.empresa-interna.test/${externo}`,
      postedAt: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10),
      raw: {},
    })
    .returning({ id: job.id });
  return linha!.id;
}

/** Duas vagas fortes, pontuadas pelo scorer real, e o candidato do perfil. */
async function semearAcervo(): Promise<{ candidatoId: number; vagas: number[] }> {
  const candidatoId = await syncCandidateFromProfile();
  const vagas = [
    await semearVagaAlvo("alvo-1", "AlfaCorp"),
    await semearVagaAlvo("alvo-2", "BetaCorp"),
  ];
  await rodar("jobs", "score");
  return { candidatoId, vagas };
}

async function salvarCurriculo(): Promise<void> {
  const dir = await pastaTemporaria("jho-cv-");
  const caminho = join(dir, "cv.md");
  await writeFile(caminho, CURRICULO, "utf8");
  await rodar("cv", "set", caminho);
}

describe("jho report", () => {
  it("sem candidato, recusa em vez de exportar o acervo de ninguém", async () => {
    const r = await rodar("report", "--stdout");
    expect(r.erro).toBeInstanceOf(Error);
  });

  it("`--stdout` imprime e não escreve, mesmo com vault configurado", async () => {
    await semearAcervo();
    const vault = await pastaTemporaria("jho-vault-");
    process.env.JHO_VAULT_PATH = vault;

    const r = await rodar("report", "--stdout");
    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();
    expect(r.out).toContain("AlfaCorp");
    // `--stdout` é a única forma de conferir o relatório antes de deixá-lo no
    // vault. Se ele escrevesse assim mesmo, "conferir" viraria "publicar".
    expect(await readdir(vault)).toEqual([]);
  });

  it("sem vault e sem `--out`, cai no stdout em vez de escolher um diretório", async () => {
    await semearAcervo();
    const r = await rodar("report");
    expect(r.code).toBeUndefined();
    // Escrever num caminho adivinhado seria pior que imprimir: o arquivo
    // existiria em algum lugar que ninguém abre.
    expect(r.out).toContain("AlfaCorp");
  });

  it("`--out` escreve exatamente onde foi mandado, criando o caminho", async () => {
    await semearAcervo();
    const dir = await pastaTemporaria("jho-report-");
    const destino = join(dir, "subpasta", "relatorio.md");

    const r = await rodar("report", "--out", destino);
    expect(r.code).toBeUndefined();
    expect(await existe(destino)).toBe(true);
    const conteudo = await readFile(destino, "utf8");
    expect(conteudo).toContain("AlfaCorp");
  });

  it("com vault configurado, o nome do arquivo carrega a data do dia", async () => {
    await semearAcervo();
    const vault = await pastaTemporaria("jho-vault-");
    process.env.JHO_VAULT_PATH = vault;
    process.env.JHO_REPORT_DIR = "relatorios";

    const r = await rodar("report");
    expect(r.code).toBeUndefined();

    const hoje = new Date().toISOString().slice(0, 10);
    const arquivos = await readdir(join(vault, "relatorios"));
    // Data no nome é o que torna o relatório uma série em vez de um arquivo
    // sobrescrito — no Obsidian a comparação entre semanas é o uso principal.
    expect(arquivos).toContain(`vagas-match-${hoje}.md`);
  });

  it("`--min-fit` alto esvazia o corpo do relatório sem quebrá-lo", async () => {
    await semearAcervo();
    const largo = await rodar("report", "--stdout", "--min-fit", "0");
    const estreito = await rodar("report", "--stdout", "--min-fit", "200");

    expect(estreito.code).toBeUndefined();
    expect(estreito.out).not.toContain("AlfaCorp");
    expect(largo.out).toContain("AlfaCorp");
  });

  it("`--limit` corta o número de vagas exportadas", async () => {
    await semearAcervo();
    const uma = await rodar("report", "--stdout", "--min-fit", "0", "--limit", "1");
    const duas = await rodar("report", "--stdout", "--min-fit", "0", "--limit", "2");
    expect(duas.out.length).toBeGreaterThan(uma.out.length);
  });

  it("flag inexistente falha como erro de uso", async () => {
    const r = await rodar("report", "--saida", "/tmp/x.md");
    expect((r.erro as { code?: string }).code).toBe("commander.unknownOption");
  });
});

describe("jho dossiers", () => {
  it("escreve um arquivo por vaga no diretório pedido", async () => {
    await semearAcervo();
    const dir = await pastaTemporaria("jho-dossies-");

    const r = await rodar("dossiers", "--min-fit", "0", "--out", dir);
    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();

    const arquivos = await readdir(dir);
    expect(arquivos).toHaveLength(2);
    // Frontmatter é o que torna o dossiê consultável no Obsidian; sem ele o
    // arquivo seria só um despejo de texto e o comando não teria motivo.
    const conteudo = await readFile(join(dir, arquivos[0]!), "utf8");
    expect(conteudo.startsWith("---")).toBe(true);
  });

  it("`--tracked` restringe ao que já está no funil", async () => {
    const { vagas } = await semearAcervo();
    await rodar("track", String(vagas[0]), "shortlisted");
    const dir = await pastaTemporaria("jho-dossies-");

    const r = await rodar("dossiers", "--min-fit", "0", "--tracked", "--out", dir);
    expect(r.code).toBeUndefined();
    // Sem o recorte, preparar três entrevistas significaria abrir uma pasta
    // com o acervo inteiro dentro.
    expect(await readdir(dir)).toHaveLength(1);
  });

  it("com vault configurado, escreve na subpasta `vagas` do vault", async () => {
    await semearAcervo();
    const vault = await pastaTemporaria("jho-vault-");
    process.env.JHO_VAULT_PATH = vault;
    process.env.JHO_REPORT_DIR = "relatorios";

    const r = await rodar("dossiers", "--min-fit", "0");
    expect(r.code).toBeUndefined();
    expect(await readdir(join(vault, "relatorios", "vagas"))).toHaveLength(2);
  });

  it("`--min-fit` alto produz zero dossiê, e isso não é erro", async () => {
    await semearAcervo();
    const dir = await pastaTemporaria("jho-dossies-");
    const r = await rodar("dossiers", "--min-fit", "200", "--out", dir);
    expect(r.code).toBeUndefined();
    expect(await readdir(dir)).toEqual([]);
  });

  /**
   * O último degrau da cadeia de destino: sem `--out` e sem vault, o comando
   * **recusa**.
   *
   * Antes ele caía em `<cwd>/out/vagas`. O problema não era o caminho: era ser
   * relativo a de onde a pessoa rodou. Rodar de outro diretório espalhava
   * dezenas de arquivos num lugar que ninguém procura depois, sem aviso — e o
   * `jho report`, logo acima no mesmo arquivo, já resolvia o mesmo dilema do
   * jeito certo, caindo no stdout em vez de escolher um destino.
   */
  it("sem vault e sem `--out`, recusa em vez de escolher um diretório", async () => {
    await semearAcervo();
    const raiz = join(process.cwd(), "out");
    const existiaAntes = await existe(raiz);

    try {
      const r = await rodar("dossiers", "--min-fit", "200");

      expect(r.code).toBe(1);
      // A recusa precisa dizer as duas saídas, senão vira um beco sem saída.
      expect(r.out).toContain("--out");
      expect(r.out).toContain("JHO_VAULT_PATH");
      // E não pode criar nada pelo caminho: o `mkdir` acontecia antes de
      // qualquer verificação, então a pasta nascia mesmo sem dossiê nenhum.
      if (!existiaAntes) expect(await existe(join(raiz, "vagas"))).toBe(false);
    } finally {
      if (!existiaAntes) await rm(raiz, { recursive: true, force: true });
    }
  });
});

describe("jho cv gap", () => {
  it("sem currículo salvo, manda salvar um em vez de analisar o vazio", async () => {
    await semearAcervo();
    const r = await rodar("cv", "gap");
    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();
    expect(r.out).toContain("cv set");
  });

  it("lista os termos que o mercado usa e o currículo não", async () => {
    await semearAcervo();
    await salvarCurriculo();

    const r = await rodar("cv", "gap", "--min-fit", "0");
    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();
    // "kubernetes" está na descrição das duas vagas-alvo e em nenhuma linha do
    // currículo: é exatamente o tipo de termo que o comando existe para
    // devolver, e o único que o candidato poderia perder por esquecimento.
    expect(r.out).toContain("kubernetes");
  });

  it("sem vaga acima do corte, não inventa lacuna", async () => {
    await semearAcervo();
    await salvarCurriculo();

    const r = await rodar("cv", "gap", "--min-fit", "200");
    expect(r.code).toBeUndefined();
    // Zero vaga no corpus significa cobertura zero para todo termo. Listar
    // "lacunas" nesse estado faria a pessoa reescrever o CV contra nada.
    expect(r.out).not.toContain("kubernetes");
  });
});

describe("jho skills gap", () => {
  it("sem currículo salvo, aponta o `cv set`", async () => {
    await semearAcervo();
    await rodar("skills", "seed");
    const r = await rodar("skills", "gap");
    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();
    expect(r.out).toContain("cv set");
  });

  it("sem vaga acima do corte, manda baixar o corte", async () => {
    await semearAcervo();
    await rodar("skills", "seed");
    await salvarCurriculo();

    const r = await rodar("skills", "gap", "--min-fit", "200");
    expect(r.code).toBeUndefined();
    expect(r.out).toContain("Baixe o corte");
  });

  it("separa ganho rápido (falta a palavra) de lacuna real (falta a coisa)", async () => {
    await semearAcervo();
    await rodar("skills", "seed");
    await salvarCurriculo();

    const r = await rodar("skills", "gap", "--min-fit", "0");
    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();

    // Ganho rápido: as vagas escrevem "retrieval augmented generation", o
    // currículo escreve "rag". A experiência está documentada — trocar a
    // palavra é grátis e um filtro de ATS passa a casar.
    expect(r.out).toContain("retrieval augmented generation");
    // Lacuna real: kubernetes aparece nas vagas e em nenhuma grafia no CV.
    // A distinção entre os dois blocos é a razão de o comando existir: um
    // pede reescrita, o outro pede estudo — e confundi-los produz currículo
    // mentiroso.
    expect(r.out).toContain("kubernetes");
    expect(r.out).not.toContain("Já coberto");
  });

  it("`--all` acrescenta o bloco do que já está coberto", async () => {
    await semearAcervo();
    await rodar("skills", "seed");
    await salvarCurriculo();

    const r = await rodar("skills", "gap", "--min-fit", "0", "--all");
    expect(r.code).toBeUndefined();
    // "typescript" está escrito igual dos dois lados: nem ganho rápido nem
    // lacuna. Só aparece quando se pede a conferência completa.
    expect(r.out).toContain("Já coberto");
    expect(r.out).toContain("typescript");
  });

  it("quando o CV já fala a língua do mercado, diz isso em vez de listar nada", async () => {
    const candidatoId = await syncCandidateFromProfile();
    // Corpus estreito de propósito: a vaga só pede "typescript" (que o CV
    // escreve igual) e "kubernetes" (que o CV não menciona em grafia nenhuma).
    // Não há termo onde as duas grafias divirjam, então não há ganho rápido.
    await semearFonte("manual:teste");
    await banco().insert(job).values({
      fingerprint: "fp-estreita",
      contentHash: "hash-estreita",
      sourceId: "manual:teste",
      externalId: "estreita",
      companyName: "OmegaCorp",
      title: "AI Solutions Architect",
      // 400 caracteres é o piso do corpus: anúncio curto demais diluiria toda
      // contagem de frequência sem trazer vocabulário nenhum. O recheio abaixo
      // é prosa neutra, escolhida para não conter nenhum termo do catálogo.
      descriptionText:
        "We need strong typescript engineers to run our kubernetes platform team. " +
        "The role is fully remote and the team works asynchronously across several " +
        "time zones. You will spend most of the week writing small changes, reviewing " +
        "the work of others and pairing with whoever is closest to the problem. We " +
        "prefer clear writing to long meetings, and we keep the number of moving " +
        "parts deliberately low so that being on call stays boring and predictable.",
      url: "https://vagas.empresa-interna.test/estreita",
      raw: {},
    });
    void candidatoId;
    await rodar("jobs", "score");
    await rodar("skills", "seed");
    await salvarCurriculo();

    const r = await rodar("skills", "gap", "--min-fit", "0");
    expect(r.code).toBeUndefined();
    // A ausência de ganho rápido é informação: significa que reescrever o CV
    // não compra nada e o próximo passo é estudar, não reformular.
    expect(r.out).toContain("Nenhuma lacuna de vocabulário");
    expect(r.out).toContain("kubernetes");

    // E quando o CV também cobre o que faltava, os DOIS blocos somem: a tela
    // fica com a cobertura e nada a fazer, que é o único desfecho em que o
    // comando não pede ação nenhuma.
    const dir = await pastaTemporaria("jho-cv-");
    const caminho = join(dir, "cv.md");
    await writeFile(caminho, `${CURRICULO}\nInfraestrutura em kubernetes desde 2019.`, "utf8");
    await rodar("cv", "set", caminho);

    const completo = await rodar("skills", "gap", "--min-fit", "0");
    expect(completo.code).toBeUndefined();
    expect(completo.out).toContain("Nenhuma lacuna de vocabulário");
    expect(completo.out).not.toContain("Lacuna real");
  });

  it("`--limit` é aceito e não altera o resultado quando o acervo cabe nele", async () => {
    await semearAcervo();
    await rodar("skills", "seed");
    await salvarCurriculo();

    const comTeto = await rodar("skills", "gap", "--min-fit", "0", "--limit", "1");
    const semTeto = await rodar("skills", "gap", "--min-fit", "0", "--limit", "400");
    expect(comTeto.code).toBeUndefined();
    // Com uma vaga só no corpus a demanda de cada termo continua 100%; o que
    // muda é o denominador impresso. A asserção é que o teto CHEGA à consulta.
    expect(comTeto.out).not.toBe(semTeto.out);
  });
});

describe("jho stats", () => {
  /**
   * Trinta e duas candidaturas com componentes fabricados à mão.
   *
   * Nota inventada aqui é deliberada, e é o oposto do que o resto desta suíte
   * faz. O `stats` não julga vaga nenhuma: ele julga o SCORER, e as perguntas
   * que responde — "este componente separa alguma coisa?", "estes dois medem
   * a mesma coisa?" — só têm resposta observável se a distribuição for
   * escolhida. Com o scorer real sobre duas vagas de teste, todo componente
   * sairia constante e os ramos interessantes ficariam mortos.
   *
   * O desenho:
   *   - `titleScore` cresce e `keywordScore` cresce junto → ρ=1, par
   *     redundante, que é o achado mais acionável do comando;
   *   - `compScore` e `benefitScore` constantes → peso morto, e `benefitScore`
   *     ainda produz correlação indefinida com o retorno (`ρ = —`);
   *   - `geoScore` no teto em 29 de 32 → saturado;
   *   - `seniorityScore` só 0 ou 10 → na prática uma flag;
   *   - `titleScore` sobrevive saudável, para o ramo verde também existir.
   */
  async function semearFunilGrande(): Promise<number> {
    const candidatoId = await syncCandidateFromProfile();
    await semearFonte("greenhouse:alfa");
    await semearFonte("lever:beta");

    const respondidos = ["screening", "interviewing", "offer", "rejected"] as const;
    const mudos = ["applied", "shortlisted"] as const;

    for (let i = 0; i < 32; i++) {
      const fonte = i % 2 === 0 ? "greenhouse:alfa" : "lever:beta";
      const [vaga] = await banco()
        .insert(job)
        .values({
          fingerprint: `fp-stats-${i}`,
          contentHash: `hash-stats-${i}`,
          sourceId: fonte,
          externalId: `stats-${i}`,
          companyName: `Empresa ${i}`,
          title: "AI Solutions Architect",
          descriptionText: DESCRICAO_ALVO,
          url: `https://vagas.empresa-interna.test/stats-${i}`,
          raw: {},
        })
        .returning({ id: job.id });

      await banco().insert(jobScore).values({
        candidateId: candidatoId,
        jobId: vaga!.id,
        fit: 40 + i,
        titleScore: i,
        // Cresce junto com o título: mesma ordenação, ρ = 1.
        keywordScore: i * 2,
        seniorityScore: i % 2 === 0 ? 0 : 10,
        // No teto em 29 de 32 — discrimina quase nada, mas não é constante.
        geoScore: i < 29 ? 15 : 0,
        compScore: 4,
        freshnessScore: (i % 7) + 1,
        benefitScore: 0,
        cluster: i % 2 === 0 ? "architect" : "ai-lead",
        matchedKeywords: [],
        missingKeywords: [],
        reasons: [],
        blockers: [],
        scorerVersion: "teste",
      });

      // Metade responde, metade não: sem variação no desfecho a correlação
      // entre componente e retorno seria indefinida para todos.
      const status = i % 2 === 0 ? respondidos[i % 4]! : mudos[i % 2]!;
      await banco().insert(application).values({
        candidateId: candidatoId,
        jobId: vaga!.id,
        status,
        channel: i % 3 === 0 ? "referral" : "direct",
        appliedAt: new Date().toISOString(),
      });
    }
    return candidatoId;
  }

  it("sem candidato, recusa", async () => {
    const r = await rodar("stats");
    expect(r.erro).toBeInstanceOf(Error);
  });

  it("com acervo vazio, roda e diz que não há funil a medir", async () => {
    await syncCandidateFromProfile();
    const r = await rodar("stats");
    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();
    // Zero vaga e zero candidatura é o estado do primeiro dia. Estourar aqui
    // — divisão por zero, quantil de lista vazia — seria o defeito clássico
    // de um diagnóstico estatístico.
    expect(r.out).toContain("jho track");
  });

  it("com poucas candidaturas, avisa que a taxa não distingue nada", async () => {
    const { vagas } = await semearAcervo();
    await rodar("track", String(vagas[0]), "applied");

    const r = await rodar("stats");
    expect(r.code).toBeUndefined();
    // Uma candidatura produz um intervalo de confiança que cobre quase toda a
    // faixa 0–100%. Imprimir "0% de retorno" sem esse aviso convenceria a
    // pessoa de que o sistema não funciona.
    expect(r.out).toContain("candidatura");
    // E os recortes por grupo continuam ocultos: comparar grupos de um é ruído.
    expect(r.out).not.toContain("por cluster");
  });

  it("com amostra suficiente, abre os recortes e o sinal por componente", async () => {
    await semearFunilGrande();

    const r = await rodar("stats");
    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();

    // Acima de 30 candidaturas os recortes aparecem — e são a única saída do
    // comando que muda o que a pessoa faz amanhã (qual canal repetir).
    expect(r.out).toContain("por cluster");
    expect(r.out).toContain("por fonte");
    expect(r.out).toContain("por canal");
    expect(r.out).toContain("componente × retorno");
    // Par redundante: dois componentes ordenando o acervo igual é peso contado
    // duas vezes, e o comando precisa dizê-lo com nome e ρ.
    expect(r.out).toContain("Redundância");
    // Componente constante não tem correlação definida com o retorno; o
    // travessão é a recusa a imprimir zero, que seria lido como "não prediz".
    expect(r.out).toContain("—");
  });

  it("recorte sem nenhum grupo é pulado, não impresso vazio", async () => {
    const candidatoId = await semearFunilGrande();
    // Candidatura sem canal registrado é o caso comum de quem começou a usar o
    // sistema antes de `--channel` existir. O agrupamento descarta chave nula,
    // então "por canal" fica sem linha — e um cabeçalho sozinho na tela seria
    // lido como "nenhum canal converteu", que é uma conclusão inventada.
    await banco().update(application).set({ channel: null });
    void candidatoId;

    const r = await rodar("stats");
    expect(r.code).toBeUndefined();
    expect(r.out).toContain("por cluster");
    expect(r.out).not.toContain("por canal");
  });

  it("`--json` devolve diagnóstico e funil no mesmo objeto", async () => {
    await semearFunilGrande();

    const r = await rodar("stats", "--json");
    expect(r.code).toBeUndefined();
    const payload = JSON.parse(r.out) as {
      scorer: { jobs: number; components: Array<{ verdict: string }>; redundant: unknown[] };
      funnel: { applied: number; trustworthy: boolean; byChannel: unknown[] };
    };

    expect(payload.scorer.jobs).toBe(32);
    expect(payload.funnel.applied).toBe(32);
    expect(payload.funnel.trustworthy).toBe(true);
    expect(payload.funnel.byChannel.length).toBeGreaterThan(0);
    // Os três veredictos não-saudáveis do desenho da amostra têm de estar lá:
    // é o que prova que o diagnóstico classifica, e não só descreve.
    const veredictos = new Set(payload.scorer.components.map((c) => c.verdict));
    expect(veredictos.has("dead-weight")).toBe(true);
    expect(veredictos.has("healthy")).toBe(true);
    expect(payload.scorer.redundant.length).toBeGreaterThan(0);
  });

  it("flag inexistente falha como erro de uso", async () => {
    const r = await rodar("stats", "--formato", "json");
    expect((r.erro as { code?: string }).code).toBe("commander.unknownOption");
  });
});
