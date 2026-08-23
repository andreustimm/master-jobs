import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChangelogMarkdown, safeChangelogUrl } from "../app/changelog-markdown.tsx";
import {
  initialExpanded,
  releaseIds,
  toggleExpanded,
  type ChangelogModalProps,
} from "../app/changelog-modal.tsx";
import {
  ChangelogDomainError,
  changelogFile,
  formatChangelogDiagnostic,
  formatPublication,
  parseUserChangelog,
  validateLocalizedChangelogs,
  versaoAtual,
  type ChangelogParseResult,
} from "../src/core/changelog.ts";
import { en } from "../src/core/i18n/en.ts";
import { DEFAULT_LOCALE, resolveLocale } from "../src/core/i18n/index.ts";
import { ptBR } from "../src/core/i18n/pt-BR.ts";

function release(version: string, publication: string, body = "### New\n\n- Visible change."): string {
  return `## [${version}] - ${publication}\n\n${body}\n`;
}

function expectDomainCode(action: () => void, code: string): ChangelogDomainError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ChangelogDomainError);
    expect((error as ChangelogDomainError).code).toBe(code);
    return error as ChangelogDomainError;
  }
  throw new Error(`expected ${code}`);
}

describe("parseUserChangelog", () => {
  it("UT-001 parses a canonical UTC instant", () => {
    const result = parseUserChangelog(release("1.2.0", "2026-08-22T11:46:00.000Z"));
    expect(result.releases[0]).toMatchObject({
      version: "1.2.0",
      publication: { kind: "instant", value: "2026-08-22T11:46:00.000Z" },
    });
  });

  it("UT-002 preserves historical date-only precision", () => {
    const result = parseUserChangelog(release("1.1.0", "2026-08-21"));
    expect(result.releases[0]!.publication).toEqual({ kind: "date", value: "2026-08-21" });
  });

  it("UT-003 preserves wrapped Markdown body bytes", () => {
    const body = "- First physical line\n  second physical line\n  third physical line\n\nA paragraph\nwrapped again.";
    const result = parseUserChangelog(release("1.2.0", "2026-08-22", body));
    expect(result.releases[0]!.markdown).toBe(body);
  });

  it("UT-003 preserves fenced release-like text and omission examples as body bytes", () => {
    const body = `Before.

Use \`<!-- sem-nota-usuario -->\` only as documentation.

    <!-- sem-nota-usuario -->

\`\`\`md
## [9.9.9] - 2026-08-22
<!-- sem-nota-usuario -->
\`\`\`

After.`;
    const result = parseUserChangelog(release("1.2.0", "2026-08-22", body));
    expect(result).toMatchObject({ issues: [], omitted: [] });
    expect(result.releases).toEqual([
      expect.objectContaining({ version: "1.2.0", markdown: body }),
    ]);
  });

  it("UT-003 preserves a leading indented omission example as visible code", () => {
    const body = "    <!-- sem-nota-usuario -->";
    const result = parseUserChangelog(release("1.2.0", "2026-08-22", body));
    expect(result).toMatchObject({ issues: [], omitted: [] });
    expect(result.releases).toEqual([
      expect.objectContaining({ version: "1.2.0", markdown: body }),
    ]);
  });

  it("UT-003 preserves a linked level-two heading inside release Markdown", () => {
    const body = "Before.\n\n## [2FA setup](https://example.com/2fa)\n\nAfter.";
    const result = parseUserChangelog(release("1.2.0", "2026-08-22", body));
    expect(result.issues).toEqual([]);
    expect(result.releases[0]!.markdown).toBe(body);
  });

  it("UT-003 preserves a date-suffixed editorial heading inside release Markdown", () => {
    const body = "Before.\n\n## [Availability] - 2026-08-23\n\nAfter.";
    const result = parseUserChangelog(release("1.2.0", "2026-08-22", body));
    expect(result.issues).toEqual([]);
    expect(result.releases[0]!.markdown).toBe(body);
  });

  it("UT-004 delimits complete bodies at version headers", () => {
    const result = parseUserChangelog(
      `${release("1.1.0", "2026-08-21", "First body")}${release("1.0.0", "2026-08-20", "Second body")}`,
    );
    expect(result.releases.find((item) => item.version === "1.1.0")!.markdown).toBe("First body");
    expect(result.releases.find((item) => item.version === "1.0.0")!.markdown).toBe("Second body");
  });

  it("UT-005 isolates an invalid version and keeps the next release", () => {
    const result = parseUserChangelog(
      `${release("v1.2", "2026-08-22")}${release("1.1.0", "2026-08-21")}`,
    );
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "invalid_version", version: "v1.2" }));
    expect(result.releases.map((item) => item.version)).toEqual(["1.1.0"]);
  });

  it("UT-005 isolates a release heading with missing version brackets", () => {
    const result = parseUserChangelog(
      `## 1.2.0 - 2026-08-22\n\nMalformed\n\n${release("1.1.0", "2026-08-21", "Valid")}`,
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "invalid_version", version: "1.2.0" }),
    );
    expect(result.releases).toEqual([
      expect.objectContaining({ version: "1.1.0", markdown: "Valid" }),
    ]);
  });

  it("UT-005 isolates a release heading with an unmatched opening bracket", () => {
    const result = parseUserChangelog(
      `${release("1.2.0", "2026-08-22", "First")}## [1.1.0 - 2026-08-21\n\nMalformed\n\n${release("1.0.0", "2026-08-20", "Valid")}`,
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "invalid_version", version: "1.1.0" }),
    );
    expect(result.releases.map((item) => item.version)).toEqual(["1.2.0", "1.0.0"]);
    expect(result.releases[0]!.markdown).toBe("First");
  });

  it("UT-005 isolates a release candidate with invalid version and publication", () => {
    const result = parseUserChangelog(
      `${release("1.3.0", "2026-08-22", "First")}## [1.2.3.4] - tomorrow\n\nMalformed\n\n${release("1.1.0", "2026-08-20", "Valid")}`,
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "invalid_version", version: "1.2.3.4" }),
    );
    expect(result.releases.map((item) => item.version)).toEqual(["1.3.0", "1.1.0"]);
    expect(result.releases[0]!.markdown).toBe("First");
  });

  it("UT-005 isolates malformed semantic-version suffixes", () => {
    for (const token of [
      "1.2.3-beta",
      "1.2.3+build.1",
      "1.2.3-beta+build.1",
      "1.2.3-alpha_beta",
      "1.2.3-alpha@beta",
      "1.2.3+build/meta",
      "1.2.3-",
      "1.2.3+",
      "1.2.3-alpha+",
      "1.2.x",
    ]) {
      const result = parseUserChangelog(
        `${release("2.0.0", "2026-08-23", "First")}## [${token}] - 2026-08-22\n\nMalformed\n\n${release("1.0.0", "2026-08-21", "Valid")}`,
      );
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: "invalid_version",
          version: token.replace(/[@/]/g, "?"),
        }),
      );
      expect(result.releases.map((item) => item.version)).toEqual(["2.0.0", "1.0.0"]);
      expect(result.releases[0]!.markdown).toBe("First");
    }
  });

  it("UT-005 isolates suffix candidates with missing or absent brackets", () => {
    for (const heading of [
      "## [1.2.3-beta - 2026-08-22",
      "## [1.2.3-beta+build.1 - 2026-08-22",
      "## [1.2.3-alpha_beta - 2026-08-22",
      "## [1.2.3-alpha+ - 2026-08-22",
      "## 1.2.3+build.1 - 2026-08-22",
      "## 1.2.3+build/meta - 2026-08-22",
      "## 1.2.3-beta+build.1 - 2026-08-22",
      "## 1.2.3+ - 2026-08-22",
    ]) {
      const result = parseUserChangelog(
        `${release("2.0.0", "2026-08-23", "First")}${heading}\n\nMalformed\n\n${release("1.0.0", "2026-08-21", "Valid")}`,
      );
      expect(result.issues).toContainEqual(expect.objectContaining({ code: "invalid_version" }));
      expect(result.releases.map((item) => item.version)).toEqual(["2.0.0", "1.0.0"]);
      expect(result.releases[0]!.markdown).toBe("First");
    }
  });

  it("rejects a publication whose release header omits the delimiter", () => {
    const result = parseUserChangelog(
      `## [1.2.0] 2026-08-22\n\nMalformed\n\n${release("1.1.0", "2026-08-21", "Valid")}`,
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "invalid_publication", version: "1.2.0" }),
    );
    expect(result.releases.map((item) => item.version)).toEqual(["1.1.0"]);
  });

  it("UT-006 rejects impossible calendar dates", () => {
    const result = parseUserChangelog(
      `${release("1.2.0", "2026-02-30")}${release("1.1.0", "2026-13-01")}`,
    );
    expect(result.releases).toEqual([]);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "invalid_publication",
      "invalid_publication",
    ]);
  });

  it("UT-007 rejects timestamps with a numeric offset", () => {
    const result = parseUserChangelog(release("1.2.0", "2026-08-22T11:46:00-03:00"));
    expect(result.releases).toEqual([]);
    expect(result.issues[0]!.code).toBe("invalid_publication");
  });

  it("isolates a malformed publication header without consuming its sibling", () => {
    const result = parseUserChangelog(
      `${release("1.2.0", "2026-08-22 extra", "Malformed")}${release("1.1.0", "2026-08-21", "Valid")}`,
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "invalid_publication", version: "1.2.0" }),
    );
    expect(result.releases).toEqual([
      expect.objectContaining({ version: "1.1.0", markdown: "Valid" }),
    ]);
  });

  it("sanitizes invalid version tokens before diagnostics", () => {
    const result = parseUserChangelog(release("\u001B[2J\u202Ebad version", "2026-08-22"));
    expect(result.issues[0]).toMatchObject({ code: "invalid_version" });
    expect(result.issues[0]!.version).toMatch(/^[A-Za-z0-9._+?-]{1,64}$/);
    expect(result.issues[0]!.version).not.toMatch(/[\u001B\u202E]/);
  });

  it("UT-008 returns an empty result for empty and title-only documents", () => {
    for (const source of ["", "# What's New\n"]) {
      expect(parseUserChangelog(source)).toEqual({ releases: [], omitted: [], issues: [] });
    }
  });

  it("UT-009 sorts numeric semantic versions newest first", () => {
    const result = parseUserChangelog(
      `${release("1.2.0", "2026-08-20")}${release("2.0.0", "2026-08-22")}${release("1.10.0", "2026-08-21")}`,
    );
    expect(result.releases.map((item) => item.version)).toEqual(["2.0.0", "1.10.0", "1.2.0"]);
  });

  it("UT-009 sorts arbitrary-length semantic components without precision loss", () => {
    const lower = "1.0.9007199254740992";
    const higher = "1.0.9007199254740993";
    const result = parseUserChangelog(
      `${release(lower, "2026-08-20")}${release(higher, "2026-08-21")}`,
    );
    expect(result.releases.map((item) => item.version)).toEqual([higher, lower]);
  });

  it("UT-010 reports a duplicate and exposes one release identity", () => {
    const result = parseUserChangelog(
      `${release("1.2.0", "2026-08-22", "First")}${release("1.2.0", "2026-08-22", "Second")}`,
    );
    expect(result.releases).toHaveLength(1);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "duplicate_version", version: "1.2.0" }));
  });

  it("UT-011 rejects whitespace and ordinary comments as an empty body", () => {
    const result = parseUserChangelog(release("1.2.0", "2026-08-22", "  \n<!-- editorial -->\n"));
    expect(result.releases).toEqual([]);
    expect(result.issues[0]!.code).toBe("empty_body");
  });

  it("UT-012 excludes Unreleased without consuming its body", () => {
    const source = `## [Unreleased]\n\n- Future multiline\n  content stays here.\n\n${release("1.1.0", "2026-08-21")}`;
    const result = parseUserChangelog(source);
    expect(result.releases.map((item) => item.version)).toEqual(["1.1.0"]);
    expect(source).toContain("- Future multiline\n  content stays here.");
  });
});

describe("validateLocalizedChangelogs", () => {
  it("UT-013 accepts equal metadata with idiomatic prose", () => {
    const pt = parseUserChangelog(`${release("1.2.0", "2026-08-22", "Mudou.")}${release("1.1.0", "2026-08-21", "Antes.")}`);
    const en = parseUserChangelog(`${release("1.2.0", "2026-08-22", "Changed.")}${release("1.1.0", "2026-08-21", "Before.")}`);
    expect(() => validateLocalizedChangelogs(pt, en)).not.toThrow();
  });

  it("UT-014 identifies a version missing from English", () => {
    const pt = parseUserChangelog(`${release("1.2.0", "2026-08-22")}${release("1.1.0", "2026-08-21")}`);
    const en = parseUserChangelog(release("1.2.0", "2026-08-22"));
    const error = expectDomainCode(() => validateLocalizedChangelogs(pt, en), "localized_version_mismatch");
    expect(error).toMatchObject({ locale: "en", version: "1.1.0" });
    expect(error.message).not.toContain("Visible change");
  });

  it("UT-015 rejects instant-versus-date precision drift", () => {
    expectDomainCode(
      () => validateLocalizedChangelogs(
        parseUserChangelog(release("1.1.0", "2026-08-21T11:46:00.000Z")),
        parseUserChangelog(release("1.1.0", "2026-08-21")),
      ),
      "localized_publication_mismatch",
    );
  });

  it("UT-016 rejects different UTC instants", () => {
    expectDomainCode(
      () => validateLocalizedChangelogs(
        parseUserChangelog(release("1.1.0", "2026-08-21T11:46:00.000Z")),
        parseUserChangelog(release("1.1.0", "2026-08-21T11:47:00.000Z")),
      ),
      "localized_publication_mismatch",
    );
  });

  it("UT-017 reports a blank counterpart as localized content missing", () => {
    const blank = parseUserChangelog(release("1.1.0", "2026-08-21", "<!-- translator note -->"));
    expectDomainCode(
      () => validateLocalizedChangelogs(parseUserChangelog(release("1.1.0", "2026-08-21")), blank),
      "localized_content_missing",
    );
  });

  it("UT-018 accepts symmetric no-user-change metadata", () => {
    const omitted = release("1.1.0", "2026-08-21", "<!-- sem-nota-usuario -->");
    const pt = parseUserChangelog(omitted);
    const en = parseUserChangelog(omitted);
    expect(pt.releases).toEqual([]);
    expect(() => validateLocalizedChangelogs(pt, en)).not.toThrow();
  });

  it("UT-019 rejects hidden-versus-visible locale drift", () => {
    expectDomainCode(
      () => validateLocalizedChangelogs(
        parseUserChangelog(release("1.1.0", "2026-08-21", "<!-- sem-nota-usuario -->")),
        parseUserChangelog(release("1.1.0", "2026-08-21")),
      ),
      "localized_visibility_mismatch",
    );
  });

  it("rejects an omission marker that coexists with visible notes", () => {
    const result = parseUserChangelog(
      release("1.1.0", "2026-08-21", "<!-- sem-nota-usuario -->\n\n- Visible change."),
    );
    expect(result.releases).toEqual([]);
    expect(result.omitted).toEqual([]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "invalid_omission", version: "1.1.0" }),
    );
  });
});

describe("formatPublication", () => {
  const instant = { kind: "instant", value: "2026-08-22T11:46:00.000Z" } as const;

  it("UT-030 formats exact Brazilian Portuguese local time", () => {
    expect(formatPublication(instant, "pt-BR", "America/Sao_Paulo")).toBe("22/08/2026 08:46");
  });

  it("UT-031 formats exact English local time", () => {
    expect(formatPublication(instant, "en", "America/Sao_Paulo")).toBe("08/22/2026 08:46");
  });

  it("UT-032 keeps a Portuguese date free of time", () => {
    expect(formatPublication({ kind: "date", value: "2026-08-21" }, "pt-BR")).toBe("21/08/2026");
  });

  it("UT-033 keeps an English date free of time", () => {
    expect(formatPublication({ kind: "date", value: "2026-08-21" }, "en")).toBe("08/21/2026");
  });

  it("UT-034 converts across the UTC year boundary", () => {
    expect(
      formatPublication(
        { kind: "instant", value: "2027-01-01T01:30:00.000Z" },
        "pt-BR",
        "America/Sao_Paulo",
      ),
    ).toBe("31/12/2026 22:30");
  });

  it("UT-035 follows Intl on both sides of New York's DST jump", () => {
    expect(formatPublication({ kind: "instant", value: "2026-03-08T06:30:00.000Z" }, "en", "America/New_York")).toBe("03/08/2026 01:30");
    expect(formatPublication({ kind: "instant", value: "2026-03-08T07:30:00.000Z" }, "en", "America/New_York")).toBe("03/08/2026 03:30");
  });

  it("UT-036 refuses impossible values and non-UTC instants", () => {
    expect(formatPublication({ kind: "date", value: "2026-02-30" }, "en")).toBeNull();
    expect(formatPublication({ kind: "instant", value: "2026-08-22T11:46:00-03:00" }, "en")).toBeNull();
  });
});

describe("safe changelog Markdown", () => {
  const renderMarkdown = (markdown: string) =>
    renderToStaticMarkup(createElement(ChangelogMarkdown, { markdown }));

  it("UT-037 preserves HTTP and HTTPS destinations", () => {
    expect(safeChangelogUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeChangelogUrl("http://example.com/a")).toBe("http://example.com/a");
  });

  it("UT-038 preserves approved relative destinations", () => {
    for (const destination of ["/jobs/1", "./details", "#section"]) {
      expect(safeChangelogUrl(destination)).toBe(destination);
    }
  });

  it("UT-039 preserves mailto destinations", () => {
    expect(safeChangelogUrl("mailto:person@example.com")).toBe("mailto:person@example.com");
  });

  it("UT-040 rejects unsafe protocols and malformed destinations", () => {
    for (const destination of [
      "javascript:alert(1)",
      "data:text/html,unsafe",
      "file:///tmp/secret",
      "vbscript:msgbox(1)",
      "https://[invalid",
      "//example.com/protocol-relative",
    ]) {
      expect(safeChangelogUrl(destination), destination).toBe("");
    }
  });

  it("UT-041 keeps raw script HTML inert", () => {
    const html = renderMarkdown("Before\n\n<script>alert(1)</script>\n\nAfter");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onclick=");
    expect(html).toContain("Before");
    expect(html).toContain("After");
  });

  it("blocks Markdown images instead of issuing a resource request", () => {
    const html = renderMarkdown("Before ![private export](/api/export) After");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("/api/export");
  });

  it("UT-042 renders the complete editorial element set semantically", () => {
    const html = renderMarkdown(`# Heading 1

## Heading 2

### Heading 3

#### Heading 4

##### Heading 5

###### Heading 6

Paragraph with **strong**, *emphasis*, \`inline code\`, and a [safe link](/jobs/1).

- unordered

1. ordered

\`\`\`ts
const safe = true;
\`\`\`

> quoted

---`);

    for (const element of ["h1", "h2", "h3", "h4", "h5", "h6", "p", "strong", "em", "code", "a", "ul", "ol", "li", "pre", "blockquote", "hr"]) {
      expect(html, element).toMatch(new RegExp(`<${element}(?: |>)`));
    }
    expect(html).toContain('href="/jobs/1"');
    expect(html).toContain("type-display-sm");
    expect(html).toContain("type-body-md");
  });

  it("UT-043 keeps malformed Markdown readable", () => {
    const html = renderMarkdown("Readable *unfinished emphasis\n\n```ts\nconst stillHere = true;");
    expect(html).toContain("Readable *unfinished emphasis");
    expect(html).toContain("const stillHere = true;");
  });
});

describe("changelog modal state", () => {
  it("UT-044 initializes with only the newest release", () => {
    expect([...initialExpanded(["1.2.0", "1.1.0"])]).toEqual(["1.2.0"]);
  });

  it("UT-045 expands one release without closing its sibling", () => {
    expect([...toggleExpanded(new Set(["1.2.0"]), "1.1.0")]).toEqual(["1.2.0", "1.1.0"]);
  });

  it("UT-046 collapses only the selected release", () => {
    expect([...toggleExpanded(new Set(["1.2.0", "1.1.0"]), "1.2.0")]).toEqual(["1.1.0"]);
  });

  it("UT-047 resets prior choices on the next open cycle", () => {
    const changed = toggleExpanded(new Set(["1.2.0"]), "1.1.0");
    expect(changed.size).toBe(2);
    expect([...initialExpanded(["1.2.0", "1.1.0"])]).toEqual(["1.2.0"]);
  });

  it("UT-048 handles an empty history without an invalid identifier", () => {
    expect([...initialExpanded([])]).toEqual([]);
    expect(releaseIds("")).toBeNull();
  });

  it("UT-049 derives stable distinct safe disclosure identifiers", () => {
    const first = releaseIds("1.2.0");
    expect(first).toEqual(releaseIds("1.2.0"));
    expect(first?.headerId).not.toBe(first?.contentId);
    expect(first?.headerId).toMatch(/^[a-zA-Z][a-zA-Z0-9_-]*$/);
    expect(first?.contentId).toMatch(/^[a-zA-Z][a-zA-Z0-9_-]*$/);
  });
});

describe("localized footer boundary", () => {
  it("UT-050 selects only a supported locale file", () => {
    expect(changelogFile("pt-BR")).toBe("USER_CHANGELOG.pt-BR.md");
    expect(changelogFile("en")).toBe("USER_CHANGELOG.en.md");
    expect(changelogFile("../../private.env")).toBeNull();
    expect(changelogFile(null)).toBeNull();
  });

  it("IT-004 declares the safe production renderer and keeps hostile output inert", async () => {
    const pkg = JSON.parse(await readFile("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.["react-markdown"]).toBeTruthy();
    expect(pkg.dependencies?.["rehype-raw"]).toBeUndefined();
    expect(pkg.devDependencies?.["rehype-raw"]).toBeUndefined();

    const html = renderToStaticMarkup(
      createElement(ChangelogMarkdown, {
        markdown: "[unsafe](javascript:alert(2))\n\n<script>alert(1)</script>",
      }),
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain("href=\"\"");
    expect(html).toContain("unsafe");
  });

  it("IT-012 keeps changelog labels typed and locale fallback coherent", () => {
    expect(Object.keys(en.changelog).sort()).toEqual(Object.keys(ptBR.changelog).sort());
    expect(resolveLocale("unsupported")).toBe(DEFAULT_LOCALE);
  });

  it("IT-015 keeps Server-to-Client props JSON-serializable", async () => {
    const props: ChangelogModalProps = {
      currentVersion: "1.2.0",
      locale: "en",
      releases: [
        {
          version: "1.2.0",
          publication: { kind: "date", value: "2026-08-22" },
          markdown: "Visible change.",
        },
      ],
      labels: { open: "Open", title: "Title", lead: "Lead", close: "Close" },
    };
    expect(JSON.parse(JSON.stringify(props))).toEqual(props);

    const [footer, modal] = await Promise.all([
      readFile("app/footer.tsx", "utf8"),
      readFile("app/changelog-modal.tsx", "utf8"),
    ]);
    expect(footer).not.toContain('"use client"');
    expect(modal).not.toMatch(/Translator|readFile|node:fs|Date\b/);
  });
});

describe("diagnostics and current version", () => {
  it("UT-051 emits code, locale, and version without source prose", () => {
    const diagnostic = formatChangelogDiagnostic(
      { code: "invalid_publication", version: "1.2.0", line: 9 },
      "en",
    );
    expect(diagnostic).toContain("invalid_publication");
    expect(diagnostic).toContain("locale=en");
    expect(diagnostic).toContain("version=1.2.0");
    expect(diagnostic).not.toContain("secret release prose");
  });

  it("UT-052 returns package version and falls back for unusable values", () => {
    expect(versaoAtual({ version: "1.2.3" })).toBe("1.2.3");
    for (const input of [{}, { version: "" }, { version: "   " }, { version: null }, { version: 2 }]) {
      expect(versaoAtual(input as { version?: unknown })).toBe("0.0.0");
    }
  });
});

describe("localized repository integration", () => {
  async function realParses(): Promise<[ChangelogParseResult, ChangelogParseResult]> {
    return [
      parseUserChangelog(await readFile("USER_CHANGELOG.pt-BR.md", "utf8")),
      parseUserChangelog(await readFile("USER_CHANGELOG.en.md", "utf8")),
    ];
  }

  it("IT-001 keeps both real histories coherent with package.json", async () => {
    const [pt, en] = await realParses();
    const pkg = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
    expect(pt.issues).toEqual([]);
    expect(en.issues).toEqual([]);
    expect(() => validateLocalizedChangelogs(pt, en)).not.toThrow();
    expect(pt.releases.map(({ version, publication }) => ({ version, publication }))).toEqual(
      en.releases.map(({ version, publication }) => ({ version, publication })),
    );
    const ptCurrent =
      pt.releases.some(({ version }) => version === pkg.version) ||
      pt.omitted.some(({ version }) => version === pkg.version);
    const enCurrent =
      en.releases.some(({ version }) => version === pkg.version) ||
      en.omitted.some(({ version }) => version === pkg.version);
    expect(ptCurrent).toBe(true);
    expect(enCurrent).toBe(true);
    expect(pt.releases.some(({ version }) => version === pkg.version)).toBe(
      en.releases.some(({ version }) => version === pkg.version),
    );
  });

  it("IT-002 keeps implementation terms outside complete user bodies", async () => {
    const [pt, en] = await realParses();
    const bodies = [...pt.releases, ...en.releases].map((item) => item.markdown).join("\n");
    for (const forbidden of ["src/", "app/", ".ts", "libsql://", "auth_user", "job_score", "TURSO_", "process.env"]) {
      expect(bodies).not.toContain(forbidden);
    }
  });

  it("IT-003 traces both locale files without the deprecated path", async () => {
    const config = await readFile("next.config.ts", "utf8");
    expect(config).toContain("./USER_CHANGELOG.pt-BR.md");
    expect(config).toContain("./USER_CHANGELOG.en.md");
    expect(config).not.toMatch(/["']\.\/USER_CHANGELOG\.md["']/);
  });

  it("IT-013 preserves date-only history because lightweight tags prove no tag instant", async () => {
    const [pt, en] = await realParses();
    const historicalVersions = new Set(["1.1.0", "1.0.0"]);
    for (const item of [...pt.releases, ...en.releases]) {
      expect(item.publication.kind, item.version).toBe(
        historicalVersions.has(item.version) ? "date" : "instant",
      );
    }
    const metadata = execFileSync(
      "git",
      ["tag", "--list", "v*", "--format=%(objecttype)"],
      { encoding: "utf8" },
    ).trim().split("\n").filter(Boolean);
    expect(metadata.length).toBeGreaterThan(0);
    expect(metadata.every((kind) => kind === "commit")).toBe(true);
  });

  it("IT-014 stages and validates both localized release outputs", async () => {
    const promotion = await readFile(".github/workflows/promover-para-staging.yml", "utf8");
    const sync = await readFile(".github/workflows/sincronizar-apos-main.yml", "utf8");
    const shell = await readFile("scripts/release/versionar.ts", "utf8");
    for (const workflow of [promotion, sync]) {
      expect(workflow).toMatch(
        /git add package\.json CHANGELOG\.md USER_CHANGELOG\.pt-BR\.md USER_CHANGELOG\.en\.md/,
      );
      expect(workflow).not.toMatch(/["' ]USER_CHANGELOG\.md["' ]/);
    }
    for (const file of ["CHANGELOG.md", "USER_CHANGELOG.pt-BR.md", "USER_CHANGELOG.en.md"]) {
      expect(shell).toContain(file);
    }
  });
});
