import { existsSync, readFileSync } from "node:fs";
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
  it("supplements real-router coalescing with a focused adapter boundary", () => {
    vi.stubGlobal("window", { location: { href: "https://jobs.example/jobs" } });
    const subscriber = vi.fn();
    const unsubscribe = shared.store!.subscribe(subscriber);
    const generationBefore = shared.store!.getSnapshot().generation;
    const element = TransitionLink({ href: "/pipeline", children: "Pipeline" }) as ReactElement<{
      onNavigate: (event: { preventDefault(): void }) => void;
    }>;

    element.props.onNavigate({ preventDefault: vi.fn() });
    onRouterTransitionStart("/pipeline", "push");

    expect(shared.store!.getSnapshot()).toMatchObject({
      generation: generationBefore + 1,
      phase: "loading",
      target: "/pipeline",
    });
    expect(subscriber).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("coalesces the decorated Link target used by Next", () => {
    vi.stubGlobal("window", { location: { href: "https://jobs.example/jobs" } });
    const subscriber = vi.fn();
    const unsubscribe = shared.store!.subscribe(subscriber);
    const generationBefore = shared.store!.getSnapshot().generation;
    const element = TransitionLink({
      href: "/jobs/[id]",
      as: "/pipeline",
      children: "Pipeline",
    }) as ReactElement<{
      as: string;
      onNavigate: (event: { preventDefault(): void }) => void;
    }>;

    expect(element.props.as).toBe("/pipeline");
    element.props.onNavigate({ preventDefault: vi.fn() });
    onRouterTransitionStart("/pipeline", "push");

    expect(shared.store!.getSnapshot()).toMatchObject({
      generation: generationBefore + 1,
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
      expect(element.props).toMatchObject(props);
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
    let formDataConstructions = 0;
    type FormDataListener = (event: { formData: FormDataFixture }) => void;
    class FormTarget {
      readonly listeners = new Map<FormDataListener, boolean>();
      addEventListener(type: string, listener: FormDataListener, options?: { once?: boolean }) {
        if (type === "formdata") this.listeners.set(listener, options?.once === true);
      }
      removeEventListener(type: string, listener: FormDataListener) {
        if (type === "formdata") this.listeners.delete(listener);
      }
      dispatchFormData(formData: FormDataFixture) {
        for (const [listener, once] of [...this.listeners]) {
          listener({ formData });
          if (once) this.listeners.delete(listener);
        }
      }
    }
    class FormDataFixture {
      constructor(form?: FormTarget) {
        formDataConstructions += 1;
        form?.dispatchFormData(this);
      }
      [Symbol.iterator]() {
        return formEntries[Symbol.iterator]();
      }
    }
    vi.stubGlobal("FormData", FormDataFixture);

    type FormSubmitEvent = {
      defaultPrevented: boolean;
      currentTarget: FormTarget;
      nativeEvent: { submitter: Submitter | null };
      preventDefault(): void;
    };
    const eventFor = (attributes: Record<string, string> = {}): FormSubmitEvent => {
      const event = {
        defaultPrevented: false,
        currentTarget: new FormTarget(),
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

    const emptyAction = eventFor({ formaction: "" });
    form({ action: "/pipeline" }).props.onSubmit(emptyAction);
    new FormDataFixture(emptyAction.currentTarget);
    expect(shared.store!.getSnapshot().phase).toBe("idle");

    formEntries = [["q", "adapter target"]];
    const accepted = eventFor();
    accepted.nativeEvent.submitter = null;
    form().props.onSubmit(accepted);
    new FormDataFixture(accepted.currentTarget);
    expect(shared.store!.getSnapshot()).toMatchObject({
      phase: "loading",
      target: "/jobs?q=adapter+target",
    });
    expect(formDataConstructions).toBe(2);
  });

  it("replaces an action query using the FormData constructed by Next", () => {
    vi.stubGlobal("window", { location: { href: "https://jobs.example/jobs" } });
    vi.stubGlobal("HTMLElement", class ElementFixture {});

    const listeners = new Set<(event: { formData: FormData }) => void>();
    const form = {
      addEventListener(type: string, listener: (event: { formData: FormData }) => void) {
        if (type === "formdata") listeners.add(listener);
      },
      removeEventListener(type: string, listener: (event: { formData: FormData }) => void) {
        if (type === "formdata") listeners.delete(listener);
      },
    };
    const formData = new FormData();
    formData.append("q", "replacement");
    const element = TransitionGetForm({
      action: "/jobs?stale=1" as never,
      children: null,
    }) as ReactElement<{
      onSubmit: (event: {
        defaultPrevented: boolean;
        currentTarget: typeof form;
        nativeEvent: { submitter: null };
      }) => void;
    }>;
    const subscriber = vi.fn();
    const unsubscribe = shared.store!.subscribe(subscriber);
    const generationBefore = shared.store!.getSnapshot().generation;

    element.props.onSubmit({
      defaultPrevented: false,
      currentTarget: form,
      nativeEvent: { submitter: null },
    });
    for (const listener of [...listeners]) listener({ formData });
    onRouterTransitionStart("/jobs?q=replacement", "push");

    expect(shared.store!.getSnapshot()).toMatchObject({
      generation: generationBefore + 1,
      phase: "loading",
      target: "/jobs?q=replacement",
    });
    expect(subscriber).toHaveBeenCalledTimes(1);
    unsubscribe();
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

  it("uses UrlObject query when search is explicitly empty", () => {
    vi.stubGlobal("window", { location: { href: "https://jobs.example/jobs" } });
    const element = TransitionLink({
      href: {
        pathname: "/pipeline",
        search: "",
        query: { view: "compact" },
      },
      children: "Pipeline",
    }) as ReactElement<{ onNavigate: (event: { preventDefault(): void }) => void }>;

    element.props.onNavigate({ preventDefault: vi.fn() });

    expect(shared.store!.getSnapshot()).toMatchObject({
      phase: "loading",
      target: "/pipeline?view=compact",
    });
  });

  it("supplements redirect integration with source and store invariants", () => {
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
      expect(source, file).toMatch(
        new RegExp(`(?:<form|<MutationFeedbackForm)[\\s\\S]*action=\\{${action}\\}`),
      );
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

  it("supplements auth integration with canonical source invariants", () => {
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
    expect(existsSync("app/loading.tsx")).toBe(false);
  });

  it("supplements entity integration with canonical source invariants", () => {
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
