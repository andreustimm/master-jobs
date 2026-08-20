import { describe, expect, it } from "vitest";
import { analyzeVocabularyGap } from "../src/contexts/skills/app/analyze-gap.ts";
import { listCandidateSkills } from "../src/contexts/skills/app/candidate-skills.ts";
import { listSkillCatalog } from "../src/contexts/skills/app/catalog.ts";
import { extractCandidateSkills } from "../src/contexts/skills/app/extract-skills.ts";
import { measureSkillDemand } from "../src/contexts/skills/app/measure-skill-demand.ts";
import type {
  CandidateSkillView,
  Detection,
  SkillDefinition,
  SkillSource,
} from "../src/contexts/skills/domain/types.ts";
import type { PersistedSkill } from "../src/contexts/skills/ports.ts";

/**
 * Casos de uso de skills, com as portas dubladas.
 *
 * Dois invariantes moram aqui e em nenhum outro lugar:
 *
 *  1. **Re-extrair nunca desfaz decisão humana.** O `status` de uma linha é a
 *     diferença entre "o sistema encontrou" e "a pessoa confirmou" — e é o que
 *     a regra 7 do CLAUDE.md protege quando proíbe inventar evidência. Se uma
 *     re-execução rebaixasse `confirmed` para `detected`, o trabalho de
 *     auditoria evaporaria a cada upload de currículo, e ninguém confia numa
 *     ferramenta duas vezes depois disso.
 *  2. **O corpus é escopado pelo candidato.** "O mercado" é o recorte de vagas
 *     que ESTE candidato quer; ler o corpus de outro seria comparar o currículo
 *     com o mercado de outra pessoa.
 */

const CATALOGO: SkillDefinition[] = [
  { slug: "go", name: "Go", category: "language", aliases: ["golang"] },
  { slug: "kafka", name: "Kafka", category: "data", aliases: [] },
  { slug: "obs", name: "Observability", category: "practice", aliases: ["observability"] },
];

function view(over: Partial<CandidateSkillView> & { id: number; slug: string }): CandidateSkillView {
  return {
    name: over.slug,
    category: "language",
    status: "detected",
    source: "cv",
    evidence: null,
    occurrences: 1,
    level: null,
    auditedAt: null,
    ...over,
  };
}

function memoriaDeExtracao(existentes: PersistedSkill[]) {
  const adicionadas: { candidateId: number; slug: string; source: SkillSource }[] = [];
  const atualizadas: { candidateId: number; slug: string }[] = [];
  return {
    adicionadas,
    atualizadas,
    store: {
      existing: async () => existentes,
      add: async (candidateId: number, detection: Detection, source: SkillSource) => {
        adicionadas.push({ candidateId, slug: detection.skill.slug, source });
      },
      refresh: async (candidateId: number, detection: Detection) => {
        atualizadas.push({ candidateId, slug: detection.skill.slug });
      },
    },
  };
}

const CV = [
  "## KEY TECHNOLOGIES",
  "Go, Kafka",
  "## PROFESSIONAL EXPERIENCE",
  "* Built an ingestion pipeline in Go on top of Kafka",
].join("\n");

describe("extractCandidateSkills", () => {
  it("insere o que é novo e carimba a origem informada", async () => {
    const m = memoriaDeExtracao([]);
    const r = await extractCandidateSkills(
      { candidateId: 7, text: CV, source: "profile" },
      { catalog: { all: async () => CATALOGO }, store: m.store },
    );

    expect(r.added).toBe(2);
    expect(r.refreshed).toBe(0);
    expect(r.preserved).toBe(0);
    expect(m.adicionadas.map((a) => a.slug).sort()).toEqual(["go", "kafka"]);
    // A origem viaja junto porque "veio do CV" e "veio do perfil" pesam
    // diferente numa auditoria futura.
    expect(new Set(m.adicionadas.map((a) => a.source))).toEqual(new Set(["profile"]));
    expect(new Set(m.adicionadas.map((a) => a.candidateId))).toEqual(new Set([7]));
  });

  it("assume 'cv' quando ninguém disse de onde veio", async () => {
    // Padrão explícito em vez de null: uma linha sem origem obrigaria toda tela
    // a decidir o que mostrar, e a decisão seria diferente em cada uma.
    const m = memoriaDeExtracao([]);
    await extractCandidateSkills(
      { candidateId: 1, text: CV },
      { catalog: { all: async () => CATALOGO }, store: m.store },
    );
    expect(new Set(m.adicionadas.map((a) => a.source))).toEqual(new Set(["cv"]));
  });

  it("PRESERVA linha já auditada e só atualiza a que ainda é 'detected'", async () => {
    // O invariante central. `confirmed` e `rejected` são decisão de gente;
    // `detected` é palpite da máquina e pode ser reescrito à vontade.
    const m = memoriaDeExtracao([
      { skillSlug: "go", status: "confirmed" },
      { skillSlug: "kafka", status: "detected" },
    ]);

    const r = await extractCandidateSkills(
      { candidateId: 7, text: CV },
      { catalog: { all: async () => CATALOGO }, store: m.store },
    );

    expect(r.preserved).toBe(1);
    expect(r.refreshed).toBe(1);
    expect(r.added).toBe(0);
    expect(m.adicionadas).toEqual([]);
    // A skill confirmada não foi tocada nem para "atualizar evidência".
    expect(m.atualizadas.map((a) => a.slug)).toEqual(["kafka"]);
  });

  it("uma REJEIÇÃO também é decisão humana e sobrevive à re-extração", async () => {
    // O caso mais fácil de errar: é tentador tratar `rejected` como "sem
    // registro" e reinserir. Isso ressuscitaria, a cada upload, exatamente a
    // skill que a pessoa disse que não tem — que é a definição de evidência
    // inventada.
    const m = memoriaDeExtracao([
      { skillSlug: "go", status: "rejected" },
      { skillSlug: "kafka", status: "rejected" },
    ]);

    const r = await extractCandidateSkills(
      { candidateId: 7, text: CV },
      { catalog: { all: async () => CATALOGO }, store: m.store },
    );

    expect(r).toMatchObject({ added: 0, refreshed: 0, preserved: 2 });
    expect(m.adicionadas).toEqual([]);
    expect(m.atualizadas).toEqual([]);
  });

  it("repassa as opções do extrator, então o piso de confiança vale de verdade", async () => {
    // O piso é a diferença entre "menção solta" e "detecção que vale mostrar".
    // Se o caso de uso engolisse a opção, a tela ofereceria ruído para auditar.
    const m = memoriaDeExtracao([]);
    const r = await extractCandidateSkills(
      { candidateId: 7, text: "Comentário solto sobre Go.", options: { minConfidence: 0.9 } },
      { catalog: { all: async () => CATALOGO }, store: m.store },
    );

    expect(r.detections).toEqual([]);
    expect(m.adicionadas).toEqual([]);
  });

  it("documento sem nenhuma skill do catálogo não escreve nada", async () => {
    const m = memoriaDeExtracao([]);
    const r = await extractCandidateSkills(
      { candidateId: 7, text: "Texto sobre jardinagem e pão." },
      { catalog: { all: async () => CATALOGO }, store: m.store },
    );

    expect(r).toMatchObject({ added: 0, refreshed: 0, preserved: 0 });
    expect(r.detections).toEqual([]);
  });
});

describe("analyzeVocabularyGap", () => {
  it("usa os padrões de recorte quando o chamador não os informa", async () => {
    // 60 de fit e 400 vagas não são números soltos: comparar com o corpus
    // inteiro mediria o vocabulário de vagas que o candidato não quer, e é o
    // erro que faz o relatório recomendar aprender coisa irrelevante.
    let recorte: unknown;
    await analyzeVocabularyGap(
      { candidateId: 7, cvText: "Go e Kafka" },
      {
        catalog: { all: async () => CATALOGO },
        corpus: {
          targetTexts: async (opts) => {
            recorte = opts;
            return [];
          },
        },
      },
    );

    expect(recorte).toEqual({ candidateId: 7, minFit: 60, limit: 400 });
  });

  it("respeita recorte e piso de demanda explícitos", async () => {
    let recorte: unknown;
    const relatorio = await analyzeVocabularyGap(
      { candidateId: 9, cvText: "Datadog e Rollbar", minFit: 80, limit: 5, minDemand: 0 },
      {
        catalog: { all: async () => CATALOGO },
        corpus: {
          targetTexts: async (opts) => {
            recorte = opts;
            return ["Precisamos de observability e Go", "Observability é obrigatório"];
          },
        },
      },
    );

    expect(recorte).toEqual({ candidateId: 9, minFit: 80, limit: 5 });
    // O CV descreve a experiência com nomes de ferramenta; o mercado busca a
    // palavra guarda-chuva. É lacuna de vocabulário, não de carreira — e é o
    // ponto inteiro do relatório separar as duas.
    expect(relatorio.totalJobs).toBe(2);
    expect(relatorio.items.find((i) => i.skill.slug === "obs")!.marketTerm).toBe("observability");
  });

  it("corpus vazio devolve relatório vazio em vez de dividir por zero", async () => {
    // Acontece em instalação nova, antes de qualquer sync. O relatório precisa
    // renderizar "sem dados" e não estourar na primeira visita à tela.
    const relatorio = await analyzeVocabularyGap(
      { candidateId: 7, cvText: "Go" },
      { catalog: { all: async () => CATALOGO }, corpus: { targetTexts: async () => [] } },
    );

    expect(relatorio).toMatchObject({ totalJobs: 0, items: [], quickWins: [], realGaps: [] });
    expect(relatorio.coverage.weighted).toBe(0);
  });
});

describe("measureSkillDemand", () => {
  it("aplica os mesmos padrões de recorte do relatório de lacuna", async () => {
    // Se os dois usassem padrões diferentes, a tela de demanda e a de lacuna
    // discordariam sobre o que o mercado pede — sem nada na interface indicando
    // que estão olhando corpus distintos.
    let recorte: unknown;
    await measureSkillDemand(
      { candidateId: 7 },
      {
        catalog: { all: async () => CATALOGO },
        candidates: { list: async () => [] },
        corpus: {
          targetTexts: async (opts) => {
            recorte = opts;
            return [];
          },
        },
      },
    );

    expect(recorte).toEqual({ candidateId: 7, minFit: 60, limit: 400 });
  });

  it("corpus vazio não vira demanda 100% nem lista de nada", async () => {
    // A divisão é por número de vagas. Sem guarda, zero vagas produziria NaN, e
    // NaN ordenado numa tabela vira ordem aleatória com aparência de ranking.
    const r = await measureSkillDemand(
      { candidateId: 7 },
      {
        catalog: { all: async () => CATALOGO },
        candidates: { list: async () => [view({ id: 1, slug: "go", status: "confirmed" })] },
        corpus: { targetTexts: async () => [] },
      },
    );

    expect(r).toEqual([]);
  });

  it("anexa o status do candidato e omite skill que ninguém pediu", async () => {
    const r = await measureSkillDemand(
      { candidateId: 7, minFit: 70, corpusLimit: 3 },
      {
        catalog: { all: async () => CATALOGO },
        candidates: {
          list: async () => [
            view({ id: 1, slug: "go", status: "confirmed" }),
            view({ id: 2, slug: "kafka", status: "rejected" }),
          ],
        },
        corpus: { targetTexts: async () => ["Vaga de Go", "Outra vaga de Go e Kafka"] },
      },
    );

    // `obs` não aparece: filtrar por `postings > 0` evita que a tela liste o
    // catálogo inteiro com demanda zero e enterre o que importa.
    expect(r.map((e) => e.slug)).toEqual(["go", "kafka"]);
    expect(r[0]).toMatchObject({ demand: 1, postings: 2, candidateStatus: "confirmed" });
    expect(r[1]).toMatchObject({ demand: 0.5, postings: 1, candidateStatus: "rejected" });
  });

  it("skill demandada que o candidato nunca teve fica com status nulo", async () => {
    // Nulo é "não há linha", diferente de `rejected`, que é "a pessoa disse que
    // não". Colapsar os dois esconderia a lacuna real por trás de uma rejeição.
    const r = await measureSkillDemand(
      { candidateId: 7 },
      {
        catalog: { all: async () => CATALOGO },
        candidates: { list: async () => [] },
        corpus: { targetTexts: async () => ["Precisamos de Kafka"] },
      },
    );

    expect(r).toEqual([
      { slug: "kafka", name: "Kafka", category: "data", demand: 1, postings: 1, candidateStatus: null },
    ]);
  });
});

describe("listagens sem filtro", () => {
  it("listSkillCatalog sem categoria devolve o catálogo inteiro, sem cópia perdida", async () => {
    await expect(
      listSkillCatalog(undefined, { catalog: { all: async () => CATALOGO } }),
    ).resolves.toEqual(CATALOGO);
  });

  it("listCandidateSkills sem status devolve tudo do candidato pedido", async () => {
    // O filtro é opcional; o escopo não é. A tela de auditoria precisa ver
    // detectado, confirmado e rejeitado juntos para o humano comparar.
    const linhas = [
      view({ id: 1, slug: "go", status: "confirmed" }),
      view({ id: 2, slug: "kafka", status: "rejected" }),
      view({ id: 3, slug: "obs" }),
    ];
    let pedido: number | undefined;

    const r = await listCandidateSkills(
      { candidateId: 7 },
      {
        store: {
          list: async (candidateId) => {
            pedido = candidateId;
            return linhas;
          },
        },
      },
    );

    expect(pedido).toBe(7);
    expect(r).toEqual(linhas);
  });
});
