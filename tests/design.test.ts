import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/entry-inventory.ts";

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

/**
 * V10-03: o tema DEFINE a paleta; o componente só a LÊ.
 *
 * As duas verificações acima olham `#` de seis dígitos e `text-[Npx]` em
 * `.tsx`. Passavam, portanto, `#fff`, `rgb(…)`, `oklch(…)`, `var(--color-iris)`
 * (paleta crua, igual em todos os temas), `text-slate-500`, `text-[0.8rem]`,
 * `fontSize: "14.5px"` e qualquer cor escrita num `.ts` ou num `.css` novo.
 *
 * O critério não é "hex existe no repositório": os três arquivos de definição
 * existem justamente para conter a paleta. A regra é onde o valor aparece. Um
 * nome `--color-*` é tema quando `globals.css` o declara como apelido de uma
 * variável semântica (`--color-hairline: var(--hairline)`), e é paleta crua
 * quando só existe como valor literal.
 */
const DEFINITIONS = ["app/globals.css", "app/themes.css", "app/design-tokens.css"];

type StyleScale = {
  /** `--color-*` que resolvem para variável do tema. */
  themed: Set<string>;
  /** Nomes de utilidade (`iris`, `good`) cuja cor é literal e fixa. */
  rawPalette: Set<string>;
  /** Tamanhos de fonte em px que a escala define. */
  fontPx: Set<number>;
};

function readScale(): StyleScale {
  const css = DEFINITIONS.map((file) => read(file).replace(/\/\*[\s\S]*?\*\//g, "")).join("\n");
  const themed = new Set([...css.matchAll(/(--color-[\w-]+)\s*:\s*var\(/g)].map((m) => m[1]!));
  const rawPalette = new Set(
    [...css.matchAll(/--color-([\w-]+)\s*:\s*(?:#|rgb|hsl|oklch)/g)]
      .map((m) => m[1]!)
      .filter((name) => !themed.has(`--color-${name}`)),
  );
  const fontPx = new Set([...css.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1])));
  return { themed, rawPalette, fontPx };
}

const COLOR_UTILITY = "(?:text|bg|border|ring|fill|stroke|outline|decoration|from|to|via|shadow|accent|caret|divide|placeholder)";
const TAILWIND_PALETTE =
  "(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)";

/**
 * Tudo o que, num componente, é cor ou tamanho fora do sistema.
 *
 * Os `#` que sobram de propósito (`allowedHex`) são os mesmos do teste de hex
 * acima: valores de token usados onde `var()` não resolve.
 */
function styleViolations(source: string, scale: StyleScale, allowedHex: Set<string>): string[] {
  const code = stripComments(source);
  const found: string[] = [];
  // `&#8212;` é entidade HTML, não cor.
  for (const m of code.matchAll(/(?<!&)#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g)) {
    if (!allowedHex.has(m[0].toLowerCase())) found.push(m[0]);
  }
  for (const m of code.matchAll(/(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g)) found.push(m[0]);
  for (const m of code.matchAll(/--color-[\w-]+/g)) {
    if (!scale.themed.has(m[0])) found.push(m[0]);
  }
  for (const m of code.matchAll(new RegExp(`(?<![\\w-])${COLOR_UTILITY}-([\\w-]+?)(?=[\\s"'\`/:\\]]|$)`, "g"))) {
    if (scale.rawPalette.has(m[1]!)) found.push(m[0]);
  }
  for (const m of code.matchAll(new RegExp(`(?<![\\w-])${COLOR_UTILITY}-${TAILWIND_PALETTE}-\\d{2,3}\\b`, "g"))) {
    found.push(m[0]);
  }
  // Preto e branco fixos ignoram o tema. O véu de um diálogo (`backdrop:`) é
  // escurecimento sobre qualquer tema, e não cor de componente.
  for (const m of code.matchAll(/(?<!backdrop:)(?<![\w-])(?:text|bg|border|ring|fill|stroke)-(?:white|black)\b/g)) {
    found.push(m[0]);
  }
  for (const m of code.matchAll(/(?<![\w-])text-\[(?:length:)?[\d.]+(?:px|rem|em)\]/g)) found.push(m[0]);
  for (const m of code.matchAll(/\bfont-?[sS]ize\s*:\s*["'`]?([\d.]+)(px|rem|em)?/g)) {
    if (m[2] !== "px" || !scale.fontPx.has(Number(m[1]))) found.push(m[0]);
  }
  for (const m of code.matchAll(
    /(?<![\w-])-?(?:p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y)-\[([^\]]+)\]/g,
  )) {
    if (/\d(?:px|rem|em)\b/.test(m[1]!)) found.push(m[0]);
  }
  return found;
}

/** Arquivo e casos tolerados, cada um com o motivo. Exceção órfã reprova. */
const STYLE_EXCEPTIONS: Record<string, { matches: string[]; why: string }> = {
  "components/ui/button.tsx": {
    matches: ["text-[0.8rem]"],
    why: "gerado pelo shadcn; 12,8px cai entre dois degraus da escala e trocar muda o botão pequeno em todas as telas — correção visual fica para tarefa própria",
  },
  "app/candidate/highlight.ts": {
    matches: ['fontSize: "1.2em', 'fontSize: "1.1em'],
    why: "títulos do markdown dentro do editor, relativos à fonte de 13px do CodeMirror; achados quando a varredura passou a ler `.ts`, e trocar por degrau da escala muda o editor",
  },
  "app/candidate/editor.tsx": {
    matches: ["text-white"],
    why: "texto do botão ativo do editor sobre `--color-brand`; a troca por `--primary-foreground` precisa de medição de contraste nos seis ambientes",
  },
};

function styleFiles(): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) visit(full);
      else if (/\.(tsx?|css)$/.test(full) && !DEFINITIONS.includes(full)) out.push(full);
    }
  };
  for (const dir of ["app", "components", "lib"]) visit(dir);
  return out;
}

describe("V10-03 componente lê o tema, não a paleta", () => {
  const scale = readScale();
  const allowedHex = new Set(["#5b5fa8", "#356373", "#7fadbe", "#ffffff", "#101215"]);

  it("lê a escala dos arquivos de definição, e não de uma lista escrita à mão", () => {
    // Guarda contra o teste passar por não ter entendido a escala.
    expect(scale.themed.has("--color-hairline")).toBe(true);
    expect(scale.themed.has("--color-brand")).toBe(true);
    expect(scale.rawPalette.has("iris")).toBe(true);
    expect(scale.rawPalette.has("brand")).toBe(false);
    expect(scale.fontPx.has(13)).toBe(true);
    expect(scale.fontPx.has(12.8)).toBe(false);
  });

  it("recusa cor e tamanho fora do sistema e aceita o que vem do tema", () => {
    const proibido = [
      'const a = "#fff";',
      'const b = "#ffcc00aa";',
      'style={{ color: "rgb(0 0 0)" }}',
      'className="bg-[oklch(0.7_0.1_200)]"',
      'className="text-[var(--color-iris)]"',
      'className="text-iris bg-ember/20"',
      'className="text-slate-500"',
      'className="text-white"',
      'className="hover:bg-black"',
      'className="text-[0.8rem]"',
      'className="text-[14px]"',
      "style={{ fontSize: \"14.5px\" }}",
      "style={{ fontSize: \"1.1rem\" }}",
      'className="p-[13px] gap-[0.3rem]"',
    ];
    for (const trecho of proibido) {
      expect(styleViolations(trecho, scale, allowedHex), trecho).not.toEqual([]);
    }

    const permitido = [
      'className="text-[var(--primary-text)] border-[var(--color-hairline)]"',
      'className="hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]"',
      'className="bg-card text-card-foreground text-good-label"',
      'className="backdrop:bg-black/40"',
      "style={{ fontSize: \"13px\" }}",
      'className="p-[var(--spacing-md)] max-w-[320px]"',
      "<a href=\"#main\">&#8212;</a>",
      '// comentário citando #fff e rgb(0 0 0)',
    ];
    for (const trecho of permitido) {
      expect(styleViolations(trecho, scale, allowedHex), trecho).toEqual([]);
    }
  });

  it("não bloqueia o tema que define a paleta", () => {
    // Os arquivos de definição têm hex por natureza: a regra é sobre ONDE o
    // valor aparece. Se o detector valesse para eles, a paleta seria proibida
    // de existir — e ela não fica fora da varredura por acaso, mas por nome.
    const themes = read("app/themes.css");
    expect(styleViolations(themes, scale, allowedHex).length).toBeGreaterThan(10);
    expect(styleFiles()).not.toContain("app/themes.css");
    expect(styleFiles()).toContain("app/ui.tsx");
  });

  it("nenhum componente, módulo de UI ou CSS novo escreve cor ou tamanho fora do sistema", () => {
    const files = styleFiles();
    expect(files.length).toBeGreaterThan(40);
    const offenders: string[] = [];
    const used = new Set<string>();
    for (const file of files) {
      const exception = STYLE_EXCEPTIONS[file];
      for (const violation of styleViolations(read(file), scale, allowedHex)) {
        if (exception?.matches.includes(violation)) {
          used.add(`${file}: ${violation}`);
          continue;
        }
        offenders.push(`${file}: ${violation}`);
      }
    }
    for (const [file, { matches, why }] of Object.entries(STYLE_EXCEPTIONS)) {
      for (const match of matches) {
        if (!used.has(`${file}: ${match}`)) offenders.push(`${file}: exceção órfã ${match}`);
      }
      if (why.trim().length < 20) offenders.push(`${file}: exceção sem justificativa`);
    }
    expect(offenders).toEqual([]);
  });
});
