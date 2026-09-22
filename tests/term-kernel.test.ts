import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import {
  matchesTerm,
  termKey,
  termPrefilterLike,
  termRegexSql,
  validateTerm,
} from "../src/core/term.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

describe("term kernel", () => {
  it("UT-001 trims and keys a valid term", () => {
    expect(validateTerm("  Laravel ")).toEqual({ ok: true, value: { term: "Laravel", key: "laravel" } });
  });

  it("UT-002 keys spelling variants alike", () => {
    expect(termKey("Tech Lead")).toBe("techlead");
    expect(termKey("tech-lead")).toBe("techlead");
    expect(termKey("Techlead")).toBe("techlead");
  });

  it("UT-003 rejects terms shorter than two characters", () => {
    expect(validateTerm("")).toEqual({ ok: false, code: "term_too_short" });
    expect(validateTerm("a")).toEqual({ ok: false, code: "term_too_short" });
    expect(validateTerm("go").ok).toBe(true);
  });

  it("UT-004 accepts 60 characters and rejects 61", () => {
    expect(validateTerm("a".repeat(60)).ok).toBe(true);
    expect(validateTerm("a".repeat(61))).toEqual({ ok: false, code: "term_too_long" });
  });

  it("UT-005 names the invalid character", () => {
    expect(validateTerm("php<script>")).toEqual({ ok: false, code: "term_invalid_char", char: "<" });
  });

  it("UT-006 rejects punctuation-only terms", () => {
    expect(validateTerm("++")).toEqual({ ok: false, code: "term_no_alnum" });
  });

  it.each(["C++", "C#", ".NET", "Node.js", "CI/CD", "Programação"])("UT-007 accepts %s", (term) => {
    expect(validateTerm(term).ok).toBe(true);
  });

  it.each(["Senior Tech Lead (Remote)", "tech-lead", "TechLead"])(
    "UT-008 matches techlead in %s",
    (text) => {
      expect(matchesTerm("techlead", text)).toBe(true);
    },
  );

  it("UT-009 never matches a partial word", () => {
    expect(matchesTerm("Lara", "Laravel developer")).toBe(false);
    expect(matchesTerm("java", "JavaScript engineer")).toBe(false);
  });

  it("UT-010 keeps symbols literal", () => {
    expect(matchesTerm("C#", "Senior C# developer")).toBe(true);
    expect(matchesTerm("Node.js", "node.js backend")).toBe(true);
    expect(matchesTerm("node", "Node.js developer")).toBe(true);
    expect(matchesTerm("C#", "C developer")).toBe(false);
  });

  it("UT-011 does not expand synonyms", () => {
    expect(matchesTerm("Technical Lead", "Tech Lead wanted")).toBe(false);
  });

  it("UT-012 builds the exact SQL regex", () => {
    expect(termRegexSql("C++")).toBe("(^|[^a-z0-9+#])c\\+\\+([^a-z0-9+#]|$)");
    expect(termRegexSql("Go")).toBe("(^|[^a-z0-9+#])g[ -]?o([^a-z0-9+#]|$)");
  });

  it("UT-214a prefilters only ASCII keys with a trigram run", () => {
    expect(termPrefilterLike("Tech Lead")).toBe("%techlead%");
    expect(termPrefilterLike("node.js")).toBe("%node.js%");
    expect(termPrefilterLike("CI/CD")).toBeNull();
    expect(termPrefilterLike("C++")).toBeNull();
    expect(termPrefilterLike("go")).toBeNull();
    expect(termPrefilterLike("k8s")).toBe("%k8s%");
    expect(termPrefilterLike("gestão")).toBeNull();
    expect(termPrefilterLike("O'Reilly%_")).toBeNull();
  });

  it("UT-214b the prefilter is necessary: every regex hit survives it", () => {
    // Remove espaço e hífen como os `replace` do índice e confere em
    // minúsculas, como o `ilike`. Uma recusa aqui seria vaga escondida.
    const survives = (like: string, text: string) =>
      text.replace(/[ -]/g, "").toLowerCase().includes(like.slice(1, -1));
    const terms = ["techlead", "Tech Lead", "java", "node.js", "k8s", "laravel", "typescript", "react"];
    const texts = [
      "Senior Tech Lead (Remote)", "tech-lead", "TECH-LEAD", "t-e-c-h-l-e-a-d", "Java 21", "j a v a",
      "Node.js and Node JS", "no de.js", "K8S", "La-ra-vel", "Type Script", "React Native", "re act",
      "techlead,java;react", "nothing here",
    ];
    for (const term of terms) {
      const like = termPrefilterLike(term)!;
      expect(like, term).not.toBeNull();
      for (const text of texts) {
        if (matchesTerm(term, text)) expect(survives(like, text), `${term} in ${text}`).toBe(true);
      }
    }
  });
});

describe("term kernel against PostgreSQL", () => {
  let db: DB;
  beforeAll(async () => {
    db = await useTestDb();
  });
  afterAll(async () => {
    await releaseTestDb();
  });

  const PAIRS: Array<[string, string]> = [
    ["laravel", "Senior Laravel Developer"],
    ["Laravel", "laravel"],
    ["Lara", "Laravel developer"],
    ["java", "JavaScript engineer"],
    ["java", "Java Engineer"],
    ["C#", "Senior C# developer"],
    ["C#", "C developer"],
    ["C++", "Modern C++ codebase"],
    ["c++", "c and c++"],
    ["Node.js", "node.js backend"],
    ["node", "Node.js developer"],
    ["techlead", "Senior Tech Lead (Remote)"],
    ["techlead", "tech-lead"],
    ["Tech Lead", "TechLead role"],
    ["Technical Lead", "Tech Lead wanted"],
    ["php", "PHP 8 and MySQL"],
    ["php", "phpunit only"],
    ["go", "Go and Rust"],
    ["go", "google cloud"],
    ["go", "category go-to-market"],
    [".NET", "ASP.NET Core"],
    [".NET", "the .NET stack"],
    ["CI/CD", "own the CI/CD pipeline"],
    ["CI/CD", "CI and CD"],
    ["react", "React Native"],
    ["react", "reactive streams"],
    ["ai", "AI Engineer"],
    ["ai", "maintain the email service"],
    ["k8s", "k8s, docker"],
    ["sql", "PostgreSQL"],
  ];

  it("IT-116 agrees with PostgreSQL ~* for 30 term/text pairs", async () => {
    expect(PAIRS).toHaveLength(30);
    for (const [term, text] of PAIRS) {
      const [row] = await db.execute<{ hit: boolean }>(
        sql`select (${text} ~* ${termRegexSql(term)}) as hit`,
      );
      expect(row!.hit, `${term} in ${text}`).toBe(matchesTerm(term, text));
    }
  });

  it("IT-214c in PostgreSQL, no ~* hit is dropped by the replace/ilike prefilter", async () => {
    let checked = 0;
    for (const [term, text] of [...PAIRS, ["techlead", "TECH-LEAD"], ["java", "J-A-V-A"]] as Array<[string, string]>) {
      const like = termPrefilterLike(term);
      if (like === null) continue;
      const [row] = await db.execute<{ hit: boolean; kept: boolean }>(
        sql`select (${text} ~* ${termRegexSql(term)}) as hit, (replace(replace(${text}, ' ', ''), '-', '') ilike ${like}) as kept`,
      );
      if (row!.hit) {
        checked += 1;
        expect(row!.kept, `${term} in ${text}`).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(5);
  });
});
