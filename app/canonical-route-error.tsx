"use client";

import { useEffect } from "react";
import { transitionStore } from "../src/core/pwa/transition-store.ts";
import { TransitionLink } from "./transition-link.tsx";

type CanonicalRouteErrorKind = "forbidden" | "not-found";

export function CanonicalRouteError({
  kind,
  title,
  body,
  back,
}: {
  kind: CanonicalRouteErrorKind;
  title: string;
  body: string;
  back: string;
}) {
  const forbidden = kind === "forbidden";

  useEffect(() => {
    transitionStore.failRoute();
  }, []);

  return (
    <main
      className="navigation-route-error"
      data-testid={forbidden ? "route-forbidden" : "route-not-found"}
    >
      <section className="navigation-route-error__panel" aria-labelledby="canonical-route-error-title">
        <div role="status" aria-live="polite" aria-atomic="true">
          <h1 id="canonical-route-error-title" className="type-display-sm">
            {title}
          </h1>
          <p className="type-body-md text-muted-foreground">{body}</p>
        </div>
        <TransitionLink
          href="/"
          className="navigation-route-error__retry type-button-md"
          data-testid="route-status-back"
        >
          {back}
        </TransitionLink>
      </section>
    </main>
  );
}
