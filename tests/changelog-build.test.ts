import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChangelogModal } from "../app/changelog-modal.tsx";
import { compileChangelog, generateChangelogs } from "../scripts/build-changelog.ts";

const notes = (body: string) => `# Notes

## [Unreleased]

Not published yet.

## [2.0.0] - 2026-09-22T10:00:00.000Z

${body}

## [1.1.0] - 2026-09-20

<!-- sem-nota-usuario -->

## [1.0.0] - 2026-08-21

Historical note.
`;

function readBuiltModule(path: string) {
  return JSON.parse(execFileSync(process.execPath, [
    "--input-type=module",
    "-e",
    "const {changelogs} = await import(process.argv[1]); console.log(JSON.stringify(changelogs));",
    path,
  ], { encoding: "utf8" }));
}

describe("build-time release history", () => {
  it("compiles visible releases with their original precision and safe HTML", () => {
    const result = compileChangelog(notes("A **bold** note.\n\n<script>alert(1)</script>"), "en");
    expect(result.diagnostics).toEqual([]);
    expect(result.releases.map(({ version, publication }) => ({ version, publication }))).toEqual([
      { version: "2.0.0", publication: { kind: "instant", value: "2026-09-22T10:00:00.000Z" } },
      { version: "1.0.0", publication: { kind: "date", value: "2026-08-21" } },
    ]);
    expect(result.releases[0]!.html).toContain('<strong class="font-semibold">bold</strong>');
    expect(JSON.stringify(result.releases)).not.toMatch(/<script|Not published yet|sem-nota-usuario|"markdown"/);
  });

  it("isolates malformed entries at build and supports an empty published history", () => {
    const source = "## [v1.2] - 2026-08-22\n\nInvalid body.\n\n" + notes("Valid body.");
    const compiled = compileChangelog(source, "pt-BR");
    expect(compiled.diagnostics).toEqual(["changelog:invalid_version locale=pt-BR version=v1.2"]);
    expect(compiled.releases).toHaveLength(2);
    expect(JSON.stringify(compiled.releases)).not.toContain("Invalid body");
    expect(compileChangelog("# Notes\n\n## [Unreleased]\n", "en")).toEqual({
      releases: [], diagnostics: [],
    });
  });

  it("ships both locales without runtime source files and regenerates from each build's inputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "jho-changelog-build-"));
    const pt = join(root, "USER_CHANGELOG.pt-BR.md");
    const en = join(root, "USER_CHANGELOG.en.md");
    const artifact = join(root, "src/generated/changelog.ts");
    try {
      await writeFile(pt, notes("Primeira edição."));
      await writeFile(en, notes("First edition."));
      await generateChangelogs(root);
      const initial = await readFile(artifact, "utf8");
      await generateChangelogs(root);
      expect(await readFile(artifact, "utf8")).toBe(initial);
      await writeFile(pt, notes("Segunda edição."));
      await writeFile(en, notes("Second edition."));
      await generateChangelogs(root);
      await rm(pt);
      await rm(en);
      const built = readBuiltModule(artifact);
      expect(built["pt-BR"][0].html).toContain("Segunda edição");
      expect(built.en[0].html).toContain("Second edition");
      expect(JSON.stringify(built["pt-BR"])).not.toContain("Second edition");
      expect(JSON.stringify(built)).not.toContain("First edition");
      expect(built.en[1].publication).toEqual({ kind: "date", value: "2026-08-21" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails generation when an input is missing instead of publishing a partial artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "jho-changelog-missing-"));
    try {
      await writeFile(join(root, "USER_CHANGELOG.pt-BR.md"), notes("Nota."));
      await expect(generateChangelogs(root)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(join(root, "src/generated/changelog.ts"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not render the release cards or bodies while the dialog is closed", () => {
    const releases = compileChangelog(notes("Private release body."), "en").releases;
    const html = renderToStaticMarkup(createElement(ChangelogModal, {
      releases,
      currentVersion: "2.0.0",
      locale: "en",
      labels: { open: "Open", close: "Close", lead: "Lead", title: "Title" },
    }));
    expect(html).toContain('data-testid="changelog-open"');
    expect(html).not.toContain("Private release body");
    expect(html).not.toContain("changelog-release-");
  });
});
