"use client";

import { unstable_rethrow } from "next/navigation";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  DEFAULT_LOCALE,
  dictionary,
  isLocale,
  type LocaleId,
} from "../src/core/i18n/index.ts";
import { transitionStore } from "../src/core/pwa/transition-store.ts";

function currentDocumentLocale(): LocaleId {
  const locale = document.documentElement.lang;
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

function subscribeToDocumentLocale(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  return () => observer.disconnect();
}

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  unstable_rethrow(error);

  const locale = useSyncExternalStore(
    subscribeToDocumentLocale,
    currentDocumentLocale,
    () => DEFAULT_LOCALE,
  );
  const labels = dictionary(locale).transition;

  useEffect(() => {
    transitionStore.failRoute();
  }, []);

  const retry = useCallback(() => {
    transitionStore.reset();
    reset();
  }, [reset]);

  return (
    <main className="navigation-route-error" data-testid="navigation-route-error">
      <section className="navigation-route-error__panel" aria-labelledby="navigation-route-error-title">
        <div role="status" aria-live="polite" aria-atomic="true">
          <h1 id="navigation-route-error-title" className="type-display-sm">
            {labels.failedTitle}
          </h1>
          <p className="type-body-md text-muted-foreground">{labels.failedBody}</p>
        </div>
        <button
          type="button"
          className="navigation-route-error__retry type-button-md"
          data-testid="navigation-route-error-retry"
          onClick={retry}
        >
          {labels.retry}
        </button>
      </section>
    </main>
  );
}
