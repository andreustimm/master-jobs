export const TRANSITION_MIN_MS = 180;
export const TRANSITION_PROLONGED_MS = 3000;

export type TransitionPhase = "idle" | "loading" | "prolonged" | "offline" | "leaving";

export type NavigationTransition = {
  generation: number;
  phase: TransitionPhase;
  target: string | null;
  startedAt: number | null;
  committed: boolean;
  /**
   * A navegação fica na mesma tela: só filtro, ordem, página ou densidade
   * mudaram. Ela não cobre a tela nem torna o shell `inert` — a pessoa continua
   * vendo e operando a lista, e um clique novo abre outra geração. Demora e
   * falta de rede zeram o campo e promovem a espera ao overlay completo.
   */
  soft: boolean;
};

export type TransitionEvent =
  | { type: "start"; target: string; at: number; soft: boolean }
  | { type: "url-committed"; url: string; generation: number }
  | { type: "prolonged"; generation: number }
  | { type: "offline"; target: string; generation: number }
  | { type: "leave"; generation: number }
  | { type: "reset"; generation: number };

export type NavigationOfflineMessage = {
  type: "navigation-offline";
  url: string;
};

export type TransitionLabels = {
  loading: string;
  updating: string;
  prolonged: string;
  offlineTitle: string;
  offlineBody: string;
  retry: string;
  failedTitle: string;
  failedBody: string;
};

export type NavigationActivation = {
  defaultPrevented: boolean;
  button?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
};

export type NavigationElementOptions = {
  download?: boolean | string | null;
  target?: string | null;
};

export const INITIAL_NAVIGATION_TRANSITION: NavigationTransition = {
  generation: 0,
  phase: "idle",
  target: null,
  startedAt: null,
  committed: false,
  soft: false,
};

const INVALID_PERCENT_ESCAPE = /%(?![0-9a-f]{2})/i;

function isHttpProtocol(protocol: string): boolean {
  return protocol === "http:" || protocol === "https:";
}

function parseUrl(candidate: string, current: string): URL | null {
  if (INVALID_PERCENT_ESCAPE.test(candidate) || INVALID_PERCENT_ESCAPE.test(current)) return null;

  try {
    const base = new URL(current);
    const parsed = new URL(candidate, base);
    if (!isHttpProtocol(base.protocol) || !isHttpProtocol(parsed.protocol)) return null;
    if (parsed.origin !== base.origin) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Same-origin pathname/search identity. Fragments never identify a screen. */
export function normalizeNavigationTarget(candidate: string, current: string): string | null {
  if (typeof candidate !== "string" || typeof current !== "string") return null;
  const parsed = parseUrl(candidate, current);
  if (!parsed) return null;

  parsed.searchParams.sort();
  return `${parsed.pathname}${parsed.search}`;
}

/** Returns a target only when the candidate changes the current screen. */
export function classifyNavigation(candidate: string, current: string): string | null {
  const target = normalizeNavigationTarget(candidate, current);
  const active = normalizeNavigationTarget(current, current);
  return target !== null && active !== null && target !== active ? target : null;
}

/**
 * O destino é a mesma tela quando só a query muda. `current` já deve ser uma
 * URL absoluta; qualquer entrada que não normalize conta como troca de tela,
 * porque errar para o lado do overlay só custa espera, e errar para o outro
 * lado deixaria conteúdo operável de uma tela que está saindo.
 */
export function isSameScreenNavigation(candidate: string, current: string): boolean {
  const target = normalizeNavigationTarget(candidate, current);
  const active = normalizeNavigationTarget(current, current);
  if (target === null || active === null) return false;
  const path = (value: string) => value.split("?", 1)[0];
  return path(target) === path(active);
}

/** Native link behavior wins before a project transition may start. */
export function shouldStartFromLinkEvent(
  event: NavigationActivation,
  candidate: string,
  current: string,
  options: NavigationElementOptions = {},
): boolean {
  if (
    event.defaultPrevented ||
    (event.button ?? 0) !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return false;
  }

  if (options.download !== undefined && options.download !== null && options.download !== false) {
    return false;
  }

  const target = options.target?.trim().toLowerCase();
  if (target && target !== "_self") return false;
  return classifyNavigation(candidate, current) !== null;
}

function isPending(phase: TransitionPhase): boolean {
  return phase === "loading" || phase === "prolonged";
}

export function isTransitionReady(state: NavigationTransition): boolean {
  return isPending(state.phase) && state.committed;
}

function idleAtGeneration(generation: number): NavigationTransition {
  return { ...INITIAL_NAVIGATION_TRANSITION, generation };
}

/** Pure authority for every transition-state field. */
export function reduceTransition(
  state: NavigationTransition,
  event: TransitionEvent,
): NavigationTransition {
  if (event.type === "start") {
    if (state.phase !== "idle" && state.target === event.target) return state;
    return {
      generation: state.generation + 1,
      phase: "loading",
      target: event.target,
      startedAt: event.at,
      committed: false,
      soft: event.soft,
    };
  }

  if (event.generation !== state.generation) return state;

  switch (event.type) {
    case "url-committed":
      if (!isPending(state.phase) || event.url !== state.target || state.committed) return state;
      return { ...state, committed: true };
    case "prolonged":
      if (state.phase !== "loading") return state;
      return { ...state, phase: "prolonged", soft: false };
    case "offline":
      if (!isPending(state.phase) || event.target !== state.target) return state;
      return { ...state, phase: "offline", soft: false };
    case "leave":
      if (!isTransitionReady(state)) return state;
      return { ...state, phase: "leaving" };
    case "reset":
      if (state.phase === "idle") return state;
      return idleAtGeneration(state.generation);
  }
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function parseNavigationOfflineMessage(
  value: unknown,
  current?: string,
): NavigationOfflineMessage | null {
  try {
    const record = plainRecord(value);
    if (!record) return null;
    const keys = Object.keys(record).sort();
    if (keys.length !== 2 || keys[0] !== "type" || keys[1] !== "url") return null;
    if (record.type !== "navigation-offline" || typeof record.url !== "string") return null;

    const base = current ?? "https://navigation.invalid/";
    if (normalizeNavigationTarget(record.url, base) === null) return null;
    if (!current && !record.url.startsWith("/")) return null;
    return { type: "navigation-offline", url: record.url };
  } catch {
    return null;
  }
}

const TRANSITION_LABEL_KEYS = [
  "loading",
  "updating",
  "prolonged",
  "offlineTitle",
  "offlineBody",
  "retry",
  "failedTitle",
  "failedBody",
] as const;

export function validateTransitionLabels(value: unknown): TransitionLabels {
  const record = plainRecord(value);
  if (!record) throw new TypeError("Invalid transition labels");
  for (const key of TRANSITION_LABEL_KEYS) {
    if (typeof record[key] !== "string" || record[key].trim() === "") {
      throw new TypeError(`Invalid transition label: ${key}`);
    }
  }
  return value as TransitionLabels;
}

export type PublicNavigationErrorKey = "transition.failedBody";

export function toPublicNavigationError(_error: unknown): PublicNavigationErrorKey {
  return "transition.failedBody";
}
