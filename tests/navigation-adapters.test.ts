import { readFileSync } from "node:fs";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TransitionStore } from "../src/core/pwa/transition-store.ts";

const shared = vi.hoisted(() => ({ store: null as TransitionStore | null }));

vi.mock("../src/core/pwa/transition-store.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/core/pwa/transition-store.ts")>();
  const store = actual.createTransitionStore({
    currentUrl: () => "https://jobs.example/jobs",
    connectivity: null,
    serviceWorker: null,
  });
  shared.store = store;
  return { ...actual, transitionStore: store };
});

import { onRouterTransitionStart } from "../instrumentation-client.ts";
import { TransitionGetForm } from "../app/transition-get-form.tsx";
import { TransitionLink } from "../app/transition-link.tsx";

afterEach(() => {
  shared.store?.reset();
  vi.unstubAllGlobals();
});

describe("stable navigation adapters", () => {
  it("IT-002 coalesces the real TransitionLink fallback with the router hook", () => {
    vi.stubGlobal("window", { location: { href: "https://jobs.example/jobs" } });
    const subscriber = vi.fn();
    const unsubscribe = shared.store!.subscribe(subscriber);
    const element = TransitionLink({ href: "/pipeline", children: "Pipeline" }) as ReactElement<{
      onNavigate: (event: { preventDefault(): void }) => void;
    }>;

    element.props.onNavigate({ preventDefault: vi.fn() });
    onRouterTransitionStart("/pipeline", "push");

    expect(shared.store!.getSnapshot()).toMatchObject({
      generation: 1,
      phase: "loading",
      target: "/pipeline",
    });
    expect(subscriber).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("UT-035 preserves native exclusions through both real adapters", () => {
    vi.stubGlobal("window", { location: { href: "https://jobs.example/jobs" } });

    for (const props of [{ target: "_blank" }, { download: "jobs.csv" }]) {
      const element = TransitionLink({ href: "/pipeline", children: "Pipeline", ...props }) as ReactElement<{
        onNavigate: (event: { preventDefault(): void }) => void;
      }>;
      element.props.onNavigate({ preventDefault: vi.fn() });
      expect(shared.store!.getSnapshot().phase).toBe("idle");
    }

    const preventedLink = TransitionLink({
      href: "/pipeline",
      children: "Pipeline",
      onNavigate: (event) => event.preventDefault(),
    }) as ReactElement<{ onNavigate: (event: { preventDefault(): void }) => void }>;
    const preventLink = vi.fn();
    preventedLink.props.onNavigate({ preventDefault: preventLink });
    expect(preventLink).toHaveBeenCalledOnce();
    expect(shared.store!.getSnapshot().phase).toBe("idle");

    class Submitter {
      readonly attributes: Record<string, string>;
      constructor(attributes: Record<string, string>) {
        this.attributes = attributes;
      }
      getAttribute(name: string): string | null {
        return this.attributes[name] ?? null;
      }
    }
    vi.stubGlobal("HTMLElement", Submitter);
    let formEntries: Array<[string, string]> = [];
    class FormDataFixture {
      constructor(_form: unknown) {}
      [Symbol.iterator]() {
        return formEntries[Symbol.iterator]();
      }
    }
    vi.stubGlobal("FormData", FormDataFixture);

    type FormSubmitEvent = {
      defaultPrevented: boolean;
      currentTarget: object;
      nativeEvent: { submitter: Submitter | null };
      preventDefault(): void;
    };
    const eventFor = (attributes: Record<string, string> = {}): FormSubmitEvent => {
      const event = {
        defaultPrevented: false,
        currentTarget: {},
        nativeEvent: { submitter: new Submitter(attributes) },
        preventDefault() {
          event.defaultPrevented = true;
        },
      };
      return event;
    };
    const form = (props: { action?: string; onSubmit?: (event: FormSubmitEvent) => void } = {}) =>
      TransitionGetForm({
        action: (props.action ?? "/jobs") as never,
        children: null,
        onSubmit: props.onSubmit as never,
      }) as ReactElement<{
        onSubmit: (event: FormSubmitEvent) => void;
      }>;

    const nativeExclusions: Array<Record<string, string>> = [
      { formtarget: "_blank" },
      { formmethod: "post" },
      { formenctype: "multipart/form-data" },
    ];
    for (const attributes of nativeExclusions) {
      form().props.onSubmit(eventFor(attributes));
      expect(shared.store!.getSnapshot().phase).toBe("idle");
    }

    const prevented = eventFor();
    form({ onSubmit: (event) => event.preventDefault() }).props.onSubmit(prevented);
    expect(prevented.defaultPrevented).toBe(true);
    expect(shared.store!.getSnapshot().phase).toBe("idle");

    form({ action: "/pipeline" }).props.onSubmit(eventFor({ formaction: "" }));
    expect(shared.store!.getSnapshot().phase).toBe("idle");

    formEntries = [["q", "adapter target"]];
    const accepted = eventFor();
    accepted.nativeEvent.submitter = null;
    form().props.onSubmit(accepted);
    expect(shared.store!.getSnapshot()).toMatchObject({
      phase: "loading",
      target: "/jobs?q=adapter+target",
    });
  });

  it("serializes UrlObject fallback targets in parity with Next Link", () => {
    vi.stubGlobal("window", { location: { href: "https://jobs.example/jobs" } });
    const element = TransitionLink({
      href: {
        protocol: "https",
        hostname: "jobs.example",
        pathname: "/pipeline?active",
        query: { view: ["compact", "full"], empty: undefined, limit: Infinity },
        hash: "details",
      },
      children: "Pipeline",
    }) as ReactElement<{ onNavigate: (event: { preventDefault(): void }) => void }>;

    element.props.onNavigate({ preventDefault: vi.fn() });

    expect(shared.store!.getSnapshot()).toMatchObject({
      phase: "loading",
      target: "/pipeline%3Factive?empty=&limit=Infinity&view=compact&view=full",
    });
  });

  it("IT-012 keeps redirecting POST actions ordinary and mutation work one-shot", () => {
    const actionSurfaces = [
      ["app/login/page.tsx", "passwordLoginAction"],
      ["app/login/forgot/page.tsx", "requestResetAction"],
      ["app/login/reset/page.tsx", "submitResetAction"],
      ["app/jobs/new/page.tsx", "createRecruiterJobAction"],
      ["app/compare/form.tsx", "formAction"],
      ["app/admin/users/page.tsx", "impersonateAction"],
    ] as const;

    for (const [file, action] of actionSurfaces) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain(`<form action={${action}}`);
      expect(source, file).not.toContain("TransitionGetForm");
    }

    const observer = readFileSync("app/navigation-transition.tsx", "utf8");
    expect(observer).toContain("previousRoute.current = routeKey");
    expect(observer).toContain("transitionStore.begin(routeKey, previousUrl)");
    expect(observer).toContain('snapshot.phase !== "idle" && !snapshot.committed');
    expect(observer).not.toContain("previous === routeKey || transitionStore.getSnapshot()");

    const generationBeforeRedirect = shared.store!.getSnapshot().generation;
    const acceptedRedirect = () => {
      shared.store!.begin("/compare?job=1", "https://jobs.example/jobs");
    };
    acceptedRedirect();
    shared.store!.begin("/compare?job=1", "https://jobs.example/jobs");

    expect(shared.store!.getSnapshot()).toMatchObject({
      generation: generationBeforeRedirect + 1,
      target: "/compare?job=1",
    });
  });

  it("IT-013 preserves canonical auth, role, token, and impersonation outcomes", () => {
    const auth = readFileSync("app/auth.ts", "utf8");
    const reset = readFileSync("app/login/reset/actions.ts", "utf8");
    const callback = readFileSync("app/login/callback/route.ts", "utf8");
    const impersonation = readFileSync("app/admin/actions.ts", "utf8");
    const overlay = readFileSync("app/navigation-transition.tsx", "utf8");

    expect(auth).toContain('if (!session) redirect("/login")');
    expect(auth).toContain("if (error instanceof AuthorizationError) forbidden()");
    expect(reset).toContain('redirect("/login?reset=1")');
    expect(reset).toContain("encodeURIComponent(token)");
    expect(callback).toContain('new URL("/login?error=invalid", request.url)');
    expect(impersonation).toContain('if (adminToken) redirect("/admin/users")');
    expect(impersonation).toContain('redirect("/login")');
    expect(overlay).not.toMatch(/email|candidateName|token|protectedDestination/);
  });

  it("IT-014 preserves missing, closed, and revoked entity outcomes without cache fallback", () => {
    const job = readFileSync("app/jobs/[id]/page.tsx", "utf8");
    const profile = readFileSync("app/p/[slug]/page.tsx", "utf8");
    const candidate = readFileSync("app/candidate/page.tsx", "utf8");
    const worker = readFileSync("scripts/sw-template.js", "utf8");

    expect(job).toContain("if (!detail) notFound()");
    expect(job).toContain("job.closedAt");
    expect(profile).toContain("if (!profile) notFound()");
    expect(candidate).toMatch(/href=\{`\/p\/\$\{slug\}`\}[\s\S]*?prefetch=\{false\}/);
    expect(worker).toContain('"/p/"');
    expect(worker).toContain('"/jobs"');
    expect(worker).not.toMatch(/cache\.put\([^\n]*(?:\/p\/|\/jobs)/);
  });
});
