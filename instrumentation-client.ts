import { transitionStore } from "./src/core/pwa/transition-store.ts";

type RouterTransitionType = "push" | "replace" | "traverse";

const ROUTER_TRANSITION_TYPES = new Set<RouterTransitionType>([
  "push",
  "replace",
  "traverse",
]);

/** Next.js invokes this synchronously before an App Router navigation starts. */
export function onRouterTransitionStart(url: string, navigationType: RouterTransitionType): void {
  try {
    if (!ROUTER_TRANSITION_TYPES.has(navigationType)) return;
    transitionStore.begin(url);
  } catch {
    // Instrumentation must never make the navigation itself fail.
  }
}
