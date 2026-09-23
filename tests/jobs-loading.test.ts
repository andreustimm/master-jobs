import { existsSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { en } from "../src/core/i18n/en.ts";
import { ptBR } from "../src/core/i18n/pt-BR.ts";
import type { LocaleId } from "../src/core/i18n/index.ts";

const locale = vi.hoisted(() => ({ current: "pt-BR" as LocaleId }));

vi.mock("../app/i18n", async () => {
  const { translator } = await import("../src/core/i18n/index.ts");
  return { getTranslator: async () => translator(locale.current) };
});

const { default: JobsLoading } = await import("../app/jobs/(lista)/loading.tsx");

async function render(id: LocaleId): Promise<string> {
  locale.current = id;
  return renderToStaticMarkup(await JobsLoading());
}

describe("fronteira de carregamento de /jobs", () => {
  it("fica no grupo da lista, e só nele", () => {
    // Em `app/jobs/` ela envolveria `/jobs/<id>`, e o fallback compromete o
    // status em 200 antes de `notFound()` decidir: a vaga inexistente deixaria
    // de ser 404. Em `app/` ela cobriria o produto inteiro.
    expect(existsSync("app/jobs/(lista)/loading.tsx")).toBe(true);
    expect(existsSync("app/jobs/(lista)/page.tsx")).toBe(true);
    expect(existsSync("app/jobs/loading.tsx")).toBe(false);
    expect(existsSync("app/jobs/page.tsx")).toBe(false);
    expect(existsSync("app/loading.tsx")).toBe(false);
    for (const route of ["[id]", "[id]/paises", "new"]) {
      expect(existsSync(`app/jobs/${route}/loading.tsx`), route).toBe(false);
    }
  });

  it.each([
    ["pt-BR", ptBR],
    ["en", en],
  ] as const)("anuncia a espera em %s, com texto do dicionário", async (id, dictionary) => {
    const html = await render(id);
    expect(html).toContain('data-testid="route-jobs-loading"');
    expect(html).toContain(`>${dictionary.jobs.title}</h1>`);
    expect(html).toMatch(/<div aria-busy="true" data-testid="jobs-loading"[^>]*>\s*<p role="status" class="sr-only">/);
    expect(html).toContain(dictionary.jobs.loading);
    // O esqueleto é decorativo e não carrega texto além do título e do aviso.
    const visible = html.replace(/<[^>]+>/g, "");
    expect(visible).toBe(`${dictionary.jobs.title}${dictionary.jobs.loading}`);
  });

  it("desenha só com token semântico e sem largura fixa", async () => {
    const html = await render("pt-BR");
    expect(html).toContain("bg-muted");
    expect(html).toContain("motion-safe:animate-pulse");
    expect(html).not.toMatch(/#[0-9a-f]{3,6}\b|\[(?:\d+)px\]|\bw-\d{3,}\b/i);
    // Grade de filtros com fallback de uma coluna no celular (regra 11).
    expect(html).toContain("grid-cols-1 gap-3 sm:grid-cols-3");
  });
});

describe("detalhe da vaga por streaming", () => {
  const page = readFileSync("app/jobs/[id]/page.tsx", "utf8");

  it("decide 404 antes de qualquer fronteira de Suspense", () => {
    // O status HTTP é enviado com o primeiro chunk; depois dele, `notFound()`
    // vira 200 com `noindex`. As duas guardas precisam vir antes do JSX.
    const firstSuspense = page.indexOf("<Suspense");
    expect(firstSuspense).toBeGreaterThan(0);
    expect(page.indexOf("if (!detail) notFound();")).toBeLessThan(firstSuspense);
    expect(page.indexOf("notFound();")).toBeLessThan(firstSuspense);
    expect(page.indexOf('await requirePage("job:read")')).toBeLessThan(firstSuspense);
  });

  it("transmite só as seções secundárias, com espera anunciada", () => {
    expect(page).toContain('testId="job-track-fits-loading"');
    expect(page).toContain('testId="application-timeline-loading"');
    expect(page.match(/t\("jobDetail\.loadingSection"\)/g)).toHaveLength(2);
    // A nota por trilha continua exclusiva de quem é candidato.
    expect(page).toMatch(/candidateId !== null && \(\s*<Suspense[\s\S]*?<TrackFits candidateId=\{candidateId\}/);
  });
});
