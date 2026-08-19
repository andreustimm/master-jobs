import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cleanPdfText, extractPdfText } from "../src/core/pdf.ts";
import { measureDemand } from "../src/contexts/skills/domain/gap.ts";

describe("cleanPdfText", () => {
  it("rejoins a word hyphenated across a line break", () => {
    // The highest-impact cleanup: "observ-\nability" matches neither half, so
    // the candidate silently loses the skill.
    expect(cleanPdfText("observ-\nability")).toBe("observability");
    expect(cleanPdfText("Kuber-\nnetes")).toBe("Kubernetes");
  });

  it("keeps a real hyphenated compound intact", () => {
    expect(cleanPdfText("event-driven architecture")).toBe("event-driven architecture");
  });

  it("unwraps a paragraph broken mid-sentence", () => {
    // Sentence-level evidence is what the `applied` strategy weighs highest,
    // and it only survives if the sentence survives.
    expect(cleanPdfText("Used Kafka to deliver\nreal-time pipelines.")).toBe(
      "Used Kafka to deliver real-time pipelines.",
    );
  });

  it("does not glue two sentences together", () => {
    expect(cleanPdfText("First line.\nSecond line.")).toBe("First line.\nSecond line.");
  });

  it("does not swallow a bullet into the line above", () => {
    const out = cleanPdfText("Experience\n• Built a platform");
    expect(out).toBe("Experience\n- Built a platform");
  });

  it("normalises every bullet glyph to a dash", () => {
    expect(cleanPdfText("• um\n▪ dois\n◦ três\n‣ quatro")).toBe("- um\n- dois\n- três\n- quatro");
  });

  it("strips zero-width and non-breaking characters", () => {
    // Invisible on screen, and they break literal term matching.
    const dirty = "Type​Script and Kubernetes";
    const clean = cleanPdfText(dirty);
    expect(clean).toBe("TypeScript and Kubernetes");
    expect(clean).not.toMatch(/[​ ]/);
  });

  it("collapses runaway blank lines", () => {
    expect(cleanPdfText("a\n\n\n\n\nb")).toBe("a\n\nb");
  });
});

describe("extractPdfText", () => {
  // Lives outside the repo (it is personal material, not project data), so the
  // integration cases skip rather than fail if it is not there. A red test for
  // a missing fixture teaches people to ignore red tests.
  const CV = "../CV/ATS Curriculum Andreus Timm 2026-07 - EN.pdf";
  const withRealCv = existsSync(CV) ? it : it.skip;

  withRealCv("extracts the real CV with accents intact", async () => {
    const r = await extractPdfText(new Uint8Array(readFileSync(CV)));
    expect(r.pages).toBeGreaterThan(0);
    expect(r.text.length).toBeGreaterThan(2000);
    // Accented text surviving proves the encoding path is right.
    expect(r.text).toContain("São Paulo");
    expect(r.warnings).toEqual([]);
  });

  withRealCv("produces text the skill matcher can actually read", async () => {
    // The real acceptance criterion: extraction feeds skill detection, so a
    // clean-looking string that matches nothing would still be a failure.
    const r = await extractPdfText(new Uint8Array(readFileSync(CV)));
    const catalog = [
      { slug: "typescript", name: "TypeScript", category: "language" as const, aliases: ["typescript"] },
      { slug: "python", name: "Python", category: "language" as const, aliases: ["python"] },
    ];
    const demand = measureDemand(catalog, [r.text]);
    expect(demand.every((d) => d.jobCount === 1)).toBe(true);
  });

  it("warns instead of silently storing nothing", async () => {
    // A one-page PDF with no text layer is the scanned-CV case.
    const empty = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
      "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
      "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n" +
      "trailer<</Root 1 0 R>>";
    const r = await extractPdfText(new TextEncoder().encode(empty));
    expect(r.text.length).toBeLessThan(200);
    expect(r.warnings.join(" ")).toContain("digitalizado");
  });
});
