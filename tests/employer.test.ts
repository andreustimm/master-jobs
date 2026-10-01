import { describe, expect, it } from "vitest";
import { hasNamedEmployer } from "../src/contexts/matching/domain/employer.ts";

describe("empregador nomeado (#397)", () => {
  it.each([
    ["careers:vercel", "Vercel", "Vercel", true],
    ["careers:anthropic", "Anthropic", "Anthropic", true],
    ["lever:jobgether", " Jobgether ", "jobgether", false],
    ["lever:board", "Real Employer", "Board", true],
  ])("%s distingue fonte direta de agregador", (source, company, label, expected) => {
    expect(hasNamedEmployer(source, company, label)).toBe(expected);
  });
});
