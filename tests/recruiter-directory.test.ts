import { readFileSync } from "node:fs";
import { eq, ne, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginImpersonation,
  createUser,
  finishLogin,
  linkRecruiterToCandidate,
  resolveSession,
  startLogin,
  type Role,
} from "../src/contexts/auth/index.ts";
import { ensureCandidate, getCandidateById, saveDocument, setPublicCv, setVisibility } from "../src/core/candidate.ts";
import { setPublicImage } from "../src/core/candidate-images.ts";
import type { DB } from "../src/core/db/client.ts";
import {
  application,
  authSession,
  authUser,
  candidate,
  candidateSkill,
  company,
  job,
  recruiterDirectoryQuery,
  skill,
  source,
} from "../src/core/db/schema.ts";
import { vercelBlobStorage } from "../src/core/storage/infra/vercel-blob.ts";
import { discoverEntries } from "./support/entry-inventory.ts";
import { fakeBlobSdk } from "./support/storage-fakes.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { RECRUITER_SWEEP, UNMEASURED_PAGES } from "./e2e/routes.mjs";

/**
 * Diretório de perfis (#465): as telas e a rota de imagem de verdade, com o
 * `app/auth.ts` real e a sessão resolvida contra o PostgreSQL de teste. Só a
 * fronteira do Next é dublada — cookie, navegação e cache —, como em
 * `tests/entry-denial.test.ts`.
 */

const boundary = vi.hoisted(() => ({ token: undefined as string | undefined, target: null as unknown }));

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
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("../src/core/storage/index.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/core/storage/index.ts")>()),
  openStorage: async () => boundary.target,
}));

const { default: DirectoryPage } = await import("../app/recruiter/directory/page.tsx");
const { default: ProfilePage } = await import("../app/recruiter/directory/[id]/page.tsx");
const imageRoute = await import("../app/recruiter/directory/[id]/image/[kind]/route.ts");
const { default: PublicProfilePage } = await import("../app/p/[slug]/page.tsx");
const { setVisibilityAction } = await import("../app/candidate/actions.ts");
const exportRoute = await import("../app/api/export/route.ts");
const { proxy } = await import("../proxy.ts");

let db: DB;
let paula: number;
let rita: number;
let pedro: number;

async function confirmedSkill(candidateId: number, name: string): Promise<void> {
  let [row] = await db.select({ id: skill.id }).from(skill).where(eq(skill.canonicalName, name));
  if (!row) {
    [row] = await db
      .insert(skill)
      .values({ slug: name.toLowerCase(), canonicalName: name, category: "framework", aliases: [] })
      .returning({ id: skill.id });
  }
  await db.insert(candidateSkill).values({ candidateId, skillId: row!.id, status: "confirmed", occurrences: 1 });
}

async function login(email: string, roles: Role[], candidateId: number | null = null): Promise<string> {
  await createUser({ email, fullName: email.split("@")[0], roles, candidateId });
  const { token } = await startLogin(email);
  const result = await finishLogin(token);
  if (!result) throw new Error(`login de ${email} falhou`);
  return result.token;
}

async function userId(email: string): Promise<number> {
  const [row] = await db.select({ id: authUser.id }).from(authUser).where(eq(authUser.email, email));
  return row!.id;
}

/** Renderiza a página; o erro de navegação do Next volta como texto. */
async function render(page: Promise<unknown>): Promise<string> {
  try {
    return renderToStaticMarkup((await page) as Parameters<typeof renderToStaticMarkup>[0]);
  } catch (error) {
    return `THROWN:${error instanceof Error ? error.message : String(error)}`;
  }
}

const list = (params: Record<string, string> = {}) => render(DirectoryPage({ searchParams: Promise.resolve(params) }));
const profile = (id: string | number) => render(ProfilePage({ params: Promise.resolve({ id: String(id) }) }));
const image = async (id: string | number, kind = "photo") => {
  try {
    return await imageRoute.GET(new Request(`http://127.0.0.1/recruiter/directory/${id}/image/${kind}`), {
      params: Promise.resolve({ id: String(id), kind }),
    });
  } catch (error) {
    return `THROWN:${error instanceof Error ? error.message : String(error)}`;
  }
};

/** Os campos privados das fixtures: nenhum pode aparecer em tela do diretório. */
const PRIVATE = ["paula@x.test", "rita@x.test", "pedro@x.test", "91234-5678", "30.000", "31337", "zebracorn", "Pedro Privado"];

beforeEach(async () => {
  db = await useTestDb();
  boundary.token = undefined;
  const blob = fakeBlobSdk("vercel_blob_rw_TESTE_segredo");
  boundary.target = { storage: vercelBlobStorage(blob.sdk, "vercel_blob_rw_TESTE_segredo"), bucket: "master-jobs" };

  await db.insert(source).values({ id: "remotive:~dir", kind: "remotive", handle: "~dir", label: "R", enabled: false });
  const [employer] = await db.insert(company).values({ slug: "acme", name: "Acme" }).returning({ id: company.id });
  const [posting] = await db
    .insert(job)
    .values({
      sourceId: "remotive:~dir", companyId: employer!.id, companyName: "Acme", externalId: "1",
      title: "Staff Engineer", url: "https://example.test/1", fingerprint: "fp1", contentHash: "h1", raw: {},
    })
    .returning({ id: job.id });

  paula = await ensureCandidate({ slug: "paula", name: "Paula Pública", headline: "Engenheira React", email: "paula@x.test" });
  await setVisibility(paula, "public");
  await setPublicCv(paula, true);
  await saveDocument({
    candidateId: paula,
    kind: "cv",
    label: "CV",
    content: "# Paula\n\nFront-end com React.\n\npaula@x.test · +55 11 91234-5678\n\nPretensão salarial: R$ 30.000",
  });
  await confirmedSkill(paula, "React");

  rita = await ensureCandidate({ slug: "rita", name: "Rita Recrutadores", headline: "Sênior <i>Backend</i>", email: "rita@x.test" });
  await setVisibility(rita, "recruiters");
  await confirmedSkill(rita, "React");
  await db.insert(application).values({ candidateId: rita, jobId: posting!.id, status: "interviewing", notes: "zebracorn 31337" });

  pedro = await ensureCandidate({ slug: "pedro", name: "Pedro Privado", headline: "Sênior React", email: "pedro@x.test" });
  await confirmedSkill(pedro, "React");
});

afterEach(async () => {
  await releaseTestDb();
});

describe("o recrutador busca e lê", () => {
  it("IT-163 Paula mostra /p/paula; Rita não tem link /p/; IT-027.EC-6 marcação sai como texto", async () => {
    boundary.token = await login("rui@x.test", ["recruiter"]);
    const paulaHtml = await profile(paula);
    expect(paulaHtml).toContain('href="/p/paula"');
    const ritaHtml = await profile(rita);
    expect(ritaHtml).toContain("Rita Recrutadores");
    expect(ritaHtml).not.toContain('href="/p/');
    expect(ritaHtml).toContain("Sênior &lt;i&gt;Backend&lt;/i&gt;");
    expect(ritaHtml).not.toContain("<i>Backend</i>");
  });

  it("IT-145 Pedro (Privado), id inexistente, NaN e lixo: o mesmo 404", async () => {
    boundary.token = await login("rui@x.test", ["recruiter"]);
    for (const id of [pedro, 999_999, "NaN", "abc", "1e3", "-1", "99999999999"]) {
      expect(await profile(id), String(id)).toBe("THROWN:NEXT_HTTP_ERROR_FALLBACK;404");
    }
  });

  it("IT-158 CV de Paula sai filtrado; Rita sem consentimento não tem CV", async () => {
    boundary.token = await login("rui@x.test", ["recruiter"]);
    const paulaHtml = await profile(paula);
    expect(paulaHtml).toContain('data-testid="public-cv"');
    expect(paulaHtml).toContain("Front-end com React.");
    expect(await profile(rita)).not.toContain('data-testid="public-cv"');
  });

  it("IT-162 com concessão de Rita: lista de permissão e link para /recruiter/<rita>, sem funil", async () => {
    const token = await login("rui@x.test", ["recruiter"]);
    await linkRecruiterToCandidate(await userId("rui@x.test"), rita, await userId("rui@x.test"));
    boundary.token = token;
    const html = await profile(rita);
    expect(html).toContain(`href="/recruiter/${rita}"`);
    expect(html).not.toContain("zebracorn");
    expect(html).not.toContain("interviewing");
    expect(html).not.toContain("Staff Engineer");
    // Sem concessão, nenhum link para a página da concessão.
    expect(await profile(paula)).not.toContain(`href="/recruiter/${paula}"`);
  });

  it("IT-150 'Pedro Privado' não aparece, nem para quem tem concessão de Pedro", async () => {
    const token = await login("rui@x.test", ["recruiter"]);
    await linkRecruiterToCandidate(await userId("rui@x.test"), pedro, await userId("rui@x.test"));
    boundary.token = token;
    const html = await list({ q: "Pedro Privado" });
    expect(html).toContain('data-testid="directory-empty"');
    expect(html).not.toContain(`directory-card-${pedro}`);
    expect(await profile(pedro)).toBe("THROWN:NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("IT-153 página 99 mostra a última; sem resultado, 'nenhum perfil' sem contagem", async () => {
    boundary.token = await login("rui@x.test", ["recruiter"]);
    for (let i = 0; i < 43; i++) {
      const id = await ensureCandidate({ slug: `mais-${i}`, name: `Mais ${String(i).padStart(2, "0")}` });
      await setVisibility(id, "recruiters");
    }
    const last = await list({ page: "99" });
    expect(last).toContain("Página 3 de 3");
    expect(last.match(/data-testid="directory-card-/g)).toHaveLength(5);

    const none = await list({ q: "inexistentexyz" });
    expect(none).toContain("Nenhum perfil corresponde à busca.");
    expect(none).not.toContain("directory-results");
    // Nenhum número depois do formulário (as opções têm "B2B"): nem total, nem
    // página, nem pista de quem não apareceu.
    const afterForm = none.slice(none.indexOf("</form>")).replace(/<[^>]+>/g, " ");
    expect(afterForm.match(/.{0,30}\d.{0,10}/)?.[0]).toBeUndefined();
  });

  it("IT-154 a 61ª busca na janela mostra 'Tente de novo em instantes' e nenhum cartão", async () => {
    boundary.token = await login("rui@x.test", ["recruiter"]);
    const rui = await userId("rui@x.test");
    const now = new Date().toISOString();
    await db.insert(recruiterDirectoryQuery).values(Array.from({ length: 59 }, () => ({ recruiterUserId: rui, at: now })));
    const sixtieth = await list();
    expect(sixtieth).toContain(`directory-card-${paula}`);
    const limited = await list();
    expect(limited).toContain("Tente de novo em instantes");
    expect(limited).not.toContain("directory-card-");
    // O perfil conta no mesmo limite e também recusa.
    expect(await profile(paula)).toContain('data-testid="directory-rate-limited"');
  });

  it("IT-161 busca e três recargas do perfil não mudam nenhuma tabela além do registro do limite; sem controle de concessão", async () => {
    boundary.token = await login("rui@x.test", ["recruiter"]);
    const snapshot = async () => {
      const tables = await db.execute<{ table_name: string }>(sql`
        select table_name from information_schema.tables
        where table_schema = 'production' and table_type = 'BASE TABLE' and table_name <> 'recruiter_directory_query'
        order by table_name`);
      const out: Record<string, string> = {};
      for (const { table_name } of tables) {
        const [row] = await db.execute<{ digest: string | null }>(
          sql.raw(`select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as digest from production."${table_name}" t`),
        );
        out[table_name] = row?.digest ?? "";
      }
      return out;
    };
    const before = await snapshot();
    await list({ q: "react" });
    const pages = [await profile(rita), await profile(rita), await profile(rita)];
    expect(await snapshot()).toEqual(before);
    expect(pages[0]).toBe(pages[2]);
    for (const html of pages) {
      expect(html).not.toContain("<form");
      expect(html).not.toContain("<button");
    }
    expect(await db.select().from(recruiterDirectoryQuery)).toHaveLength(4);
  });

  it("E2E-027 (servidor) nenhuma tela do diretório mostra piso, nota, e-mail ou telefone das fixtures", async () => {
    boundary.token = await login("rui@x.test", ["recruiter"]);
    const html = [await list(), await list({ q: "react" }), await profile(paula), await profile(rita)].join("\n");
    for (const sentinel of PRIVATE) expect(html, sentinel).not.toContain(sentinel);
  });
});

describe("visibilidade decide na requisição seguinte", () => {
  it("IT-155 Rita em Privado: some da busca, perfil 404, e a concessão a Rui continua", async () => {
    const token = await login("rui@x.test", ["recruiter"]);
    await linkRecruiterToCandidate(await userId("rui@x.test"), rita, await userId("rui@x.test"));
    boundary.token = token;
    expect(await list()).toContain(`directory-card-${rita}`);
    await setVisibility(rita, "private");
    expect(await list()).not.toContain(`directory-card-${rita}`);
    expect(await profile(rita)).toBe("THROWN:NEXT_HTTP_ERROR_FALLBACK;404");
    expect((await resolveSession(token))?.linkedCandidateIds).toContain(rita);
    await setVisibility(rita, "recruiters");
    expect(await list()).toContain(`directory-card-${rita}`);
  });

  it("IT-156 Recrutadores mantém o consentimento do CV; Privado o apaga; sessão emprestada é negada", async () => {
    const ritaToken = await login("rita@conta.test", ["candidate"], rita);
    boundary.token = ritaToken;
    const form = (visibility: string, publicCv: boolean) => {
      const data = new FormData();
      data.set("visibility", visibility);
      if (publicCv) data.set("publicCv", "on");
      return data;
    };
    expect(await setVisibilityAction(form("recruiters", true))).toEqual({ ok: true });
    expect(await getCandidateById(rita)).toMatchObject({ visibility: "recruiters", publicCv: true });
    expect(await setVisibilityAction(form("public", true))).toEqual({ ok: true });
    expect(await getCandidateById(rita)).toMatchObject({ visibility: "public", publicCv: true });
    expect(await setVisibilityAction(form("private", true))).toEqual({ ok: true });
    expect(await getCandidateById(rita)).toMatchObject({ visibility: "private", publicCv: false });

    const adminToken = await login("admin@x.test", ["admin"]);
    const borrowed = await beginImpersonation(await resolveSession(adminToken), await userId("rita@conta.test"));
    if (!borrowed.ok) throw new Error(borrowed.reason);
    boundary.token = borrowed.token;
    await expect(setVisibilityAction(form("public", true))).rejects.toThrow(/negado: access:manage/);
    expect(await getCandidateById(rita)).toMatchObject({ visibility: "private", publicCv: false });
  });

  it("IT-157 valor forjado recusa sem mudar; mesmo valor duas vezes passa; a última gravação vence", async () => {
    boundary.token = await login("rita@conta.test", ["candidate"], rita);
    const form = (visibility: string) => {
      const data = new FormData();
      data.set("visibility", visibility);
      return data;
    };
    expect(await setVisibilityAction(form("everyone"))).toEqual({ ok: false, code: "invalidVisibility" });
    expect((await getCandidateById(rita))?.visibility).toBe("recruiters");
    expect(await setVisibilityAction(form("recruiters"))).toEqual({ ok: true });
    expect(await setVisibilityAction(form("recruiters"))).toEqual({ ok: true });
    await setVisibilityAction(form("public"));
    await setVisibilityAction(form("private"));
    expect((await getCandidateById(rita))?.visibility).toBe("private");
  });
});

describe("imagens", () => {
  async function photo(): Promise<File> {
    const bytes = await sharp({ create: { width: 600, height: 600, channels: 3, background: { r: 10, g: 120, b: 200 } } })
      .jpeg()
      .toBuffer();
    return new File([new Uint8Array(bytes)], "foto.jpg", { type: "image/jpeg" });
  }

  it("IT-159 foto de Rita só com opt-in; Pedro 404; sem sessão vai ao login", async () => {
    expect(await setPublicImage(rita, { kind: "photo", file: await photo(), show: false })).toEqual({ ok: true });
    expect(await setPublicImage(pedro, { kind: "photo", file: await photo(), show: true })).toEqual({ ok: true });

    expect(await image(rita)).toBe("THROWN:NEXT_REDIRECT;/login");

    boundary.token = await login("rui@x.test", ["recruiter"]);
    expect(((await image(rita)) as Response).status).toBe(404);
    await db.update(candidate).set({ publicPhoto: true }).where(eq(candidate.id, rita));
    const served = (await image(rita)) as Response;
    expect(served.status).toBe(200);
    expect(served.headers.get("cache-control")).toContain("no-store");
    expect(((await image(pedro)) as Response).status).toBe(404);
    expect(((await image(rita, "avatar")) as Response).status).toBe(404);
    expect(((await image("abc")) as Response).status).toBe(404);
  });
});

describe("quem não é recrutador não entra", () => {
  it("IT-160 sem sessão: login com `next`; candidato e admin: 403 nas três rotas; sessão expirada: login", async () => {
    const redirected = proxy(new NextRequest("http://127.0.0.1:3000/recruiter/directory?q=react"));
    expect(redirected.status).toBe(307);
    const location = new URL(redirected.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/recruiter/directory?q=react");

    expect(await list({ q: "react" })).toBe("THROWN:NEXT_REDIRECT;/login");
    expect(await profile(rita)).toBe("THROWN:NEXT_REDIRECT;/login");

    for (const [email, roles, candidateId] of [
      ["ana@x.test", ["candidate"], paula],
      ["admin@x.test", ["admin"], null],
    ] as const) {
      boundary.token = await login(email, [...roles], candidateId);
      expect(await list({ q: "react" }), email).toBe("THROWN:NEXT_HTTP_ERROR_FALLBACK;403");
      expect(await profile(rita), email).toBe("THROWN:NEXT_HTTP_ERROR_FALLBACK;403");
      expect(await image(rita), email).toBe("THROWN:NEXT_HTTP_ERROR_FALLBACK;403");
    }

    const token = await login("rui@x.test", ["recruiter"]);
    await db.update(authSession).set({ expiresAt: "2000-01-01T00:00:00.000Z" }).where(ne(authSession.id, -1));
    boundary.token = token;
    expect(await list()).toBe("THROWN:NEXT_REDIRECT;/login");
    // Nenhuma busca recusada chegou a ser registrada.
    expect(await db.select().from(recruiterDirectoryQuery)).toEqual([]);
  });

  it("IT-166 /p/ de Recrutadores responde 404 a anônimo", async () => {
    expect(await render(PublicProfilePage({ params: Promise.resolve({ slug: "rita" }) }))).toBe(
      "THROWN:NEXT_HTTP_ERROR_FALLBACK;404",
    );
    expect(await render(PublicProfilePage({ params: Promise.resolve({ slug: "paula" }) }))).toContain("Paula Pública");
  });

  it("IT-167 /api/export como recrutador não traz campo nenhum dos perfis do diretório", async () => {
    boundary.token = await login("rui@x.test", ["recruiter"]);
    const response = await exportRoute.GET(new Request("http://127.0.0.1:3000/api/export"));
    expect(response.status).toBe(200);
    const csv = await response.text();
    for (const sentinel of ["Paula Pública", "Rita Recrutadores", "Engenheira React", ...PRIVATE]) {
      expect(csv, sentinel).not.toContain(sentinel);
    }
  });
});

describe("inventário", () => {
  it("IT-168 rotas guardadas por candidate:discover, varredura, exceções e área do mapa de E2E", () => {
    const { pages, routes } = discoverEntries();
    expect(pages).toEqual(expect.arrayContaining(["app/recruiter/directory/page.tsx", "app/recruiter/directory/[id]/page.tsx"]));
    expect(routes).toContain("app/recruiter/directory/[id]/image/[kind]/route.ts");
    for (const file of [
      "app/recruiter/directory/page.tsx",
      "app/recruiter/directory/[id]/page.tsx",
      "app/recruiter/directory/[id]/image/[kind]/route.ts",
    ]) {
      const code = readFileSync(file, "utf8");
      const body = code.slice(code.search(/export (?:default )?async function (?!generateMetadata)/));
      // A guarda é o PRIMEIRO `await` do corpo: nada é lido antes dela.
      expect(body.match(/await [^;]+/)?.[0], file).toBe('await requirePage("candidate:discover")');
    }
    const architecture = readFileSync("tests/architecture.test.ts", "utf8");
    expect(architecture).toContain(`"app/recruiter/directory/page.tsx": { guard: 'requirePage("candidate:discover")' }`);
    expect(architecture).toContain(`"app/recruiter/directory/[id]/page.tsx": { guard: 'requirePage("candidate:discover")' }`);
    expect(RECRUITER_SWEEP).toContain("/recruiter/directory");
    expect(Object.keys(UNMEASURED_PAGES)).toContain("app/recruiter/directory/[id]/page.tsx");
    const map = JSON.parse(readFileSync("config/e2e-spec-map.json", "utf8")) as { areas: { id: string; modules: string[] }[] };
    expect(map.areas.find((area) => area.id === "recruiter-directory")?.modules).toContain("tests/e2e/ui/recruiter-directory.mjs");
  });
});
