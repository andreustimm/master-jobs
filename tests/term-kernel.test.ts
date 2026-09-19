import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import {
  matchesTerm,
  termKey,
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
});
