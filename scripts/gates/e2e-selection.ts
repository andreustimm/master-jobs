// E2E seletivo (#320): dos caminhos que pediram o gate `e2e`, quais áreas de
// `tests/e2e/ui/index.mjs` rodar — ou a suíte inteira. O mapa mora em
// `config/e2e-spec-map.json`; aqui só a validação (que falha fechado) e a
// seleção, em funções puras.
//
// Um caminho seleciona área por três vias: é módulo da área (o teste mudou),
// casa um padrão da área, ou é arquivo de uma rota que a área visita. Caminho
// transversal ou que nenhuma via reconhece pede a suíte inteira: a seleção
// nunca decide "só a fumaça" por não conhecer o arquivo.
import { globToRegex } from "./impact.ts";

export type E2EArea = { id: string; modules: string[]; patterns: string[]; routes: string[] };
export type RouteAlias = { route: string; patterns: string[] };
export type E2EMap = {
  schemaVersion: 1;
  mapVersion: string;
  crossCutting: string[];
  routeAliases: RouteAlias[];
  areas: E2EArea[];
};

export type Escalation = { path: string; reason: string };
export type Selection =
  | { mode: "affected"; areas: string[]; escalations: [] }
  | { mode: "full"; areas: []; escalations: Escalation[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item !== "");
}

/** Rota do mapa: começa com `/`, sem query, segmentos não vazios. */
function isRoute(value: string): boolean {
  return value === "/" || /^(?:\/[^/?#\s]+)+$/.test(value);
}

export function validateE2EMap(raw: unknown): E2EMap {
  if (!isRecord(raw)) throw new Error("e2e-spec-map: o mapa precisa ser um objeto");
  if (raw.schemaVersion !== 1) throw new Error("e2e-spec-map: schemaVersion precisa ser 1");
  if (typeof raw.mapVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(raw.mapVersion)) {
    throw new Error("e2e-spec-map: mapVersion precisa ser SemVer (x.y.z)");
  }
  if (!isStringList(raw.crossCutting) || raw.crossCutting.length === 0) throw new Error("e2e-spec-map: crossCutting ausente");
  if (!Array.isArray(raw.routeAliases)) throw new Error("e2e-spec-map: routeAliases ausente");
  const routeAliases = raw.routeAliases.map((alias: unknown): RouteAlias => {
    if (!isRecord(alias) || typeof alias.route !== "string" || !isRoute(alias.route)) {
      throw new Error("e2e-spec-map: routeAliases com rota inválida");
    }
    if (!isStringList(alias.patterns) || alias.patterns.length === 0) {
      throw new Error(`e2e-spec-map: routeAliases ${alias.route} sem padrões`);
    }
    return { route: alias.route, patterns: [...alias.patterns] };
  });
  if (!Array.isArray(raw.areas) || raw.areas.length === 0) throw new Error("e2e-spec-map: areas ausentes");
  const ids = new Set<string>();
  const areas = raw.areas.map((area: unknown): E2EArea => {
    if (!isRecord(area) || typeof area.id !== "string" || area.id === "") throw new Error("e2e-spec-map: área sem id");
    if (ids.has(area.id)) throw new Error(`e2e-spec-map: área duplicada ${area.id}`);
    ids.add(area.id);
    if (!isStringList(area.modules) || area.modules.length === 0) throw new Error(`e2e-spec-map: área ${area.id} sem módulo`);
    if (!isStringList(area.patterns)) throw new Error(`e2e-spec-map: padrões da área ${area.id} inválidos`);
    if (!isStringList(area.routes) || !area.routes.every(isRoute)) throw new Error(`e2e-spec-map: rotas da área ${area.id} inválidas`);
    return { id: area.id, modules: [...area.modules], patterns: [...area.patterns], routes: [...area.routes] };
  });
  return { schemaVersion: 1, mapVersion: raw.mapVersion, crossCutting: [...raw.crossCutting], routeAliases, areas };
}

const isDynamic = (segment: string) => /^\[.+\]$/.test(segment);

export function routeSegments(route: string): string[] {
  return route.split("/").filter(Boolean);
}

/**
 * Onde um arquivo de `app/` responde, como segmentos, e se ele é a página da
 * raiz. Grupo de rota `(nome)` não aparece na URL; pasta privada `_nome` e o
 * que vem abaixo dela pertencem à rota de cima. `null`: fora de `app/`.
 */
export function appRouteOf(file: string): { segments: string[]; rootFile: boolean; page: boolean } | null {
  if (!file.startsWith("app/")) return null;
  const parts = file.slice("app/".length).split("/");
  const name = parts.pop()!;
  const segments: string[] = [];
  for (const part of parts) {
    if (part.startsWith("_")) break;
    if (/^\(.+\)$/.test(part)) continue;
    segments.push(part);
  }
  return { segments, rootFile: parts.length === 0, page: /^page\.(?:tsx|ts|jsx|js|mdx)$/.test(name) };
}

/**
 * A rota da área está sob o diretório alterado? Segmento dinâmico (`[id]`) de
 * qualquer lado casa com qualquer valor. É prefixo de propósito: um `layout`
 * ou componente de `app/jobs/` afeta `/jobs/[id]` também.
 */
export function routeUnder(directory: readonly string[], route: string): boolean {
  const target = routeSegments(route);
  if (directory.length > target.length) return false;
  return directory.every((segment, index) => isDynamic(segment) || isDynamic(target[index]!) || segment === target[index]);
}

/** A rota concreta (`/jobs/904000103`) casa a rota do mapa (`/jobs/[id]`)? Mesmo tamanho, dinâmico casa tudo. */
export function routeMatches(concrete: string, mapped: string): boolean {
  const left = routeSegments(concrete);
  return left.length === routeSegments(mapped).length && routeUnder(left, mapped);
}

/**
 * As rotas que um módulo de E2E cita: `${BASE}/caminho` (com `${…}` virando
 * segmento dinâmico) e literais entre aspas que começam com `/minúscula`. É
 * cota inferior, não inventário: navegação por clique não aparece aqui. Serve
 * para o mapa não ficar para trás quando uma área passa a visitar tela nova.
 */
export function routesInSource(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(/\$\{(?:BASE|base)\}((?:\/(?:[A-Za-z0-9_.\-%]+|\$\{[^}]+\}))*)/g)) {
    const path = match[1]!.replace(/\$\{[^}]+\}/g, "[x]");
    found.add(path === "" ? "/" : path);
  }
  for (const match of source.matchAll(/["'`](\/[a-z][a-z0-9-]*(?:\/[A-Za-z0-9_\-[\]{}%.]+)*)(?=[?#"'`])/g)) found.add(match[1]!);
  return [...found].sort();
}

function matchesAny(patterns: readonly string[], path: string): boolean {
  return patterns.some((pattern) => globToRegex(pattern).test(path));
}

/**
 * As áreas que os caminhos pedem, na ordem do mapa, ou a suíte inteira com o
 * motivo de cada escalada. Lista vazia não é pedido de nada: quem chama só
 * seleciona quando o gate `e2e` existe no plano.
 */
export function selectE2E(map: E2EMap, files: readonly string[]): Selection {
  const selected = new Set<string>();
  const escalations: Escalation[] = [];
  for (const file of files) {
    if (matchesAny(map.crossCutting, file)) {
      escalations.push({ path: file, reason: "transversal" });
      continue;
    }
    const byModule = map.areas.filter((area) => area.modules.includes(file) || matchesAny(area.patterns, file));
    const alias = map.routeAliases.find((item) => matchesAny(item.patterns, file));
    const route = appRouteOf(file);
    let byRoute: E2EArea[] = [];
    if (alias) {
      const directory = routeSegments(alias.route);
      byRoute = map.areas.filter((area) => area.routes.some((item) => routeUnder(directory, item)));
    } else if (route && route.rootFile) {
      // Arquivo solto na raiz de `app/`: só a página tem rota ("/"); o resto
      // (layout, estilo, provedor) precisa de padrão ou é transversal.
      byRoute = route.page ? map.areas.filter((area) => area.routes.includes("/")) : [];
    } else if (route) {
      byRoute = map.areas.filter((area) => area.routes.some((item) => routeUnder(route.segments, item)));
    }
    const hits = [...byModule, ...byRoute];
    if (hits.length === 0) {
      escalations.push({ path: file, reason: "sem área em config/e2e-spec-map.json" });
      continue;
    }
    for (const area of hits) selected.add(area.id);
  }
  if (escalations.length > 0) return { mode: "full", areas: [], escalations };
  return { mode: "affected", areas: map.areas.filter((area) => selected.has(area.id)).map((area) => area.id), escalations: [] };
}
