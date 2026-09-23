// Suite: changelog fragments
// Invariant: the release folds `changelog.d/` into Unreleased deterministically,
// and two PRs that each add a fragment never touch the same file.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseUserChangelog } from "../src/core/changelog.ts";
import {
  ChangelogFragmentError,
  mergeChangelogFragments,
  parseChangelogFragments,
  type ChangelogFragment,
} from "../src/core/changelog-fragments.ts";
import { prepareRelease, validarReleasePendente } from "../src/core/release.ts";
import { applyReleaseFiles } from "../scripts/release/versionar.ts";

const NOW = new Date("2026-09-22T15:00:00.000Z");
const EMPTY = {
  technical: "# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-09-01\n\n- Base.\n",
  ptBR: "# Novidades\n\n## [Unreleased]\n\n## [1.0.0] - 2026-09-01T00:00:00.000Z\n\n- Base.\n",
  en: "# What's New\n\n## [Unreleased]\n\n## [1.0.0] - 2026-09-01T00:00:00.000Z\n\n- Base.\n",
};

function fragment(name: string, options: { section?: string; text?: string; omitted?: boolean } = {}): ChangelogFragment {
  const section = options.section ?? "Corrigido";
  const text = options.text ?? name;
  const user = (heading: string) => options.omitted
    ? "<!-- sem-nota-usuario -->"
    : `### ${heading}\n\n- ${text} visível.`;
  return {
    name,
    content: `## Técnico\n\n### ${section}\n\n- ${text} técnico.\n  Continuação.\n\n## pt-BR\n\n${user(section)}\n\n## en\n\n${user(section === "Corrigido" ? "Fixed" : "New")}\n`,
  };
}

function code(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ChangelogFragmentError);
    return (error as ChangelogFragmentError).code;
  }
  throw new Error("expected a fragment error");
}

describe("fragment format", () => {
  const valid = fragment("ok.md").content;

  it.each([
    ["invalid_name", [{ name: "Maiúscula.md", content: valid }]],
    ["invalid_name", [{ name: "sub/ok.md", content: valid }]],
    ["invalid_name", [{ name: "ok.MD", content: valid }]],
    ["duplicate_name", [{ name: "ok.md", content: valid }, { name: "ok.md", content: valid }]],
    ["missing_block", [{ name: "ok.md", content: valid.replace(/## en[\s\S]*$/, "") }]],
    ["duplicate_block", [{ name: "ok.md", content: `${valid}\n## en\n\n### Fixed\n\n- Again.\n` }]],
    ["unknown_block", [{ name: "ok.md", content: `${valid}\n## es\n\n### Arreglado\n\n- Uno.\n` }]],
    ["forbidden_heading", [{ name: "ok.md", content: `${valid}\n## [2.0.0] - 2026-01-01\n` }]],
    ["forbidden_heading", [{ name: "ok.md", content: `# Título\n\n${valid}` }]],
    ["unclosed_fence", [{ name: "ok.md", content: `${valid}\n  \`\`\`\n  ## [1.0.0] - 2026-01-01\n` }]],
    ["content_outside_section", [{ name: "ok.md", content: `Solto.\n\n${valid}` }]],
    ["content_outside_section", [{ name: "ok.md", content: valid.replace("## pt-BR\n\n", "## pt-BR\n\nSolto.\n\n") }]],
    ["empty_block", [{ name: "ok.md", content: valid.replace(/### Corrigido\n\n- ok.md técnico.\n  Continuação.\n/, "") }]],
    ["empty_section", [{ name: "ok.md", content: valid.replace("- ok.md técnico.\n  Continuação.", "<!-- nada -->") }]],
    ["section_not_list", [{ name: "ok.md", content: valid.replace("- ok.md técnico.", "Parágrafo.") }]],
    ["invalid_omission", [{ name: "ok.md", content: valid.replace("## pt-BR\n\n", "## pt-BR\n\n<!-- sem-nota-usuario -->\n\n") }]],
    ["invalid_omission", [{ name: "ok.md", content: valid.replace("## Técnico\n\n", "## Técnico\n\n<!-- sem-nota-usuario -->\n\n") }]],
    ["localized_visibility_mismatch", [{ name: "ok.md", content: valid.replace(/## en[\s\S]*$/, "## en\n\n<!-- sem-nota-usuario -->\n") }]],
  ] as const)("rejects %s", (expected, fragments) => {
    expect(code(() => parseChangelogFragments(fragments))).toBe(expected);
  });

  it("keeps headings inside code blocks as content and sanitizes the reported name", () => {
    const fenced = valid.replace("  Continuação.", "\n  ```\n  ## [9.9.9] - 2026-01-01\n  ```");
    expect(parseChangelogFragments([{ name: "ok.md", content: fenced }])).toHaveLength(1);
    // A wrapped line that starts with a PR reference is content, not a heading.
    const wrapped = valid.replace("  Continuação.", "#228 e #229 no começo da linha.");
    expect(parseChangelogFragments([{ name: "ok.md", content: wrapped }])).toHaveLength(1);
    expect(code(() => parseChangelogFragments([{ name: "ok.md", content: `##[1.0.0]\n\n${valid}` }])))
      .toBe("forbidden_heading");
    const error = new ChangelogFragmentError("invalid_name", "a\u001b[31m.md");
    expect(error.message).toBe("changelog_fragment_invalid code=invalid_name fragment=a??31m.md");
  });
});

describe("merge into Unreleased", () => {
  it("returns the documents byte-identical without fragments", () => {
    expect(mergeChangelogFragments(EMPTY, [])).toBe(EMPTY);
  });

  it("orders by name regardless of listing order and joins one tight list per section", () => {
    const forward = mergeChangelogFragments(EMPTY, [fragment("a.md"), fragment("b.md"), fragment("c.md", { section: "Adicionado" })]);
    const shuffled = mergeChangelogFragments(EMPTY, [fragment("c.md", { section: "Adicionado" }), fragment("b.md"), fragment("a.md")]);
    expect(shuffled).toEqual(forward);
    expect(forward.technical).toContain(
      "## [Unreleased]\n\n### Corrigido\n\n- a.md técnico.\n  Continuação.\n- b.md técnico.\n  Continuação.\n\n### Adicionado\n\n- c.md técnico.\n  Continuação.\n\n## [1.0.0]",
    );
    expect(forward.en).toContain("### Fixed\n\n- a.md visível.\n- b.md visível.\n\n### New\n\n- c.md visível.\n\n## [1.0.0]");
  });

  it("keeps legacy Unreleased entries first and appends fragments to the same section", () => {
    const legacy = {
      ...EMPTY,
      technical: EMPTY.technical.replace("## [Unreleased]\n", "## [Unreleased]\n\n\n### Corrigido\n\n- Legado.\n"),
    };
    const merged = mergeChangelogFragments(legacy, [fragment("a.md")]);
    expect(merged.technical).toContain("### Corrigido\n\n- Legado.\n- a.md técnico.");
  });

  it("drops a legacy no-user-change marker once content arrives, and writes one when nothing does", () => {
    const marked = {
      ...EMPTY,
      ptBR: EMPTY.ptBR.replace("## [Unreleased]\n", "## [Unreleased]\n\n<!-- sem-nota-usuario -->\n"),
      en: EMPTY.en.replace("## [Unreleased]\n", "## [Unreleased]\n\n<!-- sem-nota-usuario -->\n"),
    };
    const visible = mergeChangelogFragments(marked, [fragment("a.md")]);
    expect(visible.ptBR).not.toContain("sem-nota-usuario -->\n\n### ");
    expect(visible.ptBR).toContain("## [Unreleased]\n\n### Corrigido\n\n- a.md visível.");

    const internal = mergeChangelogFragments(EMPTY, [fragment("a.md", { omitted: true })]);
    expect(internal.en).toContain("## [Unreleased]\n\n<!-- sem-nota-usuario -->\n\n## [1.0.0]");
    expect(mergeChangelogFragments(marked, [fragment("a.md", { omitted: true })]).ptBR).toBe(marked.ptBR);
  });

  it("leaves a missing Unreleased for prepareRelease to report with its own code", () => {
    const broken = { ...EMPTY, technical: "# Changelog\n\n## [1.0.0] - 2026-09-01\n\n- Base.\n" };
    expect(mergeChangelogFragments(broken, [fragment("a.md")]).technical).toBe(broken.technical);
    expect(() => prepareRelease({ documents: broken, version: "1.0.1", publishedAt: NOW, fragments: [fragment("a.md")] }))
      .toThrow("missing_unreleased");
  });
});

describe("release with fragments", () => {
  it("stamps visible and omitted locales from fragments alone", () => {
    const visible = prepareRelease({ documents: EMPTY, version: "1.1.0", publishedAt: NOW, fragments: [fragment("a.md")] });
    expect(visible.status).toBe("prepared");
    expect(parseUserChangelog(visible.documents.ptBR).releases[0]).toMatchObject({
      version: "1.1.0",
      markdown: "### Corrigido\n\n- a.md visível.",
    });
    expect(visible.documents.technical).toContain("## [Unreleased]\n\n## [1.1.0] - 2026-09-22\n\n### Corrigido");

    const internal = prepareRelease({ documents: EMPTY, version: "1.0.1", publishedAt: NOW, fragments: [fragment("a.md", { omitted: true })] });
    expect(parseUserChangelog(internal.documents.en).omitted.map((entry) => entry.version)).toContain("1.0.1");
  });

  it("accepts a fragment as the releasable note and rejects a malformed one even without bump", () => {
    const base = { subjects: ["fix: x"], currentVersion: "1.0.0", documents: EMPTY, publishedAt: NOW };
    expect(() => validarReleasePendente(base)).toThrow();
    expect(validarReleasePendente({ ...base, fragments: [fragment("a.md")] })).toEqual({ status: "ready", version: "1.0.1" });
    expect(code(() => validarReleasePendente({
      ...base,
      subjects: ["docs: y"],
      fragments: [{ name: "a.md", content: "solto" }],
    }))).toBe("content_outside_section");
  });

  it("ignores fragments when the version already exists, so a tag retry never consumes them", () => {
    const released = prepareRelease({ documents: EMPTY, version: "1.0.1", publishedAt: NOW, fragments: [fragment("a.md")] });
    const retry = prepareRelease({
      documents: released.documents,
      version: "1.0.1",
      publishedAt: new Date("2026-09-30T00:00:00.000Z"),
      fragments: [fragment("b.md"), { name: "Invalido.md", content: "" }],
    });
    expect(retry).toEqual({ status: "already-released", documents: released.documents });
  });
});

describe("filesystem and Git boundary", () => {
  function workspace(): string {
    const directory = mkdtempSync(join(tmpdir(), "jho-fragments-"));
    writeFileSync(join(directory, "CHANGELOG.md"), EMPTY.technical);
    writeFileSync(join(directory, "USER_CHANGELOG.pt-BR.md"), EMPTY.ptBR);
    writeFileSync(join(directory, "USER_CHANGELOG.en.md"), EMPTY.en);
    writeFileSync(join(directory, "package.json"), '{\n  "version": "1.0.0"\n}\n');
    return directory;
  }

  it("applyReleaseFiles consumes the fragments it stamped and keeps them on a retry", () => {
    const directory = workspace();
    try {
      mkdirSync(join(directory, "changelog.d"));
      writeFileSync(join(directory, "changelog.d/b.md"), fragment("b.md").content);
      writeFileSync(join(directory, "changelog.d/a.md"), fragment("a.md").content);
      expect(applyReleaseFiles({ directory, version: "1.0.1", publishedAt: NOW }).status).toBe("prepared");
      expect(existsSync(join(directory, "changelog.d/a.md"))).toBe(false);
      expect(existsSync(join(directory, "changelog.d/b.md"))).toBe(false);
      expect(readFileSync(join(directory, "CHANGELOG.md"), "utf8")).toContain("- a.md técnico.\n  Continuação.\n- b.md técnico.");

      // A fragment that arrives after the release belongs to the next version.
      writeFileSync(join(directory, "changelog.d/c.md"), fragment("c.md").content);
      expect(applyReleaseFiles({ directory, version: "1.0.1", publishedAt: NOW }).status).toBe("already-released");
      expect(existsSync(join(directory, "changelog.d/c.md"))).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects a stray file in changelog.d before writing anything", () => {
    const directory = workspace();
    try {
      mkdirSync(join(directory, "changelog.d"));
      writeFileSync(join(directory, "changelog.d/notas.txt"), "x");
      const before = readFileSync(join(directory, "CHANGELOG.md"), "utf8");
      expect(code(() => applyReleaseFiles({ directory, version: "1.0.1", publishedAt: NOW }))).toBe("invalid_name");
      expect(readFileSync(join(directory, "CHANGELOG.md"), "utf8")).toBe(before);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("two PRs that each add a fragment merge without conflict", () => {
    const repo = mkdtempSync(join(tmpdir(), "jho-fragments-git-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
    try {
      git("init", "-q", "-b", "dev");
      git("config", "user.name", "Fragment Test");
      git("config", "user.email", "fragment@example.test");
      writeFileSync(join(repo, "CHANGELOG.md"), EMPTY.technical);
      git("add", ".");
      git("commit", "-qm", "chore: base");
      for (const branch of ["a", "b"]) {
        git("switch", "-q", "-c", branch, "dev");
        mkdirSync(join(repo, "changelog.d"), { recursive: true });
        writeFileSync(join(repo, `changelog.d/${branch}.md`), fragment(`${branch}.md`).content);
        git("add", ".");
        git("commit", "-qm", `fix: ${branch}`);
      }
      git("switch", "-q", "dev");
      git("merge", "-q", "--no-ff", "a", "-m", "Merge a");
      git("merge", "-q", "--no-ff", "b", "-m", "Merge b");
      expect(git("ls-files", "changelog.d").split("\n")).toEqual(["changelog.d/a.md", "changelog.d/b.md"]);
      expect(git("show", "HEAD:CHANGELOG.md")).toBe(EMPTY.technical.trim());
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
