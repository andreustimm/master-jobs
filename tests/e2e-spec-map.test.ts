// Suite: E2E seletivo (#320)
// Invariant: toda página que o Next serve e toda rota das varreduras de
//   `tests/e2e/routes.mjs` pertencem a alguma área do mapa; o mapa conhece
//   exatamente as áreas que `tests/e2e/ui/index.mjs` roda; caminho transversal
//   ou não mapeado pede a suíte inteira; e o que um módulo de área cita como
//   rota está nas rotas da área, para o mapa não ficar para trás do teste.
// Boundary IN: config/e2e-spec-map.json, scripts/gates/e2e-selection.ts,
//   tests/e2e/ui/index.mjs (seleção e fecho de `requires`)
// Boundary OUT: se cada área roda sozinha — isso é `pnpm test:e2e --areas`
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { commandFor, loadE2EMap, loadImpactMap } from "../scripts/gates/cli.ts";
import {
  appRouteOf,
  routeMatches,
  routesInSource,
  selectE2E,
  validateE2EMap,
} from "../scripts/gates/e2e-selection.ts";
import { planGates } from "../scripts/gates/impact.ts";
import * as sweeps from "./e2e/routes.mjs";
import { AREAS, PREFIX, SMOKE, selectAreas } from "./e2e/ui/index.mjs";
import { discoverEntries } from "./support/entry-inventory.ts";

const ROOT = process.cwd();
const MAP = loadE2EMap(ROOT);
const RAW = JSON.parse(readFileSync("config/e2e-spec-map.json", "utf8")) as Record<string, unknown>;

/** `app/jobs/[id]/page.tsx` → `/jobs/[id]`; grupo `(nome)` some. */
function routeOfPage(page: string): string {
  return `/${appRouteOf(page)!.segments.join("/")}`;
}

function areasServing(route: string): string[] {
  return MAP.areas.filter((area) => area.routes.some((mapped) => routeMatches(route, mapped))).map((area) => area.id);
}

describe("mapa de E2E — cobertura", () => {
  const { pages, routes } = discoverEntries();

  it("conhece exatamente as áreas do executor, mais a varredura axe", () => {
    expect(MAP.areas.map((area) => area.id).sort()).toEqual([...AREAS.map((area) => area.id), "a11y"].sort());
  });

  it("toda página servida pertence a alguma área", () => {
    const orphans = pages.map(routeOfPage).filter((route) => areasServing(route).length === 0);
    expect(orphans, "página sem área: inclua a rota em config/e2e-spec-map.json").toEqual([]);
  });

  it("toda rota das varreduras de routes.mjs pertence a alguma área", () => {
    const listed = [
      ...sweeps.ENGLISH_OWNER_SWEEP,
      ...sweeps.ENGLISH_ANONYMOUS_SWEEP,
      ...sweeps.ENGLISH_SEARCHES_SWEEP,
      ...sweeps.OVERFLOW_SWEEP,
      ...sweeps.OVERFLOW_SEARCHES_SWEEP,
      ...sweeps.AXE_SWEEP.map(([, path]) => String(path)),
    ].map((path) => new URL(path.replace("{track}", "1").replace("{term}", "1"), "http://sweep.invalid").pathname);
    const unmeasured = Object.keys(sweeps.UNMEASURED_PAGES).map(routeOfPage);
    const orphans = [...listed, ...unmeasured].filter((route) => areasServing(route).length === 0);
    expect(orphans).toEqual([]);
  });

  it("rota citada por um módulo de área está nas rotas dela", () => {
    const served = [...pages, ...routes].map((file) => `/${appRouteOf(file)!.segments.join("/")}`);
    const drift: string[] = [];
    for (const area of MAP.areas) {
      for (const module of area.modules) {
        for (const cited of routesInSource(readFileSync(module, "utf8"))) {
          // Só rota que o Next serve: `/sw.js` e ícones moram em `public/`.
          if (!served.some((route) => routeMatches(cited, route))) continue;
          if (!area.routes.some((mapped) => routeMatches(cited, mapped))) drift.push(`${area.id}: ${cited} (${module})`);
        }
      }
    }
    expect(drift, "a área visita rota que o mapa não lista").toEqual([]);
  });

  it("todo módulo do mapa existe", () => {
    for (const area of MAP.areas) for (const module of area.modules) expect(() => readFileSync(module)).not.toThrow();
  });
});

describe("mapa de E2E — seleção", () => {
  it("transversal e não mapeado pedem a suíte inteira, com o motivo", () => {
    expect(selectE2E(MAP, ["app/layout.tsx"])).toEqual({ mode: "full", areas: [], escalations: [{ path: "app/layout.tsx", reason: "transversal" }] });
    expect(selectE2E(MAP, ["components/ui/button.tsx"]).mode).toBe("full");
    expect(selectE2E(MAP, ["tests/e2e/ui/shared.mjs"]).mode).toBe("full");
    const unknown = selectE2E(MAP, ["src/contexts/auth/app/session.ts"]);
    expect(unknown.mode).toBe("full");
    expect(unknown.escalations[0]?.reason).toContain("sem área");
    // Um transversal no meio de caminhos mapeados ainda pede a suíte inteira.
    expect(selectE2E(MAP, ["app/searches/page.tsx", "app/globals.css"]).mode).toBe("full");
  });

  it("arquivo solto na raiz de app/ sem padrão é não mapeado; a página da raiz tem rota", () => {
    expect(selectE2E(MAP, ["app/nova-coisa.tsx"]).mode).toBe("full");
    const root = selectE2E(MAP, ["app/page.tsx"]);
    expect(root.mode).toBe("affected");
    expect(root.areas).toEqual(areasServing("/"));
  });

  it("página seleciona as áreas que visitam a rota dela, com prefixo e segmento dinâmico", () => {
    expect(selectE2E(MAP, ["app/searches/page.tsx"]).areas).toEqual(["mobile", "searches"]);
    const detail = selectE2E(MAP, ["app/jobs/[id]/page.tsx"]);
    expect(detail.areas).toContain("job-analysis");
    expect(detail.areas).toContain("a11y");
    expect(detail.areas).not.toContain("account");
    // Rota de grupo `(lista)` responde em /jobs.
    expect(selectE2E(MAP, ["app/jobs/(lista)/page.tsx"]).areas).toContain("work-mode");
    // Route Handler segue a mesma regra: /api/export é da fumaça (e do
    // histórico de novidades, que recusa imagem apontando para ele).
    expect(selectE2E(MAP, ["app/api/export/route.ts"]).areas).toEqual(["auth", "design"]);
    // Cron sem área que o visite: suíte inteira.
    expect(selectE2E(MAP, ["app/api/cron/recheck/route.ts"]).mode).toBe("full");
  });

  it("módulo e padrão da área a selecionam; apelido de rota vale como a rota", () => {
    expect(selectE2E(MAP, ["tests/e2e/work-mode.mjs"]).areas).toEqual(["work-mode"]);
    expect(selectE2E(MAP, ["tests/e2e/ui/pwa.mjs"]).areas).toEqual(["pwa"]);
    expect(selectE2E(MAP, ["app/theme-switch.tsx"]).areas).toEqual(["themes"]);
    expect(selectE2E(MAP, ["app/joblist.tsx"]).areas).toEqual(selectE2E(MAP, ["app/jobs/(lista)/page.tsx"]).areas);
  });

  it("pnpm gates passa as áreas ao E2E, ou nada quando a suíte é inteira", () => {
    const impact = loadImpactMap(ROOT);
    const e2e = (paths: string[]) => planGates(impact, paths).gates.find((gate) => gate.id === "e2e")!;
    expect(commandFor(e2e(["app/searches/page.tsx"]), ROOT, impact)).toEqual(["pnpm", "test:e2e", "--areas", "mobile,searches"]);
    expect(commandFor(e2e(["app/layout.tsx"]), ROOT, impact)).toEqual(["pnpm", "test:e2e"]);
  });
});

describe("executor das áreas — fecho e ordem", () => {
  it("a fumaça roda sempre, e a lista vazia é a suíte inteira", () => {
    expect(selectAreas(undefined)).toBe(AREAS);
    expect(selectAreas("")).toBe(AREAS);
    expect(selectAreas("pwa").map((area) => area.id)).toEqual([...SMOKE, "pwa"]);
  });

  it("requires entra, na ordem da suíte; prefix puxa tudo o que vem antes", () => {
    expect(selectAreas("canonical-flows").map((area) => area.id)).toEqual(["auth", "candidate-rescore", "canonical-flows"]);
    expect(selectAreas("admin").map((area) => area.id)).toEqual(["auth", "design", "roles", "admin"]);
    for (const area of AREAS) {
      if (area.requires === PREFIX) {
        const at = AREAS.indexOf(area);
        expect(selectAreas(area.id).map((item) => item.id)).toEqual(AREAS.slice(0, at + 1).map((item) => item.id));
      }
    }
  });

  it("requires só cita área que existe e vem antes", () => {
    const order = AREAS.map((area) => area.id);
    for (const area of AREAS) {
      if (area.requires === PREFIX) continue;
      for (const need of area.requires) expect(order.indexOf(need), `${area.id} → ${need}`).toBeLessThan(order.indexOf(area.id));
    }
  });

  it("área desconhecida recusa em vez de rodar menos", () => {
    expect(() => selectAreas("pwa,nada")).toThrow("área desconhecida: nada");
  });
});

describe("mapa de E2E — validação falha fechado", () => {
  const broken = (patch: (map: Record<string, unknown>) => void) => {
    const copy = structuredClone(RAW);
    patch(copy);
    return () => validateE2EMap(copy);
  };
  const areas = (map: Record<string, unknown>) => map.areas as Record<string, unknown>[];

  it.each([
    ["não objeto", () => validateE2EMap(null), "objeto"],
    ["schemaVersion", broken((map) => { map.schemaVersion = 2; }), "schemaVersion"],
    ["mapVersion", broken((map) => { map.mapVersion = "v1"; }), "mapVersion"],
    ["crossCutting vazio", broken((map) => { map.crossCutting = []; }), "crossCutting"],
    ["routeAliases ausente", broken((map) => { delete map.routeAliases; }), "routeAliases ausente"],
    ["apelido sem rota", broken((map) => { map.routeAliases = [{ route: "jobs", patterns: ["a"] }]; }), "rota inválida"],
    ["apelido sem padrão", broken((map) => { map.routeAliases = [{ route: "/jobs", patterns: [] }]; }), "sem padrões"],
    ["áreas ausentes", broken((map) => { map.areas = []; }), "areas ausentes"],
    ["área sem id", broken((map) => { areas(map)[0]!.id = ""; }), "sem id"],
    ["área duplicada", broken((map) => { areas(map)[1]!.id = areas(map)[0]!.id; }), "duplicada"],
    ["área sem módulo", broken((map) => { areas(map)[0]!.modules = []; }), "sem módulo"],
    ["padrões inválidos", broken((map) => { areas(map)[0]!.patterns = [""]; }), "padrões"],
    ["rota com query", broken((map) => { areas(map)[0]!.routes = ["/jobs?x=1"]; }), "rotas"],
  ])("%s", (_name, run, message) => {
    expect(run).toThrow(message);
  });
});
