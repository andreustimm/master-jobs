import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChangelogModal } from "../app/changelog-modal.tsx";
import { Footer } from "../app/footer.tsx";
import { compileChangelog, generateChangelogs } from "../scripts/build-changelog.ts";
import { internalReleases, parseUserChangelog, technicalReleases } from "../src/core/changelog.ts";
import { translator } from "../src/core/i18n/index.ts";

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

/** Technical history: 1.0.0/2.0.0 have notes, 1.1.0 is marked, 0.9.0 and 1.2.0 predate any marker. */
const TECHNICAL = `# Changelog

## [Unreleased]

### Added

- Pending.

## [2.0.0] - 2026-09-22

### Added

- Technical 2.0.0.

## [1.2.0] - 2026-09-21

### Fixed

- Technical 1.2.0.

## [1.1.0] - 2026-09-19

### Fixed

- Technical 1.1.0.

## [1.0.0] - 2026-08-21

### Added

- Technical 1.0.0.

## [0.9.0] - 2026-08-01

### Added

- Technical 0.9.0.
`;

const LABELS = { open: "Open", close: "Close", lead: "Lead", title: "Title", internal: "INTERNAL_LINE" };

function readBuiltModule(path: string) {
  return JSON.parse(execFileSync(process.execPath, [
    "--input-type=module",
    "-e",
    "const {changelogs} = await import(process.argv[1]); console.log(JSON.stringify(changelogs));",
    path,
  ], { encoding: "utf8" }));
}

const summary = (releases: { version: string; publication: unknown; internal?: true }[]) =>
  releases.map(({ version, publication, internal }) => ({ version, publication, internal }));

describe("build-time release history", () => {
  it("compiles visible releases with their original precision and safe HTML", () => {
    const result = compileChangelog(notes("A **bold** note.\n\n<script>alert(1)</script>"), "en", "");
    expect(result.diagnostics).toEqual([]);
    expect(summary(result.releases)).toEqual([
      { version: "2.0.0", publication: { kind: "instant", value: "2026-09-22T10:00:00.000Z" }, internal: undefined },
      { version: "1.1.0", publication: { kind: "date", value: "2026-09-20" }, internal: true },
      { version: "1.0.0", publication: { kind: "date", value: "2026-08-21" }, internal: undefined },
    ]);
    expect(result.releases[0]!.html).toContain('<strong class="font-semibold">bold</strong>');
    expect(result.releases[1]!.html).toBe("");
    expect(JSON.stringify(result.releases)).not.toMatch(/<script|Not published yet|sem-nota-usuario|"markdown"/);
  });

  it("lists every technical version without a user note, retroactively and in order (#340)", () => {
    const result = compileChangelog(notes("Note."), "pt-BR", TECHNICAL);
    expect(summary(result.releases)).toEqual([
      { version: "2.0.0", publication: { kind: "instant", value: "2026-09-22T10:00:00.000Z" }, internal: undefined },
      // No user entry at all: the technical date is the only one there is.
      { version: "1.2.0", publication: { kind: "date", value: "2026-09-21" }, internal: true },
      // Marked in the user file: the marker's own date wins over the technical one.
      { version: "1.1.0", publication: { kind: "date", value: "2026-09-20" }, internal: true },
      { version: "1.0.0", publication: { kind: "date", value: "2026-08-21" }, internal: undefined },
      { version: "0.9.0", publication: { kind: "date", value: "2026-08-01" }, internal: true },
    ]);
    // The technical prose never leaks into the user-facing artifact.
    expect(JSON.stringify(result.releases)).not.toContain("Technical");
    expect(JSON.stringify(result.releases)).not.toContain("Pending");
  });

  it("uses the prefix marker's instant and keeps a marked version the technical file lacks", () => {
    const source = `# Notes

<!-- sem-nota-usuario: 1.2.0 - 2026-09-21T15:00:00.000Z -->
<!-- sem-nota-usuario: 1.3.0 - 2026-09-23 -->
<!-- sem-nota-usuario: 0.9.0 mudança interna -->

## [Unreleased]

## [1.0.0] - 2026-08-21

Note.
`;
    const parsed = parseUserChangelog(source);
    const internal = internalReleases(parsed, technicalReleases(TECHNICAL));
    expect(internal).toEqual([
      { version: "2.0.0", publication: { kind: "date", value: "2026-09-22" } },
      { version: "1.3.0", publication: { kind: "date", value: "2026-09-23" } },
      { version: "1.2.0", publication: { kind: "instant", value: "2026-09-21T15:00:00.000Z" } },
      { version: "1.1.0", publication: { kind: "date", value: "2026-09-19" } },
      // Marker without a date falls back to the technical header.
      { version: "0.9.0", publication: { kind: "date", value: "2026-08-01" } },
    ]);
  });

  it("never calls a version with a malformed user note internal", () => {
    const source = "## [1.2.0] - not-a-date\n\nBroken note.\n\n## [1.0.0] - 2026-08-21\n\nNote.\n";
    const compiled = compileChangelog(source, "en", TECHNICAL);
    expect(compiled.diagnostics).toEqual(["changelog:invalid_publication locale=en version=1.2.0"]);
    expect(compiled.releases.map((release) => release.version)).toEqual(["2.0.0", "1.1.0", "1.0.0", "0.9.0"]);
  });

  it("ignores malformed and duplicated technical headers instead of inventing versions", () => {
    const technical = "## [v1.5] - 2026-09-01\n\n## [1.4.0]\n\n## [1.3.0] - someday\n\n"
      + "## [1.2.0] - 2026-09-21\n\n## [1.2.0] - 2026-09-30\n\n```\n## [9.9.9] - 2026-09-01\n```\n";
    expect(technicalReleases(technical)).toEqual([
      { version: "1.2.0", publication: { kind: "date", value: "2026-09-21" } },
    ]);
  });

  it("isolates malformed entries at build and supports an empty published history", () => {
    const source = "## [v1.2] - 2026-08-22\n\nInvalid body.\n\n" + notes("Valid body.");
    const compiled = compileChangelog(source, "pt-BR", "");
    expect(compiled.diagnostics).toEqual(["changelog:invalid_version locale=pt-BR version=v1.2"]);
    expect(compiled.releases).toHaveLength(3);
    expect(JSON.stringify(compiled.releases)).not.toContain("Invalid body");
    expect(compileChangelog("# Notes\n\n## [Unreleased]\n", "en", "# Changelog\n\n## [Unreleased]\n")).toEqual({
      releases: [], diagnostics: [],
    });
  });

  it("ships both locales without runtime source files and regenerates from each build's inputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "jho-changelog-build-"));
    const pt = join(root, "USER_CHANGELOG.pt-BR.md");
    const en = join(root, "USER_CHANGELOG.en.md");
    const technical = join(root, "CHANGELOG.md");
    const artifact = join(root, "src/generated/changelog.ts");
    try {
      await writeFile(pt, notes("Primeira edição."));
      await writeFile(en, notes("First edition."));
      await writeFile(technical, TECHNICAL);
      await generateChangelogs(root);
      const initial = await readFile(artifact, "utf8");
      await generateChangelogs(root);
      expect(await readFile(artifact, "utf8")).toBe(initial);
      await writeFile(pt, notes("Segunda edição."));
      await writeFile(en, notes("Second edition."));
      await generateChangelogs(root);
      await rm(pt);
      await rm(en);
      await rm(technical);
      const built = readBuiltModule(artifact);
      expect(built["pt-BR"][0].html).toContain("Segunda edição");
      expect(built.en[0].html).toContain("Second edition");
      expect(JSON.stringify(built["pt-BR"])).not.toContain("Second edition");
      expect(JSON.stringify(built)).not.toContain("First edition");
      expect(built.en.map((release: { version: string }) => release.version))
        .toEqual(["2.0.0", "1.2.0", "1.1.0", "1.0.0", "0.9.0"]);
      expect(built.en[3].publication).toEqual({ kind: "date", value: "2026-08-21" });
      expect(built.en[1]).toMatchObject({ version: "1.2.0", internal: true, html: "" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the version without a changelog trigger when the compiled history is empty", () => {
    const releases = compileChangelog("# Notes\n\n## [Unreleased]\n", "en", "").releases;
    const html = renderToStaticMarkup(createElement(Footer, {
      versao: "2.0.0",
      locale: "en",
      t: translator("en").t,
      signedIn: true,
      loadReleases: () => releases,
    }));
    expect(html).toContain('data-app-version="2.0.0"');
    expect(html).toContain("Master Jobs v2.0.0");
    expect(html).not.toContain('data-testid="changelog-open"');
    expect(html).not.toContain('data-testid="changelog-dialog"');
  });

  it("fails generation when an input is missing instead of publishing a partial artifact", async () => {
    for (const present of [
      ["USER_CHANGELOG.pt-BR.md"],
      ["USER_CHANGELOG.pt-BR.md", "USER_CHANGELOG.en.md"],
    ]) {
      const root = await mkdtemp(join(tmpdir(), "jho-changelog-missing-"));
      try {
        for (const file of present) await writeFile(join(root, file), notes("Nota."));
        await expect(generateChangelogs(root)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(readFile(join(root, "src/generated/changelog.ts"))).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  it("shows every version of the real technical history, starting at package.json (#340)", async () => {
    const technical = await readFile("CHANGELOG.md", "utf8");
    const pkg = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
    const published = technicalReleases(technical).map((release) => release.version);
    for (const locale of ["pt-BR", "en"] as const) {
      const source = await readFile(`USER_CHANGELOG.${locale}.md`, "utf8");
      const versions = compileChangelog(source, locale, technical).releases.map((release) => release.version);
      expect(versions[0]).toBe(pkg.version);
      expect(published.filter((version) => !versions.includes(version))).toEqual([]);
    }
  });

  it("does not render the release cards or bodies while the dialog is closed", () => {
    const releases = compileChangelog(notes("Private release body."), "en", TECHNICAL).releases;
    const html = renderToStaticMarkup(createElement(ChangelogModal, {
      releases,
      currentVersion: "2.0.0",
      locale: "en",
      labels: LABELS,
    }));
    expect(html).toContain('data-testid="changelog-open"');
    expect(html).not.toContain("Private release body");
    expect(html).not.toContain("INTERNAL_LINE");
    expect(html).not.toContain("changelog-release-");
  });
});
