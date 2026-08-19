import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSnippet, knownPlatforms, snippetNote } from "../src/core/sources/snippet.ts";

describe("buildSnippet", () => {
  it("emits syntactically valid JavaScript for every platform", () => {
    // The snippet runs in the user's browser, where a syntax error would only
    // surface as a confusing console message far from here.
    const dir = mkdtempSync(join(tmpdir(), "jho-snippet-"));
    for (const platform of knownPlatforms()) {
      const file = join(dir, `${platform}.js`);
      writeFileSync(file, buildSnippet(platform));
      expect(() => execFileSync(process.execPath, ["--check", file])).not.toThrow();
    }
  });

  it("uses the platform's own path pattern", () => {
    expect(buildSnippet("revelo")).toContain('"/positions/"');
  });

  it("honours an override", () => {
    expect(buildSnippet("revelo", { match: "/vaga/" })).toContain('"/vaga/"');
  });

  it("falls back to the generic extractor for an unknown platform", () => {
    // Guessing selectors for a page this project cannot open would be a guess
    // presented as knowledge.
    expect(buildSnippet("plataforma-desconhecida")).toContain('"job"');
  });

  it("only reads the page — no network call", () => {
    // The whole premise is that the user runs this in their own session. It
    // must not be able to send that session anywhere.
    const code = buildSnippet("revelo");
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toContain("XMLHttpRequest");
    expect(code).not.toContain("sendBeacon");
    expect(code).not.toContain("WebSocket");
  });

  it("produces the field names the importer already understands", () => {
    // Shorthand (`title,`) and explicit (`company:`) both appear, so match either.
    const code = buildSnippet("revelo");
    for (const field of ["title", "url", "company", "location", "description"]) {
      expect(code, field).toMatch(new RegExp(`\\b${field}\\s*[,:]`));
    }
  });

  it("escapes a match string safely", () => {
    const code = buildSnippet("revelo", { match: '"; alert(1); //' });
    expect(code).toContain(JSON.stringify('"; alert(1); //'));
    const dir = mkdtempSync(join(tmpdir(), "jho-snippet-esc-"));
    const file = join(dir, "escaped.js");
    writeFileSync(file, code);
    expect(() => execFileSync(process.execPath, ["--check", file])).not.toThrow();
  });
});

describe("snippetNote", () => {
  it("tells the user to load the whole list first", () => {
    // Infinite-scroll lists only have in the DOM what has been scrolled to.
    expect(snippetNote("revelo")).toContain("role até o fim");
  });
});
