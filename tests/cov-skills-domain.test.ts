import { describe, expect, it } from "vitest";
import { extractSkills } from "../src/contexts/skills/domain/extractor.ts";
import { analyzeGap, measureDemand } from "../src/contexts/skills/domain/gap.ts";
import {
  findSkillOccurrences,
  matchesSkillTerm,
  skillTermRegex,
  skillTerms,
} from "../src/contexts/skills/domain/matcher.ts";
import { appliedStrategy } from "../src/contexts/skills/domain/strategies.ts";
import {
  SKILL_CATEGORIES,
  SKILL_SOURCES,
  SKILL_STATUSES,
  isSkillCategory,
  isSkillSource,
  isSkillStatus,
  parseSkillCategory,
  parseSkillSource,
  parseSkillStatus,
} from "../src/contexts/skills/domain/types.ts";
import type {
  ExtractionStrategy,
  Mention,
  SkillDefinition,
} from "../src/contexts/skills/domain/types.ts";

/**
 * As bordas do domínio de skills: o que acontece com entrada degenerada.
 *
 * O extrator é a peça que decide o que o sistema AFIRMA sobre o currículo de
 * alguém, e o CLAUDE.md é explícito: tailoring só cita o que tem evidência. Uma
 * detecção fabricada — de um slug fora do catálogo, de uma menção sem frase, de
 * uma grafia que o mercado nem usa — é evidência inventada com aparência de
 * dado. Por isso as bordas aqui não são cerimônia de cobertura: elas são o
 * limite entre "encontrei" e "inventei".
 */

const CATALOGO: SkillDefinition[] = [
  { slug: "go", name: "Go", category: "language", aliases: ["golang"] },
  { slug: "kafka", name: "Kafka", category: "data", aliases: [] },
];

function mention(over: Partial<Mention> = {}): Mention {
  return { alias: "go", offset: 0, context: "unknown", sentence: "Go", ...over };
}

/** Estratégia de mentira, para provar o que o extrator faz com lixo. */
function estrategia(name: string, hits: { skillSlug: string; mentions: Mention[] }[]): ExtractionStrategy {
  return { name, extract: () => hits };
}

describe("guardas e parsers do vocabulário fechado", () => {
  it("aceita exatamente os valores da união e recusa o resto", () => {
    // A união é explícita justamente para um erro de digitação virar erro de
    // tipo. Estes parsers são a fronteira onde uma string vinda do banco ou da
    // URL vira valor do domínio — e onde "confirmedd" precisa explodir em vez
    // de escorregar para dentro como se fosse estado auditado.
    for (const c of SKILL_CATEGORIES) expect(parseSkillCategory(c)).toBe(c);
    for (const s of SKILL_STATUSES) expect(parseSkillStatus(s)).toBe(s);
    for (const s of SKILL_SOURCES) expect(parseSkillSource(s)).toBe(s);

    expect(isSkillCategory("language")).toBe(true);
    expect(isSkillCategory("linguagem")).toBe(false);
    expect(isSkillStatus("confirmed")).toBe(true);
    expect(isSkillStatus("confirmadO")).toBe(false);
    expect(isSkillSource("cv")).toBe(true);
    expect(isSkillSource("linkedin")).toBe(false);
  });

  it("falha alto e diz qual foi o valor recusado", () => {
    // O valor entra na mensagem porque a origem provável é uma linha antiga do
    // banco. Sem ele, o operador sabe que algo quebrou e não sabe o quê.
    expect(() => parseSkillCategory("linguagem")).toThrow('Unknown skill category "linguagem"');
    expect(() => parseSkillStatus("aprovado")).toThrow('Unknown skill status "aprovado"');
    expect(() => parseSkillSource("linkedin")).toThrow('Unknown skill source "linkedin"');
  });
});

describe("matcher diante de termo degenerado", () => {
  it("termo vazio ou só espaço não vira regex que casa com tudo", () => {
    // Uma entrada vazia produziria o padrão `()`, que casa em toda posição do
    // texto. O resultado seria o catálogo inteiro "detectado" em qualquer
    // documento — evidência fabricada em escala.
    expect(skillTermRegex("")).toBeNull();
    expect(skillTermRegex("   ")).toBeNull();
    expect(skillTermRegex("\n\t")).toBeNull();

    expect(findSkillOccurrences("qualquer texto com palavras", "")).toEqual([]);
    expect(matchesSkillTerm("qualquer texto com palavras", "  ")).toBe(false);
  });

  it("skillTerms normaliza, deduplica e descarta grafia vazia", () => {
    // O catálogo é editado à mão. Alias repetido em outra caixa contaria a
    // mesma menção duas vezes e inflaria a confiança da detecção; alias em
    // branco cairia no caso acima.
    const termos = skillTerms({
      slug: "go",
      name: "  Go  ",
      category: "language",
      aliases: ["GO", "go", "  ", "Go   Lang"],
    });
    expect(termos).toEqual(["go", "go lang"]);
  });
});

describe("extractSkills diante de estratégia mal-comportada", () => {
  it("descarta slug que não existe no catálogo", () => {
    // O catálogo é a autoridade sobre o que pode ser afirmado. Uma estratégia
    // futura — um LLM, por exemplo — vai inventar nomes; se o extrator os
    // aceitasse, o sistema passaria a atribuir ao candidato uma skill que
    // ninguém definiu, sem nome canônico e sem categoria.
    const detections = extractSkills("texto qualquer", CATALOGO, {
      strategies: [estrategia("fantasia", [{ skillSlug: "quantum-blockchain", mentions: [mention()] }])],
    });
    expect(detections).toEqual([]);
  });

  it("não estoura quando uma estratégia reporta hit sem menção nenhuma", () => {
    // Evidência vazia é o pior resultado possível para uma tela de auditoria:
    // ela pede que um humano julgue uma frase que não existe. O extrator
    // devolve string vazia em vez de quebrar, e a detecção nasce com a
    // confiança mínima — o humano vê que não há o que ler.
    const detections = extractSkills("texto qualquer", CATALOGO, {
      strategies: [estrategia("oca", [{ skillSlug: "go", mentions: [] }])],
    });

    expect(detections).toHaveLength(1);
    expect(detections[0]!.evidence).toBe("");
    expect(detections[0]!.occurrences).toBe(0);
    expect(detections[0]!.rationale).toContain("apenas menção solta");
  });

  it("no mesmo offset, o contexto mais forte vence — em qualquer ordem", () => {
    // Duas estratégias enxergam a mesma ocorrência por desenho. Se a última a
    // falar vencesse, a confiança dependeria da ordem do array de estratégias,
    // e registrar uma nova mudaria silenciosamente a nota de detecções antigas.
    const resumo = estrategia("resumo", [
      { skillSlug: "go", mentions: [mention({ offset: 5, context: "summary", sentence: "Resumo com Go" })] },
    ]);
    const solto = estrategia("solto", [
      { skillSlug: "go", mentions: [mention({ offset: 5, context: "unknown", sentence: "Go solto" })] },
    ]);

    const aFrente = extractSkills("texto", CATALOGO, { strategies: [solto, resumo] });
    const atras = extractSkills("texto", CATALOGO, { strategies: [resumo, solto] });

    expect(aFrente[0]!.mentions[0]!.context).toBe("summary");
    expect(atras[0]!.mentions[0]!.context).toBe("summary");
  });

  it("repetição entra na justificativa a partir da terceira menção", () => {
    // A curva satura de propósito: a décima menção diz pouco que a terceira já
    // não dissesse. Mas o número precisa aparecer no texto que o humano lê,
    // senão ele não tem como discordar da nota.
    const tres = extractSkills("Go", CATALOGO, {
      strategies: [
        estrategia("tres", [
          {
            skillSlug: "go",
            mentions: [mention({ offset: 0 }), mention({ offset: 10 }), mention({ offset: 20 })],
          },
        ]),
      ],
    });
    const duas = extractSkills("Go", CATALOGO, {
      strategies: [
        estrategia("duas", [{ skillSlug: "go", mentions: [mention({ offset: 0 }), mention({ offset: 10 })] }]),
      ],
    });

    expect(tres[0]!.rationale).toContain("3 menções no documento");
    expect(duas[0]!.rationale).not.toContain("menções no documento");
  });

  it("catálogo vazio não produz detecção, por mais rico que o texto seja", () => {
    // Sem catálogo não existe nome canônico para afirmar coisa alguma.
    expect(extractSkills("Go, Kafka, Python, tudo", [])).toEqual([]);
  });
});

describe("appliedStrategy", () => {
  it("ignora linha dentro de experiência que não descreve trabalho feito", () => {
    // Uma lista de stack colada embaixo do cabeçalho de experiência é a mesma
    // evidência fraca de sempre — não vira "usou em produção" só por causa da
    // posição no documento. Confundir os dois é o que faz o tailoring afirmar
    // experiência a partir de uma enumeração.
    const cv = ["## PROFESSIONAL EXPERIENCE", "Go, Kafka", "* Built ingestion in Go"].join("\n");

    const hits = appliedStrategy.extract(cv, CATALOGO);
    const go = hits.find((h) => h.skillSlug === "go");

    expect(go!.mentions).toHaveLength(1);
    expect(go!.mentions[0]!.sentence).toBe("* Built ingestion in Go");
    // A linha "Go, Kafka" não gerou menção aplicada para nenhuma das duas.
    expect(hits.find((h) => h.skillSlug === "kafka")).toBeUndefined();
  });
});

describe("measureDemand e analyzeGap nas bordas", () => {
  it("desempata grafias de mesma frequência em ordem alfabética", () => {
    // Empate acontece o tempo todo num corpus pequeno. Sem desempate estável, o
    // "termo que o mercado usa" mudaria entre duas execuções sobre os mesmos
    // dados — e é esse termo que o candidato vai escrever no currículo.
    const catalogo: SkillDefinition[] = [
      { slug: "zeta", name: "Zeta", category: "tool", aliases: ["alpha"] },
    ];
    const demanda = measureDemand(catalogo, ["usamos zeta e alpha aqui"]);

    expect(demanda[0]!.termsByFrequency.map((t) => t.term)).toEqual(["alpha", "zeta"]);
  });

  it("cai para o nome canônico quando a demanda não trouxe grafia nenhuma", () => {
    // `analyzeGap` recebe a demanda pronta e não assume que ela veio de
    // `measureDemand` — pode vir de um dataset de mercado. Sem grafia
    // registrada, o relatório ainda precisa dizer QUAL palavra falta, e o nome
    // canônico é a única resposta honesta disponível.
    const catalogo: SkillDefinition[] = [
      { slug: "obs", name: "Observability", category: "practice", aliases: ["observability"] },
    ];
    const relatorio = analyzeGap(
      catalogo,
      "Currículo que fala de Datadog e Rollbar.",
      [{ slug: "obs", jobCount: 3, termsByFrequency: [] }],
      4,
    );

    expect(relatorio.items[0]!.marketTerm).toBe("observability");
    expect(relatorio.items[0]!.kind).toBe("missing");
  });

  it("ignora skill do catálogo que a demanda sequer menciona", () => {
    // Demanda e catálogo podem divergir: catálogo cresce, medição é de um
    // recorte. Uma skill sem linha de demanda não pode virar "lacuna real" —
    // seria acusar o currículo de não ter algo que ninguém pediu.
    const catalogo: SkillDefinition[] = [
      { slug: "go", name: "Go", category: "language", aliases: [] },
      { slug: "kafka", name: "Kafka", category: "data", aliases: [] },
    ];
    const relatorio = analyzeGap(catalogo, "nada aqui", [{ slug: "go", jobCount: 2, termsByFrequency: [{ term: "go", count: 2 }] }], 2);

    expect(relatorio.items.map((i) => i.skill.slug)).toEqual(["go"]);
    expect(relatorio.coverage.missing).toBe(1);
  });
});
