import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(file, "utf8");

describe("oferta de busca na tela Vagas", () => {
  it("abre Buscas com o termo e preenche apenas um parâmetro simples", () => {
    const jobs = read("app/jobs/(lista)/page.tsx");
    const searches = read("app/searches/page.tsx");

    expect(jobs).toContain("/searches?term=${encodeURIComponent(offer.term)}");
    expect(jobs).not.toContain("/searches/tracks/new?term=${encodeURIComponent(offer.term)}");
    expect(searches).toContain("typeof params.term === \"string\"");
    expect(searches).toContain("defaultValue={requestedTerm}");
    expect(searches).toContain('href="/candidate"');
  });
});
