import { describe, expect, it } from "vitest";
import { groupPublicSkills, type PublicSkill } from "../src/core/candidate-public.ts";

/**
 * `groupPublicSkills()` é pura — sem banco, sem `publicProfile()` — porque a
 * ordem de exibição do perfil público (#326) é uma decisão, não um efeito.
 */

function skill(over: Partial<PublicSkill> & { name: string; category: string }): PublicSkill {
  return { level: null, occurrences: 1, ...over };
}

describe("groupPublicSkills", () => {
  it("agrupa por categoria em ordem alfabética da CHAVE, não do rótulo traduzido", () => {
    const skills = [
      skill({ name: "Go", category: "language" }),
      skill({ name: "Kubernetes", category: "cloud" }),
      skill({ name: "LangGraph", category: "ai" }),
    ];
    expect(groupPublicSkills(skills).map((g) => g.category)).toEqual(["ai", "cloud", "language"]);
  });

  it("dentro do grupo, ocorrências decrescente e depois nome crescente", () => {
    const skills = [
      skill({ name: "TypeScript", category: "language", occurrences: 3 }),
      skill({ name: "Go", category: "language", occurrences: 5 }),
      skill({ name: "Rust", category: "language", occurrences: 5 }),
    ];
    const [group] = groupPublicSkills(skills);
    expect(group!.skills.map((s) => s.name)).toEqual(["Go", "Rust", "TypeScript"]);
  });

  it("é determinístico: mesma entrada, mesma saída, em qualquer ordem de chegada", () => {
    const a: PublicSkill[] = [
      skill({ name: "Python", category: "language", occurrences: 2 }),
      skill({ name: "AWS", category: "cloud", occurrences: 1 }),
    ];
    const b: PublicSkill[] = [...a].reverse();
    expect(groupPublicSkills(a)).toEqual(groupPublicSkills(b));
  });

  it("lista vazia devolve grupo vazio, sem lançar", () => {
    expect(groupPublicSkills([])).toEqual([]);
  });

  it("preserva `level` e `occurrences` de cada skill, sem recalcular nada", () => {
    const skills = [skill({ name: "Go", category: "language", level: "expert", occurrences: 7 })];
    expect(groupPublicSkills(skills)).toEqual([
      { category: "language", skills: [{ name: "Go", category: "language", level: "expert", occurrences: 7 }] },
    ]);
  });
});
