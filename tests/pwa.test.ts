import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { en } from "../src/core/i18n/en.ts";
import { ptBR } from "../src/core/i18n/pt-BR.ts";
import {
  OFFLINE_EDITIONS,
  escapeOfflineText,
  renderOfflineDocument,
  type OfflineEditions,
} from "../src/core/pwa/offline.ts";
import { generatePwaArtifacts } from "../scripts/sw-version.mjs";

const template = readFileSync("scripts/sw-template.js", "utf8");
const manifest = JSON.parse(readFileSync("public/manifest.json", "utf8"));

describe("real-browser PWA gate wiring", () => {
  it("runs the privacy boundary explicitly after installing its pinned Chromium", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

    expect(packageJson.scripts?.["test:pwa-browser"]).toBe(
      "JHO_PWA_BROWSER_TESTS=1 vitest run tests/pwa-chrome.test.ts",
    );
    expect(readFileSync("tests/pwa-chrome.test.ts", "utf8")).toContain(
      'process.env.npm_lifecycle_event === "test:pwa-browser"',
    );
    expect(workflow).toMatch(
      /pnpm exec playwright install --with-deps chromium[\s\S]+pnpm test:pwa-browser/,
    );
  });
});

type StoredResponse = { request: Request; response: Response };

function memoryCaches(initialNames: string[] = []) {
  const stores = new Map<string, Map<string, StoredResponse>>(
    initialNames.map((name) => [name, new Map()]),
  );
  let rejectOpen = false;
  let rejectPut = false;

  const api = {
    async open(name: string) {
      if (rejectOpen) throw new DOMException("refused", "QuotaExceededError");
      let store = stores.get(name);
      if (!store) {
        store = new Map();
        stores.set(name, store);
      }
      return {
        async match(request: Request | string) {
          const url = typeof request === "string"
            ? new URL(request, "https://jobs.example").href
            : request.url;
          return store?.get(url)?.response.clone();
        },
        async put(request: Request, response: Response) {
          if (rejectPut) throw new DOMException("full", "QuotaExceededError");
          store?.set(request.url, { request, response });
        },
      };
    },
    async match(request: Request | string) {
      const url = typeof request === "string"
        ? new URL(request, "https://jobs.example").href
        : request.url;
      for (const store of stores.values()) {
        const hit = store.get(url);
        if (hit) return hit.response.clone();
      }
      return undefined;
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name: string) {
      return stores.delete(name);
    },
  };

  return {
    api,
    stores,
    refuseOpen() {
      rejectOpen = true;
    },
    refusePut() {
      rejectPut = true;
    },
  };
}

function workerHarness(options: {
  cacheNames?: string[];
  fetch?: (request: Request) => Promise<Response>;
} = {}) {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const storage = memoryCaches(options.cacheNames);
  const clients = {
    claim: async () => undefined,
    get: async () => null,
  };
  const self = {
    location: new URL("https://jobs.example/sw.js"),
    addEventListener(type: string, listener: (event: Record<string, unknown>) => void) {
      listeners.set(type, listener);
    },
    skipWaiting: async () => undefined,
    clients,
  };
  const fetchImpl = options.fetch ?? (async (request: Request) => {
    if (new URL(request.url).pathname === "/offline.html") {
      return new Response(renderOfflineDocument(), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return new Response("public", { headers: { "content-type": "application/octet-stream" } });
  });
  const context = vm.createContext({
    self,
    caches: storage.api,
    fetch: fetchImpl,
    URL,
    Request,
    Response,
    DOMException,
    Set,
    Promise,
  });
  vm.runInContext(template, context);

  async function lifecycle(type: "install" | "activate") {
    let work: Promise<unknown> | undefined;
    listeners.get(type)?.({
      waitUntil(value: Promise<unknown>) {
        work = value;
      },
    });
    await work;
  }

  return {
    context,
    storage,
    clients,
    listeners,
    lifecycle,
    evaluate<T>(source: string): T {
      return vm.runInContext(source, context) as T;
    },
  };
}

describe("offline document renderer", () => {
  it("UT-021 renders the exact typed pt-BR edition as the default", () => {
    const html = renderOfflineDocument();
    expect(html).toContain('<html lang="pt-BR">');
    expect(html).toContain('data-offline-locale="pt-BR" lang="pt-BR">');
    for (const value of Object.values(OFFLINE_EDITIONS["pt-BR"])) {
      expect(html).toContain(escapeOfflineText(value));
    }
  });

  it("UT-022 embeds the exact typed English edition and locale selection", () => {
    const html = renderOfflineDocument();
    expect(html).toContain('data-offline-locale="en" lang="en" hidden');
    expect(html).toContain("navigator.languages");
    expect(html).toContain("jho_locale");
    for (const value of Object.values(OFFLINE_EDITIONS.en)) {
      expect(html).toContain(escapeOfflineText(value));
    }
  });

  it("UT-023 escapes hostile translated values as inert text", () => {
    const hostile = `<script data-x="'&"></script></style><img src=x onerror=alert(1)>`;
    const editions: OfflineEditions = {
      "pt-BR": { title: hostile, body: hostile, retry: hostile },
      en: { title: hostile, body: hostile, retry: hostile },
    };
    const html = renderOfflineDocument(editions);

    expect(html).not.toContain(hostile);
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("</style><img");
    expect(html).toContain("&lt;script data-x=&quot;&#39;&amp;&quot;&gt;");
  });

  it("UT-024 has no route, session, candidate, CV, salary, token, or profile marker", () => {
    const generated = `${renderOfflineDocument()}${JSON.stringify(ptBR.transition)}${JSON.stringify(en.transition)}`;
    const privateMarkers = [
      "private@example.test",
      "CANDIDATE_PRIVATE_NAME",
      "CV_PRIVATE_MARKER",
      "JOB_DESCRIPTION_PRIVATE_MARKER",
      "SALARY_PRIVATE_MARKER",
      "APPLICATION_PRIVATE_ID",
      "RESET_TOKEN_PRIVATE_MARKER",
      "PUBLIC_PROFILE_REVOCABLE_MARKER",
    ];
    for (const marker of privateMarkers) expect(generated).not.toContain(marker);
    expect(generated).not.toContain("__next_f.push");
    expect(generated).not.toContain("/_next/");
  });
});

describe("deny-by-default worker policy", () => {
  it("UT-025 admits only the declared public allowlist and framework statics", () => {
    const fixture = workerHarness();
    for (const path of [
      "/manifest.json",
      "/icons/icon-192.png",
      "/icons/icon-512.png",
      "/icons/icon-maskable-512.png",
      "/_next/static/chunk.js",
    ]) {
      expect(fixture.evaluate<boolean>(`isCacheableStatic(new URL(${JSON.stringify(path)}, self.location.origin))`)).toBe(true);
    }
    for (const path of ["/jobs.json", "/api/data.json", "https://other.example/icon.png"]) {
      expect(fixture.evaluate<boolean>(`isCacheableStatic(new URL(${JSON.stringify(path)}, self.location.origin))`)).toBe(false);
    }
    expect(template).not.toContain("STATIC_EXTENSIONS");
  });

  it("UT-026 denies every private, revocable, router, and unknown surface", () => {
    const fixture = workerHarness();
    const paths = [
      "/login",
      "/p/slug",
      "/admin/users",
      "/candidate",
      "/pipeline",
      "/referrals",
      "/compare",
      "/jobs/1",
      "/applications/1",
      "/salary",
      "/resume",
      "/api/export",
      "/unknown-authenticated-route",
    ];
    for (const path of paths) {
      expect(fixture.evaluate<boolean>(`isCacheableStatic(new URL(${JSON.stringify(path)}, self.location.origin))`)).toBe(false);
    }
    const staticStart = template.indexOf("const PRECACHE_STATIC");
    const staticEnd = template.indexOf("];", staticStart) + 2;
    const staticPrecache = template.slice(staticStart, staticEnd);
    expect(template).not.toContain("const PRECACHE_SHELL");
    expect(staticPrecache).not.toContain('"/login"');
    expect(template).not.toContain('"/offline"');
  });

  it("UT-027 retires zero, one, or many obsolete versions and preserves current caches", async () => {
    for (const obsolete of [[], ["shell-old"], ["shell-old", "static-old", "pages-danger", "api-danger"]]) {
      const current = ["static-__APP_VERSION__", "shell-__APP_VERSION__"];
      const fixture = workerHarness({ cacheNames: [...current, ...obsolete] });
      await fixture.lifecycle("activate");
      expect(await fixture.storage.api.keys()).toEqual(current);
    }
  });

  it("reads fallback only from the current shell generation", async () => {
    const fixture = workerHarness({ cacheNames: ["shell-old"] });
    const old = await fixture.storage.api.open("shell-old");
    await old.put(
      new Request("https://jobs.example/offline.html", { credentials: "omit" }),
      new Response("PRIVATE_OLD_SHELL", { headers: { "content-type": "text/html" } }),
    );

    const fallback = await fixture.evaluate<Promise<Response>>("offlineResponse()");

    expect(fallback.status).toBe(503);
    expect(await fallback.text()).toBe("Offline.");
  });

  it("UT-028 settles install and returns only plain 503 on missing/refused/quota shell", async () => {
    const missing = workerHarness({
      fetch: async () => new Response("missing", { status: 404 }),
    });
    await expect(missing.lifecycle("install")).resolves.toBeUndefined();
    const missingFallback = await missing.evaluate<Promise<Response>>("offlineResponse()");
    expect(missingFallback.status).toBe(503);
    expect(missingFallback.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await missingFallback.text()).toBe("Offline.");

    for (const refusal of ["open", "put"] as const) {
      const fixture = workerHarness();
      if (refusal === "open") fixture.storage.refuseOpen();
      else fixture.storage.refusePut();
      await expect(fixture.lifecycle("install")).resolves.toBeUndefined();
      const fallback = await fixture.evaluate<Promise<Response>>("offlineResponse()");
      expect(fallback.status).toBe(503);
      expect(await fallback.text()).toBe("Offline.");
    }
  });

  it("UT-036 never stores redirected, non-OK, or router-payload responses", async () => {
    const redirected = new Response("redirected", { headers: { "content-type": "text/html" } });
    Object.defineProperty(redirected, "redirected", { value: true });
    const cases = [
      redirected,
      new Response("error", { status: 500, headers: { "content-type": "text/html" } }),
      new Response("router", { headers: { "content-type": "text/x-component" } }),
    ];

    for (const hostile of cases) {
      const fixture = workerHarness({
        fetch: async (request) => new URL(request.url).pathname === "/offline.html"
          ? hostile
          : new Response("public"),
      });
      await fixture.lifecycle("install");
      const shell = fixture.storage.stores.get("shell-__APP_VERSION__");
      expect(shell?.size ?? 0).toBe(0);
    }
  });
});

describe("deterministic generation and manifest", () => {
  it("UT-034 is byte-identical for one revision and keeps offline HTML revision-independent", () => {
    const first = mkdtempSync(join(tmpdir(), "jho-pwa-first-"));
    const second = mkdtempSync(join(tmpdir(), "jho-pwa-second-"));
    const changed = mkdtempSync(join(tmpdir(), "jho-pwa-changed-"));
    try {
      const a = generatePwaArtifacts({ revision: "abc1234", outputDirectory: first });
      const b = generatePwaArtifacts({ revision: "abc1234", outputDirectory: second });
      const c = generatePwaArtifacts({ revision: "def5678", outputDirectory: changed });
      expect(a.worker).toBe(b.worker);
      expect(a.offline).toBe(b.offline);
      expect(c.worker).not.toBe(a.worker);
      expect(c.offline).toBe(a.offline);
      expect(c.worker.replaceAll("def5678", "abc1234")).toBe(a.worker);
    } finally {
      rmSync(first, { recursive: true, force: true });
      rmSync(second, { recursive: true, force: true });
      rmSync(changed, { recursive: true, force: true });
    }
  });

  it("keeps the served worker versioned and both derived artifacts generated", () => {
    const generated = generatePwaArtifacts({ revision: "testrev" });
    expect(generated.worker).not.toContain("__APP_VERSION__");
    expect(generated.marker).toMatch(/^\d+\.\d+\.\d+\+testrev$/);
    expect(readFileSync("public/offline.html", "utf8")).toBe(generated.offline);
  });

  it("keeps an installable root-scoped manifest", () => {
    expect(manifest.display).toBe("standalone");
    expect(manifest.scope).toBe("/");
    expect(manifest.start_url).toBe("/");
    const purposes = manifest.icons.map((icon: { purpose: string }) => icon.purpose);
    expect(purposes).toContain("maskable");
    expect(purposes).toContain("any");
    const sizes = new Set(manifest.icons.map((icon: { sizes: string }) => icon.sizes));
    expect(sizes.has("192x192")).toBe(true);
    expect(sizes.has("512x512")).toBe(true);
  });
});
