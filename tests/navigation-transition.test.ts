import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onRouterTransitionStart } from "../instrumentation-client.ts";
import RouteError from "../app/error.tsx";
import { CanonicalRouteError } from "../app/canonical-route-error.tsx";
import { en } from "../src/core/i18n/en.ts";
import { ptBR } from "../src/core/i18n/pt-BR.ts";
import { createTransitionStore } from "../src/core/pwa/transition-store.ts";
import { transitionStore } from "../src/core/pwa/transition-store.ts";

type Timer = { due: number; callback: () => void; cancelled: boolean };

function storeFixture() {
  let now = 0;
  const timers: Timer[] = [];
  const store = createTransitionStore({
    now: () => now,
    currentUrl: () => "https://jobs.example/jobs",
    setTimer(callback, delay) {
      const timer = { due: now + delay, callback, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimer(handle) {
      (handle as Timer).cancelled = true;
    },
    connectivity: null,
    serviceWorker: null,
  });

  return {
    store,
    advance(ms: number) {
      const destination = now + ms;
      while (true) {
        const next = timers
          .filter((timer) => !timer.cancelled && timer.due <= destination)
          .sort((left, right) => left.due - right.due)[0];
        if (!next) break;
        next.cancelled = true;
        now = next.due;
        next.callback();
      }
      now = destination;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  transitionStore.reset();
});

describe("App Router transition integration", () => {
  it("IT-001 forwards push, replace, and traverse through the installed two-argument hook", () => {
    const begin = vi.spyOn(transitionStore, "begin").mockReturnValueOnce(1).mockReturnValueOnce(2).mockReturnValueOnce(3);

    onRouterTransitionStart("/pipeline", "push");
    onRouterTransitionStart("/compare", "replace");
    onRouterTransitionStart("/jobs", "traverse");

    expect(begin.mock.calls).toEqual([["/pipeline"], ["/compare"], ["/jobs"]]);

    const nextPackage = JSON.parse(readFileSync("node_modules/next/package.json", "utf8")) as {
      version: string;
    };
    const docs = readFileSync(
      "node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation-client.md",
      "utf8",
    );
    const runtime = readFileSync(
      "node_modules/next/dist/client/components/router-transition.js",
      "utf8",
    );
    const config = readFileSync("next.config.ts", "utf8");

    expect(nextPackage.version).toBe("16.3.2");
    expect(docs).toContain("url: string,\n  navigationType: 'push' | 'replace' | 'traverse'");
    expect(runtime).toContain("onRouterTransitionStart?.(url, type, null)");
    expect(config).not.toContain("instrumentationClientRouterTransitionEvents");
  });

  it("UT-039 isolates navigation from transition-store instrumentation failures", () => {
    vi.spyOn(transitionStore, "begin").mockImplementation(() => {
      throw new Error("instrumentation unavailable");
    });

    expect(() => onRouterTransitionStart("/pipeline", "push")).not.toThrow();
  });

  it("IT-004 completes a prefetched target without a mounted fallback after 180 ms", () => {
    const fixture = storeFixture();
    fixture.store.begin("/pipeline");
    fixture.store.commit("/pipeline");
    fixture.advance(179);
    expect(fixture.store.getSnapshot().phase).toBe("loading");
    fixture.advance(1);
    expect(fixture.store.getSnapshot().phase).toBe("leaving");
  });

  it("IT-005 releases the overlay to localized operable redacted route error UI", () => {
    const fixture = storeFixture();
    fixture.store.begin("/pipeline");
    fixture.store.failRoute();
    expect(fixture.store.getSnapshot().phase).toBe("idle");

    const rawMessage = "RAW_DATABASE_SECRET";
    const rawDigest = "NEXT_DIGEST_PRIVATE";
    const markup = renderToStaticMarkup(
      createElement(RouteError, {
        error: Object.assign(new Error(rawMessage), { digest: rawDigest }),
        reset: () => undefined,
      }),
    );
    expect(markup).toContain(ptBR.transition.failedTitle);
    expect(markup).toContain(ptBR.transition.failedBody);
    expect(markup).toContain(ptBR.transition.retry);
    expect(markup).toContain('data-testid="navigation-route-error-retry"');
    expect(markup).not.toContain(rawMessage);
    expect(markup).not.toContain(rawDigest);

    const source = readFileSync("app/error.tsx", "utf8");
    expect(source).toContain("transitionStore.failRoute()");
    expect(source).not.toContain("error.message");
    expect(source).not.toContain("error.digest");
  });

  it("releases canonical 403 and 404 interrupts to localized operable UI", () => {
    for (const [kind, testId, title, body] of [
      ["forbidden", "route-forbidden", ptBR.routeStatus.forbiddenTitle, ptBR.routeStatus.forbiddenBody],
      ["not-found", "route-not-found", ptBR.routeStatus.notFoundTitle, ptBR.routeStatus.notFoundBody],
    ] as const) {
      const markup = renderToStaticMarkup(createElement(CanonicalRouteError, {
        kind,
        title,
        body,
        back: ptBR.routeStatus.back,
      }));
      expect(markup).toContain(`data-testid="${testId}"`);
      expect(markup).toContain('data-testid="route-status-back"');
      expect(markup).toContain(title);
      expect(markup).toContain(body);
      expect(markup).toContain(ptBR.routeStatus.back);
    }

    const boundary = readFileSync("app/canonical-route-error.tsx", "utf8");
    expect(boundary).toContain("transitionStore.failRoute()");
    for (const [file, kind] of [
      ["app/forbidden.tsx", "forbidden"],
      ["app/not-found.tsx", "not-found"],
    ] as const) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain(`kind="${kind}"`);
      expect(source).toContain("await getTranslator()");
    }
  });

  it.each([401, 403, 404])(
    "preserves the canonical %s interrupt outside the generic route boundary",
    (status) => {
      const frameworkError = Object.assign(new Error("framework interrupt"), {
        digest: `NEXT_HTTP_ERROR_FALLBACK;${status}`,
      });
      expect(() =>
        renderToStaticMarkup(
          createElement(RouteError, { error: frameworkError, reset: () => undefined }),
        ),
      ).toThrow(frameworkError);
    },
  );

  it("IT-010 keeps startup first and hydrates no transition layer without a router start", () => {
    const layout = readFileSync("app/layout.tsx", "utf8");
    const presenter = readFileSync("app/navigation-transition.tsx", "utf8");
    const startup = layout.indexOf("renderSplashHTML");
    const transition = layout.indexOf("<NavigationTransition");
    const shell = layout.indexOf('id="application-shell"');

    expect(layout.startsWith('"use client"')).toBe(false);
    expect(startup).toBeGreaterThan(-1);
    expect(startup).toBeLessThan(transition);
    expect(transition).toBeLessThan(shell);
    expect(presenter).toContain("snapshot.phase !== \"idle\"");
    expect(presenter).toContain("{active ? (");
    expect(presenter).toContain("startupSplash !== registeredSplash");
    expect(presenter).toContain("startupSplash.remove()");
    expect(layout).toContain("labels={{");
    expect(layout).not.toMatch(/<NavigationTransition[^>]*\b(on\w+|children)=/);
  });

  it("IT-011 keeps theme and dynamic reduced-motion behavior in CSS without state restart", () => {
    const css = readFileSync("app/globals.css", "utf8");
    const presenter = readFileSync("app/navigation-transition.tsx", "utf8");

    expect(css).toContain("background: var(--background)");
    expect(css).toContain("color: var(--foreground)");
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*navigation-transition[\s\S]*animation: none/);
    expect(presenter).not.toContain("matchMedia");
    expect(presenter).toContain("data-generation={snapshot.generation}");
    expect(en.transition.loading).not.toBe(ptBR.transition.loading);
  });
});
