import { SPLASH_FADE_MS } from "./splash.ts";
import {
  INITIAL_NAVIGATION_TRANSITION,
  TRANSITION_MIN_MS,
  TRANSITION_PROLONGED_MS,
  classifyNavigation,
  isTransitionReady,
  normalizeNavigationTarget,
  parseNavigationOfflineMessage,
  reduceTransition,
  type NavigationTransition,
} from "./transition.ts";

type TimerHandle = unknown;
type Listener = () => void;
type BrowserListener = (event: unknown) => void;

export type TransitionEventSource = {
  addEventListener(type: string, listener: BrowserListener): void;
  removeEventListener(type: string, listener: BrowserListener): void;
};

export type TransitionStoreOptions = {
  now?: () => number;
  setTimer?: (callback: () => void, delay: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  currentUrl?: () => string | null;
  hardNavigate?: (target: string) => void;
  connectivity?: TransitionEventSource | null;
  serviceWorker?: TransitionEventSource | null;
};

export type TransitionStore = {
  getSnapshot(): NavigationTransition;
  subscribe(listener: Listener): () => void;
  begin(url: string, currentOverride?: string): number | null;
  commit(url: string, generation?: number): void;
  failRoute(generation?: number): void;
  offline(target: string, generation?: number): void;
  reset(generation?: number): void;
  retry(): void;
  destroy(): void;
};

type ActiveTimer = { generation: number; handle: TimerHandle };

function browserOptions(): Required<
  Pick<TransitionStoreOptions, "now" | "setTimer" | "clearTimer" | "currentUrl" | "hardNavigate">
> & Pick<TransitionStoreOptions, "connectivity" | "serviceWorker"> {
  const browser = typeof window === "undefined" ? null : window;
  const worker = typeof navigator === "undefined" ? null : navigator.serviceWorker;
  return {
    now: () => (typeof performance === "undefined" ? 0 : performance.now()),
    setTimer: (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimer: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    currentUrl: () => browser?.location.href ?? null,
    hardNavigate: (target) => browser?.location.assign(target),
    connectivity: browser,
    serviceWorker: worker,
  };
}

export function createTransitionStore(options: TransitionStoreOptions = {}): TransitionStore {
  const defaults = browserOptions();
  const now = options.now ?? defaults.now;
  const setTimer = options.setTimer ?? defaults.setTimer;
  const clearTimer = options.clearTimer ?? defaults.clearTimer;
  const currentUrl = options.currentUrl ?? defaults.currentUrl;
  const hardNavigate = options.hardNavigate ?? defaults.hardNavigate;
  const connectivity = options.connectivity === undefined ? defaults.connectivity : options.connectivity;
  const serviceWorker = options.serviceWorker === undefined ? defaults.serviceWorker : options.serviceWorker;

  let snapshot = INITIAL_NAVIGATION_TRANSITION;
  let prolongedTimer: ActiveTimer | null = null;
  let leaveTimer: ActiveTimer | null = null;
  let resetTimer: ActiveTimer | null = null;
  let retryUsedGeneration: number | null = null;
  let destroyed = false;
  const listeners = new Set<Listener>();

  const clearActiveTimer = (timer: ActiveTimer | null): null => {
    if (timer) clearTimer(timer.handle);
    return null;
  };

  const clearTimers = (): void => {
    prolongedTimer = clearActiveTimer(prolongedTimer);
    leaveTimer = clearActiveTimer(leaveTimer);
    resetTimer = clearActiveTimer(resetTimer);
  };

  const dispatch = (event: Parameters<typeof reduceTransition>[1]): boolean => {
    const next = reduceTransition(snapshot, event);
    if (next === snapshot) return false;
    snapshot = next;
    for (const listener of listeners) listener();
    return true;
  };

  const scheduleReset = (generation: number): void => {
    resetTimer = clearActiveTimer(resetTimer);
    resetTimer = {
      generation,
      handle: setTimer(() => {
        resetTimer = null;
        dispatch({ type: "reset", generation });
      }, SPLASH_FADE_MS),
    };
  };

  const leave = (generation: number): void => {
    leaveTimer = null;
    if (dispatch({ type: "leave", generation })) scheduleReset(generation);
  };

  const scheduleLeaveIfReady = (): void => {
    if (!isTransitionReady(snapshot) || snapshot.startedAt === null) return;
    if (leaveTimer?.generation === snapshot.generation) return;

    leaveTimer = clearActiveTimer(leaveTimer);
    const generation = snapshot.generation;
    const delay = snapshot.startedAt + TRANSITION_MIN_MS - now();
    if (delay <= 0) {
      leave(generation);
      return;
    }
    leaveTimer = { generation, handle: setTimer(() => leave(generation), delay) };
  };

  const begin = (url: string, currentOverride?: string): number | null => {
    if (destroyed) return null;
    const base = currentOverride ?? currentUrl();
    if (!base) return null;
    const normalized = normalizeNavigationTarget(url, base);
    if (!normalized) return null;
    if (snapshot.phase !== "idle" && snapshot.target === normalized) return snapshot.generation;

    const target = classifyNavigation(url, base);
    if (!target) return null;
    clearTimers();
    retryUsedGeneration = null;
    const at = now();
    dispatch({ type: "start", target, at });
    const generation = snapshot.generation;
    prolongedTimer = {
      generation,
      handle: setTimer(() => {
        prolongedTimer = null;
        dispatch({ type: "prolonged", generation });
      }, TRANSITION_PROLONGED_MS),
    };
    return generation;
  };

  const commit = (url: string, generation = snapshot.generation): void => {
    if (destroyed || generation !== snapshot.generation) return;
    const base = currentUrl();
    if (!base) return;
    const normalized = normalizeNavigationTarget(url, base);
    if (!normalized) return;
    dispatch({ type: "url-committed", url: normalized, generation });
    scheduleLeaveIfReady();
  };

  const failRoute = (generation = snapshot.generation): void => {
    if (destroyed || generation !== snapshot.generation) return;
    clearTimers();
    dispatch({ type: "reset", generation });
  };

  const offline = (target: string, generation = snapshot.generation): void => {
    if (destroyed) return;
    const base = currentUrl();
    if (!base) return;
    const normalized = normalizeNavigationTarget(target, base);
    if (!normalized) return;
    if (dispatch({ type: "offline", target: normalized, generation })) {
      clearTimers();
    }
  };

  const reset = (generation = snapshot.generation): void => {
    if (destroyed || generation !== snapshot.generation) return;
    clearTimers();
    dispatch({ type: "reset", generation });
  };

  const retry = (): void => {
    if (destroyed || snapshot.phase !== "offline" || snapshot.target === null) return;
    const generation = snapshot.generation;
    if (retryUsedGeneration === generation) return;
    retryUsedGeneration = generation;
    const target = snapshot.target;
    clearTimers();
    dispatch({ type: "reset", generation });
    hardNavigate(target);
  };

  const onOffline: BrowserListener = () => {
    if (snapshot.target) offline(snapshot.target, snapshot.generation);
  };
  const onOnline: BrowserListener = () => undefined;
  const onWorkerMessage: BrowserListener = (event) => {
    const base = currentUrl();
    if (!base || typeof event !== "object" || event === null) return;
    let data: unknown;
    try {
      data = Reflect.get(event, "data");
    } catch {
      return;
    }
    const message = parseNavigationOfflineMessage(data, base);
    if (message) offline(message.url, snapshot.generation);
  };

  connectivity?.addEventListener("offline", onOffline);
  connectivity?.addEventListener("online", onOnline);
  serviceWorker?.addEventListener("message", onWorkerMessage);

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (destroyed) return () => undefined;
      listeners.add(listener);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
      };
    },
    begin,
    commit,
    failRoute,
    offline,
    reset,
    retry,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimers();
      listeners.clear();
      connectivity?.removeEventListener("offline", onOffline);
      connectivity?.removeEventListener("online", onOnline);
      serviceWorker?.removeEventListener("message", onWorkerMessage);
    },
  };
}

export const transitionStore = createTransitionStore();
