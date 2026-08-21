import { describe, expect, it } from "vitest";
import {
  CONFIANCA_FORTE,
  CONFIANCA_MINIMA,
  curriculoSustentaPerfil,
  deriveMatchingProfile,
} from "../src/contexts/matching/domain/derive.ts";
import type { Detection } from "../src/contexts/skills/domain/types.ts";
import { loadProfile } from "../src/core/profile/load.ts";
import type { Profile } from "../src/core/profile/schema.ts";

/**
 * Derivar o perfil de matching do currículo.
 *
 * ## O que estes casos protegem
 *
 * A parte fácil é traduzir detecção em palavra-chave. A parte que importa é o
 * que NÃO se deriva, e é onde um descuido produziria um sistema ativamente
 * injusto: herdar a lista negativa do dono da instalação faria o ranking
 * penalizar outra pessoa exatamente pela stack que ela domina.
 *
 * Por isso quase todo caso aqui afirma uma ausência.
 */

function deteccao(nome: string, confidence: number): Detection {
  return {
    skill: { slug: nome.toLowerCase().replace(/\s+/g, "-"), name: nome, category: "language", aliases: [] },
    mentions: [],
    occurrences: 1,
    confidence,
    evidence: "",
    rationale: "",
  };
}

let base: Profile;

async function padrao(): Promise<Profile> {
  base ??= await loadProfile(true);
  return base;
}

describe("deriveMatchingProfile", () => {
  it("separa forte de stack pelo limiar de confiança", async () => {
    const perfil = deriveMatchingProfile(await padrao(), [
      deteccao("TypeScript", 0.95),
      deteccao("Kubernetes", 0.4),
    ]);

    expect(perfil.keywords.strong.map((k) => k.term)).toEqual(["typescript"]);
    expect(perfil.keywords.stack.map((k) => k.term)).toEqual(["kubernetes"]);
  });

  it("termo forte pesa 7 ou mais, para contar como lacuna quando ausente", async () => {
    const perfil = deriveMatchingProfile(await padrao(), [deteccao("RAG", 0.99)]);

    // `scoreKeywords` lista como lacuna o termo com peso >= 7 que a vaga não
    // tem. Abaixo disso o termo pontuaria quando presente e sumiria quando
    // ausente — o candidato nunca saberia o que faltou.
    expect(perfil.keywords.strong[0]!.weight).toBeGreaterThanOrEqual(7);
  });

  it("mais confiança pesa mais que menos confiança", async () => {
    const perfil = deriveMatchingProfile(await padrao(), [
      deteccao("Muito", 1),
      deteccao("Pouco", CONFIANCA_FORTE),
    ]);

    const [muito, pouco] = perfil.keywords.strong;
    expect(muito!.weight).toBeGreaterThan(pouco!.weight);
  });

  it("menção abaixo do mínimo é descartada", async () => {
    const perfil = deriveMatchingProfile(await padrao(), [
      deteccao("Citado de passagem", CONFIANCA_MINIMA - 0.01),
    ]);

    // Uma palavra solta num currículo não é competência. Deixá-la entrar
    // dilui o somatório e faz vaga irrelevante subir.
    expect(perfil.keywords.strong).toHaveLength(0);
    expect(perfil.keywords.stack).toHaveLength(0);
  });

  it("NÃO herda a lista negativa do perfil padrão", async () => {
    const padraoAtual = await padrao();
    // Guarda contra o caso deixar de provar algo: se o padrão um dia não tiver
    // negativos, o `toHaveLength(0)` abaixo passaria sem significar nada.
    expect(padraoAtual.keywords.negative.length).toBeGreaterThan(0);

    const perfil = deriveMatchingProfile(padraoAtual, [deteccao("WordPress", 0.9)]);

    // A lista do padrão tem `wordpress`, `cobol`, `unity` — gosto de quem
    // instalou. Herdá-la penalizaria outra pessoa pela stack que ela domina,
    // que é o oposto de ranquear por aderência. E note: neste caso o currículo
    // EVIDENCIA WordPress, então herdar seria somar e subtrair o mesmo termo.
    expect(perfil.keywords.negative).toHaveLength(0);
    expect(perfil.keywords.strong.map((k) => k.term)).toContain("wordpress");
  });

  it("NÃO herda os termos críticos do perfil padrão", async () => {
    const padraoAtual = await padrao();
    expect(padraoAtual.keywords.critical.length).toBeGreaterThan(0);

    const perfil = deriveMatchingProfile(padraoAtual, [deteccao("Go", 0.9)]);

    // Currículo é evidência de capacidade, não declaração de desejo. Afirmar
    // que algo é indispensável para alguém que nunca disse isso seria inventar
    // uma exigência dele.
    expect(perfil.keywords.critical).toHaveLength(0);
  });

  it("herda restrição e remuneração, que currículo nenhum contém", async () => {
    const padraoAtual = await padrao();
    const perfil = deriveMatchingProfile(padraoAtual, [deteccao("Python", 0.9)]);

    // Autorização de trabalho, regiões e faixa salarial são preferência e
    // restrição. Zerá-las faria o sistema ignorar bloqueio de visto — o filtro
    // mais caro de errar que existe aqui.
    expect(perfil.constraints).toEqual(padraoAtual.constraints);
    expect(perfil.compensation).toEqual(padraoAtual.compensation);
    expect(perfil.targets).toEqual(padraoAtual.targets);
  });

  it("campo do schema que esta função não conhece sobrevive", async () => {
    const padraoAtual = await padrao();
    const perfil = deriveMatchingProfile(padraoAtual, [deteccao("Rust", 0.9)]);

    // `base` entra inteiro por spread. Sem isso, um campo novo no schema sumiria
    // do perfil derivado só porque esta função foi escrita antes dele.
    expect(perfil.identity).toEqual(padraoAtual.identity);
    expect(perfil.seniority).toEqual(padraoAtual.seniority);
  });

  it("ordena por confiança, do mais sustentado ao menos", async () => {
    const perfil = deriveMatchingProfile(await padrao(), [
      deteccao("Meio", 0.8),
      deteccao("Muito", 0.98),
      deteccao("Quase", 0.72),
    ]);

    expect(perfil.keywords.strong.map((k) => k.term)).toEqual(["muito", "meio", "quase"]);
  });

  it("sem detecção nenhuma, devolve keywords vazias em vez de estourar", async () => {
    const perfil = deriveMatchingProfile(await padrao(), []);

    expect(perfil.keywords.strong).toHaveLength(0);
    expect(perfil.keywords.stack).toHaveLength(0);
  });
});

describe("curriculoSustentaPerfil", () => {
  it("uma detecção acima do mínimo já basta", () => {
    expect(curriculoSustentaPerfil([deteccao("Node", CONFIANCA_MINIMA)])).toBe(true);
  });

  it("só ruído não sustenta", () => {
    // `scoreKeywords` normaliza pelo somatório dos pesos: somatório zero faz
    // todo mundo empatar. Board sem ranking é honesto; ranking que é ruído com
    // aparência de ordem, não.
    expect(curriculoSustentaPerfil([deteccao("Ruído", 0.05)])).toBe(false);
    expect(curriculoSustentaPerfil([])).toBe(false);
  });
});
