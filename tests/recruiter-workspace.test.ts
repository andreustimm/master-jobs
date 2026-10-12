/**
 * Suíte: a área do recrutador com acesso concedido (#465, task_04;
 * `_tests.md` IT-103 – IT-114, IT-141, IT-142).
 *
 * Fronteira DENTRO: as telas `/recruiter`, `/recruiter/[id]`, `/cv`, a rota de
 * download, a fachada `src/contexts/pursuit/recruiter.ts` e `app/auth.ts`
 * reais, com a sessão resolvida contra o PostgreSQL de teste — o arranjo de
 * `tests/recruiter-directory.test.ts`. Fronteira FORA: a borda do Next
 * (cookie, navegação, cache), o relógio (T0 = 2026-10-06T12:00:00Z).
 */
import { createElement, type HTMLAttributes } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUser, finishLogin, resolveSession, startLogin, type Role, type Session } from "../src/contexts/auth/index.ts";
import { recruiterCandidateList } from "../src/contexts/pursuit/index.ts";
import { drizzleRecruiterSuggestions } from "../src/contexts/pursuit/infra/drizzle-recruiter-suggestions.ts";
import { getJobDetail, applicationTimeline } from "../src/core/db/repo.ts";
import { fixedClock, resetClock, setClock } from "../src/core/clock.ts";
import { ensureCandidate, saveDocument } from "../src/core/candidate.ts";
import type { DB } from "../src/core/db/client.ts";
import {
  application,
  candidate,
  candidateDocument,
  job,
  jobScore,
  recruiterGrant,
  source,
} from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { primaryTrackId } from "./support/tracks.ts";

const boundary = vi.hoisted(() => ({ token: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "jho_session" && boundary.token !== undefined ? { name, value: boundary.token } : undefined,
    getAll: () => [],
    has: (name: string) => name === "jho_session" && boundary.token !== undefined,
    set: () => undefined,
    delete: () => undefined,
  }),
  headers: async () => new Headers({ host: "127.0.0.1:3000" }),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT;${to}`);
  },
  forbidden: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;403");
  },
  notFound: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  },
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("../app/transition-link.tsx", () => ({
  TransitionLink: (props: HTMLAttributes<HTMLElement> & { href: string }) => createElement("a", props),
}));
vi.mock("../app/mutation-feedback.tsx", () => ({ publishMutationFeedback: () => {} }));

const { default: RecruiterListPage } = await import("../app/recruiter/page.tsx");
const candidatePage = await import("../app/recruiter/[candidateId]/page.tsx");
const { default: CvPage } = await import("../app/recruiter/[candidateId]/cv/page.tsx");
const downloadRoute = await import("../app/recruiter/[candidateId]/cv/download/route.ts");
const exportRoute = await import("../app/api/export/route.ts");
const { trackAction } = await import("../app/actions.ts");

/**
 * O minuto em que a suíte roda, e não uma data fixa: a sessão nasce pelo
 * relógio injetado, mas a política confere a validade pelo relógio real, e uma
 * data fixa venceria a sessão com o calendário.
 */
const T0 = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
const DAY = 86_400_000;
const at = (offsetMs: number) => new Date(Date.parse(T0) + offsetMs).toISOString();

let db: DB;
let time: ReturnType<typeof fixedClock>;
let ana: number;
let bruno: number;
let rui: { id: number; token: string };

async function login(email: string, roles: Role[], candidateId: number | null = null) {
  const { id } = await createUser({ email, fullName: email.split("@")[0], roles, candidateId });
  const { token } = await startLogin(email);
  const result = await finishLogin(token);
  if (!result) throw new Error(`login de ${email} falhou`);
  return { id, token: result.token };
}

async function grant(recruiterUserId: number, candidateId: number, over: Partial<typeof recruiterGrant.$inferInsert> = {}) {
  const [row] = await db
    .insert(recruiterGrant)
    .values({ candidateId, recruiterUserId, recruiterEmail: "rui@x.com", createdAt: T0, ...over })
    .returning();
  return row!;
}

async function session(token: string): Promise<Session> {
  const resolved = await resolveSession(token);
  if (!resolved) throw new Error("sessão não resolveu");
  return resolved;
}

async function render(page: Promise<unknown>): Promise<string> {
  try {
    return renderToStaticMarkup((await page) as Parameters<typeof renderToStaticMarkup>[0]);
  } catch (error) {
    return `THROWN:${error instanceof Error ? error.message : String(error)}`;
  }
}

const NOT_FOUND = "THROWN:NEXT_HTTP_ERROR_FALLBACK;404";

const list = (params: Record<string, string> = {}) => render(RecruiterListPage({ searchParams: Promise.resolve(params) }));
const page = (id: string | number, params: Record<string, string> = {}) =>
  render(
    candidatePage.default({ params: Promise.resolve({ candidateId: String(id) }), searchParams: Promise.resolve(params) }),
  );
const cv = (id: string | number) => render(CvPage({ params: Promise.resolve({ candidateId: String(id) }) }));
async function download(id: string | number): Promise<Response | string> {
  try {
    return await downloadRoute.GET(new Request(`http://127.0.0.1:3000/recruiter/${id}/cv/download`), {
      params: Promise.resolve({ candidateId: String(id) }),
    });
  } catch (error) {
    return `THROWN:${error instanceof Error ? error.message : String(error)}`;
  }
}

let jobSeq = 0;
async function seedJob(title = `Vaga ${++jobSeq}`) {
  const n = ++jobSeq;
  const [row] = await db
    .insert(job)
    .values({
      fingerprint: `fp:${n}`,
      contentHash: `h:${n}`,
      sourceId: "web:test",
      externalId: String(n),
      companyName: "Acme",
      title,
      url: `https://example.test/${n}`,
      raw: {},
    })
    .returning({ id: job.id });
  return row!.id;
}

async function lastAccess(candidateId: number): Promise<string | null> {
  const [row] = await db
    .select({ at: recruiterGrant.lastAccessedAt })
    .from(recruiterGrant)
    .where(eq(recruiterGrant.candidateId, candidateId));
  return row?.at ?? null;
}

beforeEach(async () => {
  db = await useTestDb();
  time = fixedClock(T0);
  setClock(time);
  boundary.token = undefined;
  await db.insert(source).values({ id: "web:test", kind: "greenhouse", handle: "test", label: "Fonte de teste" });
  ana = await ensureCandidate({ slug: "ana", name: "Ana Silva", email: "ana@x.com" });
  bruno = await ensureCandidate({ slug: "bruno", name: "Bruno", email: "bruno@x.com" });
  rui = await login("rui@x.com", ["recruiter"]);
  await grant(rui.id, ana);
  boundary.token = rui.token;
});

afterEach(async () => {
  resetClock();
  await releaseTestDb();
});

describe("lista do recrutador", () => {
  it("IT-103 cinquenta concessões: 25 por página, por nome e depois id, com desde, até e as pendentes dele", async () => {
    const other = await login("sem@x.com", ["recruiter"]);
    boundary.token = other.token;
    expect(await list()).toContain('data-testid="recruiter-empty-state"');

    const ids: number[] = [];
    // Fora de ordem, e dois com o mesmo nome: o id desempata.
    for (const n of [...Array.from({ length: 48 }, (_, i) => 48 - i), 7]) {
      const id = await ensureCandidate({ slug: `c-${ids.length}`, name: `Candidato ${String(n).padStart(2, "0")}` });
      ids.push(id);
      await grant(other.id, id, {
        recruiterEmail: "sem@x.com",
        expiresAt: n === 1 ? at(56 * DAY) : null,
        expiryTz: n === 1 ? "America/Sao_Paulo" : null,
      });
    }
    await grant(other.id, ana, { recruiterEmail: "sem@x.com" });
    const s = await session(other.token);
    expect(s.linkedCandidateIds).toHaveLength(50);
    const jobId = await seedJob();
    const suggested = await drizzleRecruiterSuggestions.suggest({
      candidateId: ids[47]!, // "Candidato 01"
      jobId,
      recruiterUserId: other.id,
      recruiterEmail: "sem@x.com",
      note: null,
      nowIso: T0,
    });
    expect(suggested.ok).toBe(true);

    const first = await recruiterCandidateList(s, "1");
    const second = await recruiterCandidateList(s, "2");
    expect(first.total).toBe(50);
    expect(first.pages).toBe(2);
    expect(first.rows).toHaveLength(25);
    expect(second.rows).toHaveLength(25);
    const names = [...first.rows, ...second.rows].map((row) => row.name);
    expect(names.slice(0, 3)).toEqual(["Ana Silva", "Candidato 01", "Candidato 02"]);
    expect(new Set([...first.rows, ...second.rows].map((row) => row.candidateId)).size).toBe(50);
    const sevens = [...first.rows, ...second.rows].filter((row) => row.name === "Candidato 07").map((row) => row.candidateId);
    expect(sevens).toEqual([...sevens].sort((a, b) => a - b));
    const one = first.rows.find((row) => row.name === "Candidato 01")!;
    expect(one).toMatchObject({ since: T0, until: at(56 * DAY), untilTz: "America/Sao_Paulo", pending: 1 });
    expect(first.rows.find((row) => row.name === "Candidato 02")!.pending).toBe(0);

    const html = await list({ page: "2" });
    expect(html).toContain('data-testid="recruiter-list-pagination"');
    expect(html.match(/data-testid="recruiter-row"/g)).toHaveLength(25);
    expect(html).not.toContain('data-testid="recruiter-empty-state"');
  });

  it("IT-104 sem nome escolhido: 'Candidato · headline', e o e-mail nunca aparece", async () => {
    await db.update(candidate).set({ name: "", headline: "Backend" }).where(eq(candidate.id, ana));
    const html = await list();
    expect(html).toContain("Candidato · <span data-user-content=\"true\">Backend</span>");
    expect(html).not.toContain("ana@x.com");
  });

  it("IT-105 o título da página do candidato traz o nome dele; sem acesso, o título genérico", async () => {
    const meta = await candidatePage.generateMetadata({ params: Promise.resolve({ candidateId: String(ana) }) });
    expect(String(meta.title)).toContain("Ana");
    const other = await candidatePage.generateMetadata({ params: Promise.resolve({ candidateId: String(bruno) }) });
    expect(String(other.title)).not.toContain("Bruno");
  });
});

describe("página do candidato", () => {
  it("IT-106 abrir grava o último acesso uma vez por minuto; o currículo também conta", async () => {
    expect(await lastAccess(ana)).toBeNull();
    await page(ana);
    expect(await lastAccess(ana)).toBe(T0);
    time.advance(30_000);
    await page(ana);
    expect(await lastAccess(ana)).toBe(T0);
    time.advance(31_000);
    await page(ana);
    expect(await lastAccess(ana)).toBe(at(61_000));
    time.advance(61_000);
    await cv(ana);
    expect(await lastAccess(ana)).toBe(at(122_000));
  });

  it("IT-141 funil vazio: 'Esta pessoa ainda não tem candidaturas', e nenhum controle de escrita", async () => {
    const html = await page(ana);
    expect(html).toContain('data-testid="recruiter-candidate-empty"');
    expect(html).toContain("Esta pessoa ainda não tem candidaturas.");
    // Sem sugestão dele ainda (US-019.EC-1), e só os atalhos de ler e sugerir.
    expect(html).toContain("Você ainda não sugeriu vagas.");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<select");
  });

  it("IT-142 funil de 1.000: página inválida vai à primeira, além do fim vai à última (50), a 3 mostra 41 a 60", async () => {
    const jobs = await db
      .insert(job)
      .values(
        Array.from({ length: 1000 }, (_, i) => ({
          fingerprint: `bulk:${i}`,
          contentHash: `bulk:${i}`,
          sourceId: "web:test",
          externalId: `bulk-${i}`,
          companyName: "Bulk",
          title: `Bulk ${String(i).padStart(4, "0")}`,
          url: `https://example.test/bulk/${i}`,
          raw: {},
        })),
      )
      .returning({ id: job.id });
    // `updated_at` decrescente com o índice: a ordem do funil é a dos índices.
    await db.insert(application).values(
      jobs.map((row, i) => ({
        candidateId: ana,
        jobId: row.id,
        status: "applied" as const,
        updatedAt: at(-i * 60_000),
      })),
    );
    const titlesOf = (html: string) => [...html.matchAll(/Bulk (\d{4})/g)].map((m) => Number(m[1]));
    const abc = await page(ana, { page: "abc" });
    expect(titlesOf(abc)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    const far = await page(ana, { page: "999" });
    expect(far).toContain("Página 50 de 50");
    expect(titlesOf(far)).toEqual(Array.from({ length: 20 }, (_, i) => 980 + i));
    const third = await page(ana, { page: "3" });
    expect(titlesOf(third)).toEqual(Array.from({ length: 20 }, (_, i) => 40 + i));
    expect(third).toContain("Histórico · 1000 candidatura(s)");
  }, 30_000);
});

describe("currículo atual", () => {
  it("IT-107 mostra a versão atual; depois de uma nova, a nova, e nenhuma lista de versões", async () => {
    await saveDocument({ candidateId: ana, kind: "cv", label: "CV", content: "# Ana\n\nVersão antiga marcante" });
    expect(await cv(ana)).toContain("Versão antiga marcante");
    await saveDocument({ candidateId: ana, kind: "cv", label: "CV", content: "# Ana\n\nVersão nova marcante" });
    const html = await cv(ana);
    expect(html).toContain("Versão nova marcante");
    expect(html).not.toContain("Versão antiga marcante");
    expect(html).not.toMatch(/data-testid="[^"]*version/);
  });

  it("IT-108 sem currículo, 'Ainda sem currículo'; documento atual vazio, 'Currículo indisponível' sem detalhe", async () => {
    expect(await cv(ana)).toContain("Ainda sem currículo.");
    await db.insert(candidateDocument).values({ candidateId: ana, kind: "cv", label: "CV", content: "", isCurrent: true });
    const html = await cv(ana);
    expect(html).toMatch(/data-testid="recruiter-cv-unavailable"[^>]*>Currículo indisponível\.</);
    expect(html).not.toContain("THROWN");
    expect(html).not.toContain('data-testid="recruiter-cv-download"');
    expect(await download(ana)).toMatchObject({ status: 404 });
  });

  it("IT-109 download: anexo com o nome da pessoa, sem id, e 900 KB iguais byte a byte", async () => {
    const content = `# Ana Silva\n\n${"Experiência com TypeScript e áreas afins. ".repeat(22_000)}`.slice(0, 900_000);
    await saveDocument({ candidateId: ana, kind: "cv", label: "CV", content });
    const response = (await download(ana)) as Response;
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="ana-silva-cv.md"');
    expect(response.headers.get("content-disposition")).not.toContain(String(ana));
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await response.text()).toBe(content);
  });

  it("IT-110 fora do vínculo, id malformado e versão antiga: 404 ou parâmetro ignorado; depois da revogação, 404", async () => {
    await saveDocument({ candidateId: ana, kind: "cv", label: "CV", content: "Atual da Ana" });
    await saveDocument({ candidateId: bruno, kind: "cv", label: "CV", content: "Atual do Bruno" });
    for (const id of [bruno, "abc", "-1", "1.5"]) {
      expect(await page(id), `/recruiter/${id}`).toBe(NOT_FOUND);
      expect(await cv(id), `/recruiter/${id}/cv`).toBe(NOT_FOUND);
      expect(await download(id), `/recruiter/${id}/cv/download`).toMatchObject({ status: 404 });
    }
    const [older] = await db
      .insert(candidateDocument)
      .values({ candidateId: ana, kind: "cv", label: "antiga", content: "Versão antiga da Ana", isCurrent: false })
      .returning({ id: candidateDocument.id });
    // A página não lê parâmetro de versão nenhum: `?version=` não chega a ela.
    const current = await render(
      CvPage({
        params: Promise.resolve({ candidateId: String(ana) }),
        searchParams: Promise.resolve({ version: String(older!.id) }),
      } as never),
    );
    expect(current).toContain("Atual da Ana");
    expect(current).not.toContain("Versão antiga da Ana");

    await db.update(recruiterGrant).set({ status: "revoked", endedAt: T0 }).where(eq(recruiterGrant.candidateId, ana));
    expect(await download(ana)).toMatchObject({ status: 404 });
    expect(await page(ana)).toBe(NOT_FOUND);
  });
});

describe("fronteira de privacidade", () => {
  it("IT-111 recrutador com acesso a 7 não move o funil nem grava nota dela", async () => {
    const jobId = await seedJob();
    await db.insert(application).values({ candidateId: ana, jobId, status: "interviewing", notes: "nota privada" });
    const before = await db.select().from(application);
    for (const fields of [{ jobId, status: "offer" }, { jobId, status: "interviewing", note: "forjada" }]) {
      const form = new FormData();
      for (const [key, value] of Object.entries({ ...fields, candidateId: ana })) form.set(key, String(value));
      await expect(trackAction(form)).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;403|negado/);
    }
    expect(await db.select().from(application)).toEqual(before);
  });

  it("IT-112 a vaga aberta do funil dela não traz nota de fit, análise nem anotação dela", async () => {
    const jobId = await seedJob("Staff Engineer");
    const trackId = await primaryTrackId(db, ana);
    await db.insert(jobScore).values({
      candidateId: ana, trackId, jobId, fit: 87, titleScore: 1, keywordScore: 1, seniorityScore: 1,
      geoScore: 1, compScore: 1, freshnessScore: 1, benefitScore: 1, penalty: 0, cluster: "x",
      matchedKeywords: [], missingKeywords: [], reasons: [], blockers: [], scorerVersion: "t", profileHash: "t",
    });
    await db.insert(application).values({ candidateId: ana, jobId, status: "interviewing", notes: "nota privada" });
    // A tela da vaga lê com o escopo de candidato da SESSÃO: o do recrutador é nulo.
    const s = await session(rui.token);
    expect(s.candidateId).toBeNull();
    const detail = await getJobDetail(s.candidateId, jobId);
    expect(detail?.score).toBeNull();
    expect(detail?.application).toBeNull();
    expect(await applicationTimeline(s.candidateId, jobId)).toEqual([]);
  });

  it("IT-113 /api/export como recrutador com acesso não traz candidatura, nota nem currículo dela", async () => {
    const jobId = await seedJob("Exportável");
    await db.insert(application).values({ candidateId: ana, jobId, status: "interviewing", notes: "nota-sigilosa-ana" });
    await saveDocument({ candidateId: ana, kind: "cv", label: "CV", content: "cv-sigiloso-ana" });
    const response = await exportRoute.GET(new Request("http://127.0.0.1:3000/api/export"));
    const csv = await response.text();
    expect(csv).not.toContain("nota-sigilosa-ana");
    expect(csv).not.toContain("cv-sigiloso-ana");
    expect(csv).not.toContain("interviewing");
  });

  it("IT-114 candidato (9) e recrutador (de 7) na mesma conta: cada escopo no seu lugar; outro recrutador de 7 não alcança 9", async () => {
    const nine = await ensureCandidate({ slug: "nove", name: "Nove" });
    const both = await login("ambos@x.com", ["candidate", "recruiter"], nine);
    await grant(both.id, ana, { recruiterEmail: "ambos@x.com" });
    const s = await session(both.token);
    expect(s.candidateId).toBe(nine);
    expect(s.linkedCandidateIds).toEqual([ana]);
    // Rui acompanha 7, e ter o papel de recrutador não dá a ninguém o 9.
    boundary.token = rui.token;
    expect(await page(nine)).toBe(NOT_FOUND);
    expect(await cv(nine)).toBe(NOT_FOUND);
  });
});
