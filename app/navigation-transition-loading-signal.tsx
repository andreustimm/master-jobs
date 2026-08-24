"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { INITIAL_NAVIGATION_TRANSITION } from "../src/core/pwa/transition.ts";
import { transitionStore } from "../src/core/pwa/transition-store.ts";

export function NavigationTransitionLoadingSignal() {
  const generation = useSyncExternalStore(
    transitionStore.subscribe,
    () => transitionStore.getSnapshot().generation,
    () => INITIAL_NAVIGATION_TRANSITION.generation,
  );

  useLayoutEffect(() => transitionStore.mountFallback(generation), [generation]);
  return null;
}
