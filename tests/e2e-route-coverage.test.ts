import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { discoverEntries } from "./support/entry-inventory.ts";
import {
  AXE_SWEEP,
  ENGLISH_ANONYMOUS_SWEEP,
  ENGLISH_OWNER_SWEEP,
  ENGLISH_SEARCHES_SWEEP,
  OVERFLOW_SEARCHES_SWEEP,
  OVERFLOW_SWEEP,
  UNMEASURED_PAGES,
} from "./e2e/routes.mjs";

/**
 * Suite: alcance das varreduras do E2E (governança task_08, V08-01)
 * Invariant: toda página que o Next serve é medida por alguma varredura
 * transversal do navegador ou fica de fora por exceção registrada.
 * Boundary IN: o inventário de páginas de `entry-inventory.ts` (o mesmo que
 * decide autorização) e as listas que `ui.mjs`/`a11y.mjs` importam.
 * Boundary OUT: se a varredura reprova o que deve — isso é o E2E, no CI.
 *
 * As varreduras eram arrays literais, e rota nova não herdava nenhuma: a
 * lista era o inventário do que alguém lembrou de incluir.
 */

const SWEEPS: Record<string, readonly string[]> = {
  "inglês (dono)": ENGLISH_OWNER_SWEEP,
  "inglês (sem sessão)": ENGLISH_ANONYMOUS_SWEEP,
  "inglês (buscas)": ENGLISH_SEARCHES_SWEEP,
  "largura": OVERFLOW_SWEEP,
  "largura (buscas)": OVERFLOW_SEARCHES_SWEEP,
  "axe": AXE_SWEEP.map(([, path]) => String(path)),
};

/** `app/jobs/[id]/page.tsx` → segmentos `["jobs", "[id]"]`; `app/page.tsx` → `[]`. */
function pageSegments(file: string): string[] {
  return file
    .replace(/^app\//, "")
    .replace(/(?:^|\/)page\.(?:tsx|ts|jsx|js|mdx)$/, "")
    .split("/")
    // Grupo de rota `(nome)` não aparece na URL.
    .filter((segment) => segment !== "" && !/^\(.+\)$/.test(segment));
}

function pathSegments(path: string): string[] {
  return new URL(path, "http://sweep.invalid").pathname.split("/").filter(Boolean);
}

const isDynamic = (segment: string) => /^\[.+\]$/.test(segment);

/**
 * A URL da varredura serve a página? Segmento estático precisa ser igual;
 * dinâmico aceita qualquer valor — inclusive o marcador `{track}`, que `ui.mjs`
 * troca pelo id criado durante a suíte. Estático vence dinâmico, como no Next:
 * `/searches/tracks/new` é a página `new`, não a `[id]`.
 */
function servedBy(path: string, pages: string[]): string | undefined {
  const wanted = pathSegments(path);
  const candidates = pages.filter((file) => {
    const segments = pageSegments(file);
    return segments.length === wanted.length
      && segments.every((segment, i) => isDynamic(segment) || segment === wanted[i]);
  });
  const staticCount = (file: string) => pageSegments(file).filter((s) => !isDynamic(s)).length;
  return candidates.sort((a, b) => staticCount(b) - staticCount(a))[0];
}

describe("V08-01 — nenhuma página fica fora da medição sem decisão", () => {
  const { pages } = discoverEntries();

  it("o inventário enxerga as páginas (sanidade contra um glob que não acha nada)", () => {
    expect(pages).toContain("app/page.tsx");
    expect(pages).toContain("app/jobs/[id]/page.tsx");
    expect(pages.length).toBeGreaterThan(10);
  });

  it("toda página é medida por alguma varredura ou tem exceção justificada", () => {
    const measured = new Set<string>();
    for (const paths of Object.values(SWEEPS)) {
      for (const path of paths) {
        const page = servedBy(path, pages);
        if (page) measured.add(page);
      }
    }
    const unmeasured = pages.filter((page) => !measured.has(page) && !(page in UNMEASURED_PAGES));
    expect(unmeasured, "página sem varredura: inclua em tests/e2e/routes.mjs ou registre em UNMEASURED_PAGES").toEqual([]);
  });

  it("toda URL das varreduras corresponde a uma página que existe", () => {
    const orphans = Object.entries(SWEEPS).flatMap(([sweep, paths]) =>
      paths.filter((path) => !servedBy(path, pages)).map((path) => `${sweep}: ${path}`));
    expect(orphans).toEqual([]);
  });

  it("exceção não sobrevive à página nem à entrada dela numa varredura", () => {
    const all = Object.values(SWEEPS).flat();
    for (const [page, why] of Object.entries(UNMEASURED_PAGES)) {
      expect(pages, `exceção órfã: ${page}`).toContain(page);
      expect(why.trim().length, `exceção sem motivo: ${page}`).toBeGreaterThan(20);
      const nowMeasured = all.filter((path) => servedBy(path, pages) === page);
      expect(nowMeasured, `${page} já é medida; retire a exceção`).toEqual([]);
    }
  });

  it("as varreduras do navegador consomem as listas, não cópias delas", () => {
    // Sem isto, `routes.mjs` poderia listar toda página enquanto `ui.mjs` volta
    // a um array literal: a cobertura acima ficaria verde medindo dado morto.
    // A suíte de interface é `ui.mjs` mais as áreas de `ui/` (#320).
    const ui = ["tests/e2e/ui.mjs", ...readdirSync("tests/e2e/ui").map((file) => `tests/e2e/ui/${file}`)]
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    const a11y = readFileSync("tests/e2e/a11y.mjs", "utf8");
    expect(ui).toContain("portugueseLeaks(ENGLISH_OWNER_SWEEP)");
    expect(ui).toContain("portugueseLeaks(ENGLISH_ANONYMOUS_SWEEP, anonymous)");
    expect(ui).toContain("portugueseLeaks(ENGLISH_SEARCHES_SWEEP.map(withSuiteIds))");
    expect(ui).toContain("for (const path of OVERFLOW_SWEEP)");
    expect(ui).toContain("OVERFLOW_SEARCHES_SWEEP.map(withSuiteIds)");
    expect(a11y).toContain("AXE_SWEEP.filter(([, path]) => path !== \"/login\")");
    expect(a11y).toContain("AXE_SWEEP.find(([, path]) => path === \"/login\")");
  });

  it("a correspondência distingue estático de dinâmico", () => {
    const fixture = ["app/searches/tracks/new/page.tsx", "app/searches/tracks/[id]/page.tsx", "app/page.tsx"];
    expect(servedBy("/searches/tracks/new", fixture)).toBe("app/searches/tracks/new/page.tsx");
    expect(servedBy("/searches/tracks/{track}", fixture)).toBe("app/searches/tracks/[id]/page.tsx");
    expect(servedBy("/?q=1", fixture)).toBe("app/page.tsx");
    expect(servedBy("/nao-existe", fixture)).toBeUndefined();
  });
});
