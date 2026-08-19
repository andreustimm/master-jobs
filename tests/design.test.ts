import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * DESIGN.md is the visual source of truth (rule 8 in CLAUDE.md).
 *
 * A rule written in a document and checked by nobody is decoration. These
 * assert the two ways the system actually gets violated: a literal colour, and
 * a one-off font size. Both look harmless in a diff and both are how a design
 * system dies — not by a redesign, but by forty small exceptions.
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const read = (f: string) => readFileSync(f, "utf8");
const COMPONENTS = [...walk("app"), ...walk("components")];

describe("design tokens", () => {
  it("keeps the token file in step with DESIGN.md", () => {
    const design = read("DESIGN.md");
    const tokens = read("app/design-tokens.css");
    // The primary is the one value the whole system hangs off.
    expect(design).toContain("#024ad8");
    expect(tokens).toContain("#024ad8");
  });

  it("uses no literal hex colour in a component", () => {
    // Every colour must come from the scale. The two exceptions below are
    // themselves tokens, declared in globals.css and referenced by value in a
    // Tailwind arbitrary utility because Tailwind cannot resolve a var there.
    const allowed = new Set(["#5b5fa8", "#356373", "#7fadbe"]);
    const offenders: string[] = [];
    for (const file of COMPONENTS) {
      for (const match of read(file).matchAll(/#[0-9a-fA-F]{6}\b/g)) {
        if (!allowed.has(match[0].toLowerCase())) offenders.push(`${file}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("uses no arbitrary font size outside the type scale", () => {
    // `type-*` classes carry size, weight, line-height and tracking together,
    // which is what makes the scale hold. A bare `text-[13px]` keeps the size
    // and silently drops the rest.
    const offenders: string[] = [];
    for (const file of COMPONENTS) {
      for (const match of read(file).matchAll(/\btext-\[(\d+(?:\.\d+)?)px\]/g)) {
        offenders.push(`${file}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("extends the scale instead of letting components improvise", () => {
    // DESIGN.md stops at 12px because it was written for marketing pages; a
    // triage grid needs two steps below that. The answer is a token, not an
    // exception in each component.
    const tokens = read("app/design-tokens.css");
    expect(tokens).toContain(".type-meta");
    expect(tokens).toContain(".type-micro");
  });

  it("defines the type scale DESIGN.md specifies", () => {
    const globals = read("app/globals.css");
    for (const style of ["display-xl", "display-lg", "display-md"]) {
      expect(globals, style).toContain(style);
    }
  });

  it("uses the specified typefaces", () => {
    // Forma DJR is HP's proprietary face and cannot be redistributed; Archivo
    // is the documented substitute. The substitution is deliberate and noted
    // in design-tokens.css — what matters is that nothing else creeps in.
    const globals = read("app/globals.css");
    expect(globals).toContain("Archivo");
    expect(globals).toContain("IBM Plex Mono");
  });
});
