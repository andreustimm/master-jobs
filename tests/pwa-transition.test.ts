import { describe, expect, it, vi } from "vitest";
import { en } from "../src/core/i18n/en.ts";
import { ptBR } from "../src/core/i18n/pt-BR.ts";
import {
  INITIAL_NAVIGATION_TRANSITION,
  TRANSITION_MIN_MS,
  TRANSITION_PROLONGED_MS,
  classifyNavigation,
  isTransitionReady,
  parseNavigationOfflineMessage,
  reduceTransition,
  shouldStartFromLinkEvent,
  toPublicNavigationError,
  validateTransitionLabels,
  type NavigationTransition,
} from "../src/core/pwa/transition.ts";
import {
  createTransitionStore,
  type TransitionEventSource,
} from "../src/core/pwa/transition-store.ts";

type Scheduled = {
  id: number;
  due: number;
  callback: () => void;
  cancelled: boolean;
};

function manualTime(start = 0) {
  let current = start;
  let nextId = 1;
  const scheduled: Scheduled[] = [];

  return {
    now: () => current,
    setTimer(callback: () => void, delay: number): Scheduled {
      const timer = { id: nextId++, due: current + Math.max(0, delay), callback, cancelled: false };
      scheduled.push(timer);
      return timer;
    },
    clearTimer(handle: unknown): void {
      (handle as Scheduled).cancelled = true;
    },
    advance(ms: number): void {
      const target = current + ms;
      while (true) {
        const timer = scheduled
          .filter((candidate) => !candidate.cancelled && candidate.due <= target)
          .sort((left, right) => left.due - right.due || left.id - right.id)[0];
        if (!timer) break;
        timer.cancelled = true;
        current = timer.due;
        timer.callback();
      }
      current = target;
    },
    activeTimers: () => scheduled.filter((timer) => !timer.cancelled).length,
  };
}

function eventSource() {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  let additions = 0;
  let removals = 0;
  const source: TransitionEventSource = {
    addEventListener(type, listener) {
      additions += 1;
      const current = listeners.get(type) ?? new Set();
      current.add(listener);
      listeners.set(type, current);
    },
    removeEventListener(type, listener) {
      removals += 1;
      listeners.get(type)?.delete(listener);
    },
  };
  return {
    source,
    emit(type: string, event: unknown = {}): void {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
    counts: () => ({ additions, removals }),
  };
}

function storeFixture(start = 0) {
  const time = manualTime(start);
  let currentUrl = "https://jobs.example/jobs";
  const navigations: string[] = [];
  const connectivity = eventSource();
  const serviceWorker = eventSource();
  const store = createTransitionStore({
    now: time.now,
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
    currentUrl: () => currentUrl,
    hardNavigate: (target) => navigations.push(target),
    connectivity: connectivity.source,
    serviceWorker: serviceWorker.source,
  });
  return {
    store,
    time,
    navigations,
    connectivity,
    serviceWorker,
    setCurrentUrl: (url: string) => {
      currentUrl = url;
    },
  };
}

function started(target = "/pipeline", at = 1000): NavigationTransition {
  return reduceTransition(INITIAL_NAVIGATION_TRANSITION, { type: "start", target, at });
}

describe("navigation URL contract", () => {
  it("UT-001 classifies and normalizes a same-origin screen change", () => {
    expect(
      classifyNavigation(
        "/pipeline?stage=applied&owner=me",
        "https://jobs.example/jobs",
      ),
    ).toBe("/pipeline?owner=me&stage=applied");
  });

  it("UT-002 ignores the current screen with or without a changed fragment", () => {
    const current = "https://jobs.example/jobs?sort=fit";
    expect(classifyNavigation("/jobs?sort=fit", current)).toBeNull();
    expect(classifyNavigation("/jobs?sort=fit#details", current)).toBeNull();
  });

  it.each(["javascript:alert(1)", "https://other.example/jobs", "%"])(
    "UT-003 rejects unsafe, external, or malformed candidate %s without throwing",
    (candidate) => {
      expect(() => classifyNavigation(candidate, "https://jobs.example/jobs")).not.toThrow();
      expect(classifyNavigation(candidate, "https://jobs.example/jobs")).toBeNull();
    },
  );

  it("UT-038 accepts a 16 KiB path and rejects invalid escapes", () => {
    const path = `/p/${"a".repeat(16 * 1024)}`;
    expect(classifyNavigation(path, "https://jobs.example/jobs")).toBe(path);
    expect(classifyNavigation("/p/%zz", "https://jobs.example/jobs")).toBeNull();
  });

  it("UT-035 preserves native activation behavior before classifying the target", () => {
    const ordinary = { defaultPrevented: false, button: 0 };
    const current = "https://jobs.example/jobs";
    expect(shouldStartFromLinkEvent(ordinary, "/pipeline", current)).toBe(true);
    for (const event of [
      { ...ordinary, defaultPrevented: true },
      { ...ordinary, button: 1 },
      { ...ordinary, metaKey: true },
      { ...ordinary, ctrlKey: true },
      { ...ordinary, shiftKey: true },
      { ...ordinary, altKey: true },
    ]) {
      expect(shouldStartFromLinkEvent(event, "/pipeline", current)).toBe(false);
    }
    expect(shouldStartFromLinkEvent(ordinary, "/pipeline", current, { download: "" })).toBe(false);
    expect(shouldStartFromLinkEvent(ordinary, "/pipeline", current, { target: "_blank" })).toBe(false);
    expect(shouldStartFromLinkEvent(ordinary, "/pipeline", current, { target: "_self" })).toBe(true);
  });
});

describe("pure transition reducer", () => {
  it("UT-004 starts generation one with a clean loading state", () => {
    expect(started()).toEqual({
      generation: 1,
      phase: "loading",
      target: "/pipeline",
      startedAt: 1000,
      committed: false,
    });
  });

  it("UT-005 coalesces a duplicate active target", () => {
    const first = started();
    expect(reduceTransition(first, { type: "start", target: "/pipeline", at: 1001 })).toBe(first);
  });

  it("UT-006 gives a different target a new clean generation", () => {
    let state = started();
    state = reduceTransition(state, { type: "url-committed", url: "/pipeline", generation: 1 });
    state = reduceTransition(state, { type: "prolonged", generation: 1 });
    expect(reduceTransition(state, { type: "start", target: "/compare", at: 5000 })).toEqual({
      generation: 2,
      phase: "loading",
      target: "/compare",
      startedAt: 5000,
      committed: false,
    });
  });

  it("UT-007 ignores a commit for another URL", () => {
    const state = started();
    expect(
      reduceTransition(state, { type: "url-committed", url: "/compare", generation: 1 }),
    ).toBe(state);
  });

  it("UT-008 records the matching commit", () => {
    const state = reduceTransition(started(), { type: "url-committed", url: "/pipeline", generation: 1 });
    expect(state).toMatchObject({ phase: "loading", committed: true });
  });

  it("UT-009 becomes ready when the matching URL commits", () => {
    const state = reduceTransition(started(), { type: "url-committed", url: "/pipeline", generation: 1 });
    expect(isTransitionReady(state)).toBe(true);
  });

  it("UT-012 ignores prolonged, leave, and reset callbacks from an older generation", () => {
    const current = reduceTransition(started(), { type: "start", target: "/compare", at: 1100 });
    for (const event of [
      { type: "prolonged", generation: 1 },
      { type: "leave", generation: 1 },
      { type: "reset", generation: 1 },
    ] as const) {
      expect(reduceTransition(current, event)).toBe(current);
    }
  });

  it("UT-014 ignores offline state for a mismatched target or stale generation", () => {
    const state = started();
    expect(reduceTransition(state, { type: "offline", target: "/compare", generation: 1 })).toBe(
      state,
    );
    expect(reduceTransition(state, { type: "offline", target: "/pipeline", generation: 0 })).toBe(
      state,
    );
  });
});

describe("browser-local transition store", () => {
  it("coalesces duplicate starts without duplicate notifications or timers", () => {
    const fixture = storeFixture(1000);
    const listener = vi.fn();
    fixture.store.subscribe(listener);
    expect(fixture.store.begin("/pipeline")).toBe(1);
    const timers = fixture.time.activeTimers();
    expect(fixture.store.begin("https://jobs.example/pipeline#top")).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(fixture.time.activeTimers()).toBe(timers);
  });

  it("UT-010 leaves at 180 ms, never at 179 ms", () => {
    const fixture = storeFixture(1000);
    expect(TRANSITION_MIN_MS).toBe(180);
    fixture.store.begin("/pipeline");
    fixture.store.commit("/pipeline");
    fixture.time.advance(179);
    expect(fixture.store.getSnapshot().phase).toBe("loading");
    fixture.time.advance(1);
    expect(fixture.store.getSnapshot().phase).toBe("leaving");
  });

  it("UT-011 becomes prolonged at 3,000 ms and has no dismissal maximum", () => {
    const fixture = storeFixture();
    expect(TRANSITION_PROLONGED_MS).toBe(3000);
    fixture.store.begin("/pipeline");
    fixture.time.advance(2999);
    expect(fixture.store.getSnapshot().phase).toBe("loading");
    fixture.time.advance(1);
    expect(fixture.store.getSnapshot().phase).toBe("prolonged");
    fixture.time.advance(60_000);
    expect(fixture.store.getSnapshot().phase).toBe("prolonged");
  });

  it.each(["loading", "prolonged"] as const)(
    "UT-013 enters offline exactly once from %s",
    (phase) => {
      const fixture = storeFixture();
      const listener = vi.fn();
      fixture.store.subscribe(listener);
      fixture.store.begin("/pipeline");
      if (phase === "prolonged") fixture.time.advance(3000);
      fixture.store.offline("/pipeline", 1);
      const calls = listener.mock.calls.length;
      expect(fixture.store.getSnapshot().phase).toBe("offline");
      fixture.store.offline("/pipeline", 1);
      expect(listener).toHaveBeenCalledTimes(calls);
    },
  );

  it("UT-015 rejects every out-of-order signal owned by generation one", () => {
    const fixture = storeFixture();
    const first = fixture.store.begin("/pipeline");
    const second = fixture.store.begin("/compare");
    expect([first, second]).toEqual([1, 2]);
    fixture.store.commit("/pipeline", 1);
    fixture.store.offline("/pipeline", 1);
    fixture.store.failRoute(1);
    fixture.store.reset(1);
    fixture.time.advance(3000);
    expect(fixture.store.getSnapshot()).toMatchObject({
      generation: 2,
      target: "/compare",
      phase: "prolonged",
      committed: false,
    });
  });

  it("UT-016 route failure cancels timers and leaves an operable idle snapshot", () => {
    const fixture = storeFixture();
    fixture.store.begin("/pipeline");
    fixture.store.failRoute(1);
    expect(fixture.store.getSnapshot()).toEqual({ ...INITIAL_NAVIGATION_TRANSITION, generation: 1 });
    expect(fixture.time.activeTimers()).toBe(0);
    fixture.time.advance(5000);
    expect(fixture.store.getSnapshot().phase).toBe("idle");
  });

  it("UT-017 accepts one hard retry for one offline generation", () => {
    const fixture = storeFixture();
    fixture.store.begin("/pipeline");
    fixture.store.offline("/pipeline", 1);
    fixture.store.retry();
    fixture.store.retry();
    expect(fixture.navigations).toEqual(["/pipeline"]);
    expect(fixture.store.getSnapshot().phase).toBe("idle");
  });

  it("UT-018 online preserves offline state and never replays navigation", () => {
    const fixture = storeFixture();
    fixture.store.begin("/pipeline");
    fixture.connectivity.emit("offline");
    fixture.connectivity.emit("online");
    expect(fixture.store.getSnapshot().phase).toBe("offline");
    expect(fixture.navigations).toEqual([]);
  });

  it("UT-029 starts clean after success, route error, and offline retry", () => {
    const success = storeFixture();
    success.store.begin("/pipeline");
    success.store.commit("/pipeline");
    success.time.advance(180 + 260);
    success.store.begin("/compare");

    const error = storeFixture();
    error.store.begin("/pipeline");
    error.store.failRoute();
    error.store.begin("/compare");

    const offline = storeFixture();
    offline.store.begin("/pipeline");
    offline.store.offline("/pipeline");
    offline.store.retry();
    offline.store.begin("/compare");

    for (const fixture of [success, error, offline]) {
      expect(fixture.store.getSnapshot()).toMatchObject({
        phase: "loading",
        target: "/compare",
        committed: false,
      });
    }
  });

  it("UT-030 keeps repeated matching commits idempotent", () => {
    const fixture = storeFixture(1000);
    fixture.store.begin("/pipeline");
    fixture.store.commit("/pipeline");
    const generation = fixture.store.getSnapshot().generation;
    fixture.store.commit("/pipeline");
    expect(fixture.store.getSnapshot()).toMatchObject({ generation, phase: "loading", committed: true });
    fixture.time.advance(180);
    expect(fixture.store.getSnapshot().phase).toBe("leaving");
  });

  it("handles matching worker messages and ignores hostile message events", () => {
    const fixture = storeFixture();
    fixture.store.begin("/pipeline");
    fixture.serviceWorker.emit("message", {
      data: { type: "navigation-offline", url: "https://jobs.example/pipeline" },
    });
    expect(fixture.store.getSnapshot().phase).toBe("offline");

    const hostile = storeFixture();
    hostile.store.begin("/pipeline");
    hostile.serviceWorker.emit("message", new Proxy({}, { get: () => { throw new Error("no"); } }));
    expect(hostile.store.getSnapshot().phase).toBe("loading");
  });

  it("cleans subscriptions, timers, and browser listeners idempotently", () => {
    const fixture = storeFixture();
    const unsubscribe = fixture.store.subscribe(vi.fn());
    fixture.store.begin("/pipeline");
    unsubscribe();
    unsubscribe();
    fixture.store.destroy();
    fixture.store.destroy();
    expect(fixture.time.activeTimers()).toBe(0);
    expect(fixture.connectivity.counts()).toEqual({ additions: 2, removals: 2 });
    expect(fixture.serviceWorker.counts()).toEqual({ additions: 1, removals: 1 });
    expect(fixture.store.begin("/compare")).toBeNull();
  });
});

describe("offline and public-copy boundaries", () => {
  it("UT-019 accepts the exact typed relative offline message", () => {
    const message = { type: "navigation-offline", url: "/jobs/1" };
    expect(parseNavigationOfflineMessage(message)).toEqual(message);
  });

  it("UT-020 rejects malformed and prototype-hostile messages without throwing", () => {
    const hostile = new Proxy({}, { ownKeys: () => { throw new Error("hostile"); } });
    const inherited = Object.create({ type: "navigation-offline", url: "/jobs/1" });
    const values: unknown[] = [
      null,
      [],
      { type: "unknown", url: "/jobs/1" },
      { type: "navigation-offline" },
      { type: "navigation-offline", url: "https://other.example/jobs" },
      { type: "navigation-offline", url: "/jobs/%" },
      { type: "navigation-offline", url: "/jobs/1", extra: true },
      inherited,
      hostile,
    ];
    for (const value of values) {
      expect(() => parseNavigationOfflineMessage(value)).not.toThrow();
      expect(parseNavigationOfflineMessage(value)).toBeNull();
    }
  });

  it("UT-033 validates complete nonblank transition copy in both typed locales", () => {
    expect(validateTransitionLabels(ptBR.transition)).toEqual(ptBR.transition);
    expect(validateTransitionLabels(en.transition)).toEqual(en.transition);
    expect(() => validateTransitionLabels({ ...en.transition, prolonged: " " })).toThrow(
      "Invalid transition label: prolonged",
    );
    const missing = { ...en.transition } as Record<string, unknown>;
    delete missing.retry;
    expect(() => validateTransitionLabels(missing)).toThrow("Invalid transition label: retry");
  });

  it("UT-037 maps arbitrary errors and framework digests to one generic key", () => {
    const values: unknown[] = [
      new Error("database password leaked"),
      { digest: "NEXT_REDIRECT;secret", message: "token" },
      Symbol("private"),
      new Proxy({}, { get: () => { throw new Error("hostile"); } }),
    ];
    for (const value of values) {
      expect(toPublicNavigationError(value)).toBe("transition.failedBody");
    }
  });
});
