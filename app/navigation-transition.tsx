"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import {
  INITIAL_NAVIGATION_TRANSITION,
  type TransitionLabels,
  type TransitionPhase,
} from "../src/core/pwa/transition.ts";
import { transitionStore } from "../src/core/pwa/transition-store.ts";
import {
  SPLASH_BRAND_CLASS,
  SPLASH_ICON_CLASS,
  SPLASH_ICON_SIZE,
  SPLASH_ICON_SRC,
  SPLASH_NAME_CLASS,
  SPLASH_PRODUCT_NAME,
  SPLASH_PROGRESS_CLASS,
  TRANSITION_SPLASH_ROOT_ID,
} from "../src/core/pwa/splash.ts";

function NavigationCommitObserver() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const routeKey = search ? `${pathname}?${search}` : pathname;

  useEffect(() => {
    transitionStore.commit(routeKey);
  }, [routeKey]);

  return null;
}

function useApplicationShellState(active: boolean): void {
  useLayoutEffect(() => {
    const shell = document.getElementById("application-shell");
    if (!shell) return;

    if (active) {
      shell.setAttribute("inert", "");
      shell.setAttribute("aria-busy", "true");
    } else {
      shell.removeAttribute("inert");
      shell.removeAttribute("aria-busy");
    }

    return () => {
      shell.removeAttribute("inert");
      shell.removeAttribute("aria-busy");
    };
  }, [active]);
}

function SplashBrand() {
  return (
    <>
      <div className={SPLASH_BRAND_CLASS} aria-hidden="true">
        <img
          className={SPLASH_ICON_CLASS}
          src={SPLASH_ICON_SRC}
          alt=""
          width={SPLASH_ICON_SIZE}
          height={SPLASH_ICON_SIZE}
          decoding="async"
        />
        <span className={SPLASH_NAME_CLASS}>{SPLASH_PRODUCT_NAME}</span>
      </div>
      <div className={SPLASH_PROGRESS_CLASS} aria-hidden="true">
        <span />
      </div>
    </>
  );
}

function TransitionStatus({ phase, labels }: { phase: TransitionPhase; labels: TransitionLabels }) {
  if (phase === "leaving") return null;

  if (phase === "offline") {
    return (
      <div className="navigation-transition__status" role="status" aria-live="polite" aria-atomic="true">
        <h2 className="type-display-xs">{labels.offlineTitle}</h2>
        <p className="type-body-md">{labels.offlineBody}</p>
      </div>
    );
  }

  return (
    <p
      className="navigation-transition__status type-body-md"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {phase === "prolonged" ? labels.prolonged : labels.loading}
    </p>
  );
}

export function NavigationTransition({ labels }: { labels: TransitionLabels }) {
  const snapshot = useSyncExternalStore(
    transitionStore.subscribe,
    transitionStore.getSnapshot,
    () => INITIAL_NAVIGATION_TRANSITION,
  );
  const active = snapshot.phase !== "idle";
  useApplicationShellState(active);

  return (
    <>
      <Suspense fallback={null}>
        <NavigationCommitObserver />
      </Suspense>
      {active ? (
        <div
          id={TRANSITION_SPLASH_ROOT_ID}
          className="navigation-transition"
          data-testid="navigation-transition"
          data-phase={snapshot.phase}
          data-generation={snapshot.generation}
        >
          <div className="navigation-transition__content">
            <SplashBrand />
            <TransitionStatus phase={snapshot.phase} labels={labels} />
            {snapshot.phase === "offline" ? (
              <button
                type="button"
                className="navigation-transition__retry type-button-md"
                data-testid="navigation-transition-retry"
                onClick={() => transitionStore.retry()}
              >
                {labels.retry}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
