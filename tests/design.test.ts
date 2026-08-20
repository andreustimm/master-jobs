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
  it("keeps the HP theme faithful to DESIGN.md", () => {
    // As cores saíram de design-tokens.css e viraram tema: o arquivo de tokens
    // agora carrega escala e tipografia, e themes.css carrega paleta.
    const design = read("DESIGN.md");
    const themes = read("app/themes.css");
    expect(design).toContain("#024ad8");
    expect(themes).toContain("#024ad8");
  });

  it("defines every theme in the registry, and only those", () => {
    const themes = read("app/themes.css");
    const registry = read("src/core/theme.ts");
    for (const id of ["hp", "huly", "graphy"]) {
      expect(themes, id).toContain(`[data-theme="${id}"]`);
      expect(registry, id).toContain(`id: "${id}"`);
    }
  });

  it("gives every theme a dark variant", () => {
    // Um tema sem variante escura deixaria o usuário preso no claro ao trocar
    // de identidade visual — e ele não tem como saber disso antes de tentar.
    const themes = read("app/themes.css");
    for (const id of ["hp", "huly", "graphy"]) {
      expect(themes, `${id} escolha explícita`).toContain(`[data-theme="${id}"][data-mode="dark"]`);
      expect(themes, `${id} sistema`).toContain(`[data-theme="${id}"]:not([data-mode="light"])`);
    }
  });

  it("lets an explicit light choice beat a dark operating system", () => {
    // Sem o `:not([data-mode="light"])`, quem pediu claro num sistema noturno
    // recebe escuro assim mesmo — a escolha do usuário perde para o SO.
    const themes = read("app/themes.css");
    const media = themes.slice(themes.indexOf("@media (prefers-color-scheme: dark)"));
    expect(media).toContain(':not([data-mode="light"])');
  });

  it("uses no literal hex colour in a component", () => {
    // Toda cor sai da escala. As exceções abaixo são elas mesmas tokens,
    // declaradas em `globals.css` e referenciadas por valor numa utilidade
    // arbitrária do Tailwind, que não resolve `var()` ali.
    //
    // `#ffffff` e `#101215` entram por outro motivo, e é o mais forte: são o
    // `theme-color` da barra do navegador, lido pelo SISTEMA OPERACIONAL antes
    // de existir CSS. Nenhuma variável resolve num `<meta>`. Vivem numa
    // constante nomeada em `app/layout.tsx`, com a ligação ao `--background` do
    // tema escrita no comentário.
    const allowed = new Set(["#5b5fa8", "#356373", "#7fadbe", "#ffffff", "#101215"]);
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

  it("uses the substitute typeface the docs name", () => {
    // Forma DJR is proprietary and cannot be redistributed; Inter is the
    // closest free alternative (~85%) and the substitution is documented in
    // design-tokens.css. What matters is that nothing else creeps in.
    const globals = read("app/globals.css");
    expect(globals).toContain("Inter,");
    expect(globals).toContain("IBM Plex Mono");
  });

  it("loads the typeface it declares", () => {
    // A family named in CSS but never fetched renders as the fallback, and the
    // page looks almost right — which is how this went unnoticed.
    const layout = read("app/layout.tsx");
    expect(layout).toContain("fonts.googleapis.com");
    expect(layout).toContain("family=Inter");
  });

  it("defines the variable Tailwind's preflight actually reads", () => {
    // Tailwind v4 applies `font-family: var(--default-font-family, -apple-system…)`
    // to the document. Leaving that variable undefined means the whole app
    // renders in the system font while the design tokens sit there, compiled
    // and ignored.
    const globals = read("app/globals.css");
    expect(globals).toContain("--default-font-family:");
    expect(globals).toContain("--default-mono-font-family:");
  });

  it("avoids width classes whose name collides with the spacing scale", () => {
    // Tailwind v4 resolves `max-w-<name>` through `--spacing-<name>` for
    // non-numeric names. DESIGN.md names its spacing xs/sm/md/lg/xl, so
    // `max-w-xs` silently became 8px — the tooltip rendered one character
    // wide, breaking its text letter by letter.
    const COLLIDING = /\b(max-w|max-h|min-w|min-h|w|h)-(xxs|xs|sm|md|lg|xl|xxl|section)\b/;
    const offenders: string[] = [];
    for (const file of COMPONENTS) {
      const m = COLLIDING.exec(read(file));
      if (m) offenders.push(`${file}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it("has no self-referencing custom property", () => {
    // `--font-sans: var(--font-sans)` shipped in the shadcn scaffold. Inside
    // `@theme inline` the variable is defined in that same scope, so the line
    // referenced itself — a cyclic dependency, which CSS resolves by
    // invalidating the property. Every `var(--font-sans)` in the app fell
    // through to its fallback, silently.
    const offenders: string[] = [];
    for (const file of ["app/globals.css", "app/design-tokens.css"]) {
      // Comments are stripped first: this file documents the bug it prevents,
      // and the explanation must not trip the check.
      const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
      for (const m of css.matchAll(/(--[\w-]+):\s*var\(\s*(--[\w-]+)\s*[,)]/g)) {
        if (m[1] === m[2]) offenders.push(`${file}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("declares a family on every type style, as the spec does", () => {
    // DESIGN.md repeats `fontFamily` on all 16 styles. Inheriting from the
    // body means any element inside a container with its own font silently
    // leaves the scale.
    const tokens = read("app/design-tokens.css");
    // Conta dentro de cada bloco `.type-*`, e não no arquivo inteiro: as
    // declarações do `@theme` também casariam com um regex solto.
    const blocks = [...tokens.matchAll(/\.type-[a-z-]+ \{([^}]*)\}/g)];
    const withoutFamily = blocks
      .filter((b) => !/font-family: var\(--font-(sans|mono)\)/.test(b[1]!))
      .map((b) => b[0].split(" ")[0]);
    expect(blocks.length).toBeGreaterThan(10);
    expect(withoutFamily).toEqual([]);
  });
});
