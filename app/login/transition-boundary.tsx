"use client";

import { useLayoutEffect, useRef } from "react";
import { transitionStore } from "../../src/core/pwa/transition-store.ts";

/**
 * Um redirecionamento de autenticação pode terminar em `/login` sem fazer o
 * commit do destino que iniciou a transição. A página de login é a fronteira
 * efetiva, então libera somente a geração capturada durante a montagem.
 */
export function LoginTransitionBoundary() {
  const generation = useRef<number | null | undefined>(undefined);
  if (generation.current === undefined) {
    const snapshot = transitionStore.getSnapshot();
    generation.current = snapshot.phase === "idle" ? null : snapshot.generation;
  }

  useLayoutEffect(() => {
    if (generation.current !== null && generation.current !== undefined) {
      transitionStore.reset(generation.current);
    }
  }, []);

  return null;
}
