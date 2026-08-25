"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
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
  SPLASH_REFERENCE_KEY,
  SPLASH_ROOT_ID,
  TRANSITION_SPLASH_ROOT_ID,
  removeInertSplashDuplicates,
} from "../src/core/pwa/splash.ts";

function NavigationCommitObserver() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const routeKey = search ? `${pathname}?${search}` : pathname;
  const previousRoute = useRef(routeKey);

  useLayoutEffect(() => {
    const registeredSplash = (window as Window & {
      [SPLASH_REFERENCE_KEY]?: HTMLElement | null;
    })[SPLASH_REFERENCE_KEY];

    // Canonical 403/404 documents can carry the root layout inside Flight.
    // React inserts that HTML, but does not execute its inline removal script.
    // Keep the parser-owned startup splash and remove every inert duplicate.
    // Duplicate ids are invalid but can coexist briefly while Flight commits.
    removeInertSplashDuplicates(
      document.querySelectorAll<HTMLElement>(`#${SPLASH_ROOT_ID}`),
      registeredSplash,
    );

    const previous = previousRoute.current;
    previousRoute.current = routeKey;
    const snapshot = transitionStore.getSnapshot();
    if (previous === routeKey || (snapshot.phase !== "idle" && !snapshot.committed)) return;

    // Next 16.3's public router hook does not run for a redirect already
    // accepted inside the Server Action reducer. Detect that committed route
    // before paint, using the previous screen only for classification. The
    // action itself remains an ordinary one-shot POST and is never wrapped or
    // retried by this lifecycle. A committed generation may yield ownership to
    // a rapid history traversal, while a stale commit must not replace a newer
    // target that is still pending. begin coalesces the ordinary Link case.
    const previousUrl = new URL(previous, window.location.origin).href;
    transitionStore.begin(routeKey, previousUrl);
  }, [routeKey]);

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
