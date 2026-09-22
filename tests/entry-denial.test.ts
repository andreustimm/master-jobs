import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginImpersonation,
  createUser,
  endSession,
  finishLogin,
  linkRecruiterToCandidate,
  resolveSession,
  startLogin,
  type Role,
} from "../src/contexts/auth/index.ts";
import { ensureCandidate, saveDocument } from "../src/core/candidate.ts";
import type { DB } from "../src/core/db/client.ts";
import {
  application,
  authSession,
  authUser,
  candidateDocument,
  candidateSkill,
  company,
  job,
  savedTerm,
  skill,
  source,
} from "../src/core/db/schema.ts";
import { discoverEntries, exportedBindings, UNGUARDED_BY_DESIGN } from "./support/entry-inventory.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { primaryTrackId } from "./support/tracks.ts";

/**
 * V03-02 / V03-03 — a negação acontece ANTES de qualquer leitura ou efeito.
 *
 * O teste de arquitetura prova que o guarda está escrito primeiro. Este prova
 * que ele NEGA: chama de verdade cada Server Action descoberta pelo inventário,
 * com o `app/auth.ts` real e a sessão resolvida contra o PostgreSQL de teste.
 * Só a fronteira do Next é dublada — cookie, cabeçalho, navegação, cache e
 * `after()` —, e cada chamada a ela é registrada como EFEITO. Uma action que
 * negue depois de revalidar, gravar cookie, agendar trabalho ou tocar a rede
 * reprova aqui, mesmo com o guarda presente no texto.
 *
 * As actions sem guarda por desenho (login, recuperação, logout, preferência
 * de interface) ficam fora pelo mesmo critério do inventário, e o teste de
 * arquitetura garante que são exatamente as registradas, com justificativa.
 */

const boundary = vi.hoisted(() => ({
  token: undefined as string | undefined,
  effects: [] as string[],
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "jho_session" && boundary.token !== undefined ? { name, value: boundary.token } : undefined,
    getAll: () => [],
    has: (name: string) => name === "jho_session" && boundary.token !== undefined,
    set: (name: string) => void boundary.effects.push(`cookies.set(${name})`),
    delete: (name: string) => void boundary.effects.push(`cookies.delete(${name})`),
  }),
  headers: async () => new Headers({ host: "127.0.0.1:3000" }),
}));
// Marcador de build do Next: em teste não há bundle cliente para proteger.
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    boundary.effects.push(`redirect(${to})`);
    throw new Error(`NEXT_REDIRECT;${to}`);
  },
  forbidden: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;403");
  },
  notFound: () => {
    boundary.effects.push("notFound()");
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  },
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => void boundary.effects.push(`revalidatePath(${path})`),
  revalidateTag: (tag: string) => void boundary.effects.push(`revalidateTag(${tag})`),
  refresh: () => void boundary.effects.push("refresh()"),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: () => void boundary.effects.push("after()"),
}));

/**
 * Toda action descoberta, menos as exceções registradas. Não filtra pelo
 * veredito do inventário: uma action que perdeu o guarda continua aqui, e
 * reprova pelo que FAZ, não só pelo que o texto diz.
 */
const GUARDED = discoverEntries().serverModules.flatMap((file) =>
  exportedBindings(readFileSync(file, "utf8"))
    .filter((binding) => UNGUARDED_BY_DESIGN.get(binding.exported)?.file !== file)
    .map((binding) => ({ file, name: binding.exported })),
);

/**
 * A leitura léxica é a do inventário; o RUNTIME é a verdade. Toda função que
 * o módulo de fato exporta precisa estar entre as guardadas ou as exceções —
 * `export const a = …, b = …` e qualquer forma que o leitor léxico não
 * enxergue aparecem aqui.
 */
async function runtimeExports(): Promise<string[]> {
  const names: string[] = [];
  for (const file of discoverEntries().serverModules) {
    const module = (await import(/* @vite-ignore */ `../${file}`)) as Record<string, unknown>;
    for (const [name, value] of Object.entries(module)) {
      if (typeof value === "function") names.push(`${file}#${name}`);
    }
  }
  return names.sort();
}

type Action = (...args: unknown[]) => Promise<unknown>;

async function load(file: string, name: string): Promise<Action> {
  const module = (await import(/* @vite-ignore */ `../${file}`)) as Record<string, unknown>;
  const action = module[name];
  if (typeof action !== "function") throw new Error(`${file}: ${name} não é função`);
  return action as Action;
}

let db: DB;
let victim: number;

/**
 * Formulário hostil: todo nome de campo que alguma action lê, apontando para
 * dado da VÍTIMA. Id em FormData é pedido, não prova (regra 15).
 */
function hostileForm(ids: Record<string, number>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(ids)) data.set(key, String(value));
  data.set("candidateId", String(victim));
  data.set("visibility", "public");
  data.set("publicCv", "on");
  data.set("content", "Sobrescrito por outra sessão. ".repeat(6));
  data.set("status", "applied");
  data.set("term", "vazamento");
  data.set("email", "intruso@example.test");
  data.set("fullName", "Intruso");
  data.append("roles", "admin");
  data.set("routine", "sync");
  data.set("url", "https://example.test/vaga");
  data.set("description", "descrição forjada com texto suficiente para passar validação de tamanho mínimo");
  return data;
}

/** As formas de argumento que as actions deste repositório aceitam. */
function argumentShapes(form: FormData, id: number): unknown[][] {
  return [[form], [undefined, form], [id, form], [id, "rótulo forjado"]];
}

async function login(email: string, roles: Role[], candidateId: number | null): Promise<string> {
  await createUser({ email, fullName: email, roles, candidateId });
  const { token } = await startLogin(email);
  const result = await finishLogin(token);
  if (!result) throw new Error(`login de ${email} falhou`);
  return result.token;
}

/** Fotografia do banco inteiro: qualquer escrita muda o resumo de alguma tabela. */
async function snapshot(): Promise<Record<string, string>> {
  const tables = await db.execute<{ table_name: string }>(sql`
    select table_name from information_schema.tables
    where table_schema = 'production' and table_type = 'BASE TABLE' order by table_name`);
  const out: Record<string, string> = {};
  for (const { table_name } of tables) {
    const [row] = await db.execute<{ digest: string | null }>(
      sql.raw(`select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as digest from production."${table_name}" t`),
    );
    out[table_name] = row?.digest ?? "";
  }
  return out;
}

/** O que pertence à vítima: toda linha com `candidate_id` dela, e o próprio registro. */
async function victimSnapshot(): Promise<Record<string, string>> {
  const tables = await db.execute<{ table_name: string }>(sql`
    select c.table_name from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'production' and c.column_name = 'candidate_id' and t.table_type = 'BASE TABLE'
    order by c.table_name`);
  const out: Record<string, string> = {};
  for (const { table_name } of tables) {
    const [row] = await db.execute<{ digest: string | null }>(
      sql.raw(
        `select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as digest from production."${table_name}" t where candidate_id = ${victim}`,
      ),
    );
    out[table_name] = row?.digest ?? "";
  }
  const [self] = await db.execute<{ digest: string | null }>(
    sql.raw(`select md5(t::text) as digest from production.candidate t where id = ${victim}`),
  );
  out.candidate = self?.digest ?? "";
  return out;
}

const DENIED = /^(negado: |NEXT_HTTP_ERROR_FALLBACK;403$)/;

async function outcome(action: Action, args: unknown[]): Promise<string> {
  try {
    await action(...args);
    return "executou";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * O dado da vítima em cada tabela que uma action pode alcançar: currículo,
 * skill detectada, trilha, termo salvo e candidatura. Sem isto o teste só
 * afirmaria que o CV ficou intacto, e uma action de busca ou de funil que
 * deixasse de escopar pela sessão passaria sem ser vista.
 */
async function seedVictim(): Promise<Record<string, number>> {
  const [doc] = await db
    .select({ id: candidateDocument.id })
    .from(candidateDocument)
    .where(eq(candidateDocument.candidateId, victim));
  const [catalog] = await db
    .insert(skill)
    .values({ slug: "kubernetes", canonicalName: "Kubernetes", category: "infra", aliases: [] })
    .returning({ id: skill.id });
  const [detected] = await db
    .insert(candidateSkill)
    .values({ candidateId: victim, skillId: catalog!.id, status: "detected" })
    .returning({ id: candidateSkill.id });
  const trackId = await primaryTrackId(db, victim);
  const [term] = await db
    .insert(savedTerm)
    .values({ candidateId: victim, trackId, term: "Laravel", termKey: "laravel" })
    .returning({ id: savedTerm.id });
  await db.insert(source).values({ id: "remotive:~terms", kind: "remotive", handle: "~terms", label: "R", enabled: false });
  const [employer] = await db.insert(company).values({ slug: "acme", name: "Acme" }).returning({ id: company.id });
  const [posting] = await db
    .insert(job)
    .values({
      sourceId: "remotive:~terms", companyId: employer!.id, companyName: "Acme", externalId: "1",
      title: "Staff Engineer", url: "https://example.test/1", fingerprint: "fp1", contentHash: "h1", raw: {},
    })
    .returning({ id: job.id });
  await db.insert(application).values({ candidateId: victim, jobId: posting!.id, status: "interviewing" });
  return { documentId: doc!.id, candidateSkillId: detected!.id, trackId, termId: term!.id, jobId: posting!.id };
}

/**
 * Um formulário por objeto da vítima, porque `id` significa coisas diferentes
 * em actions diferentes (versão do CV, skill detectada).
 */
function victimForms(ids: Record<string, number>): FormData[] {
  const common = { jobId: ids.jobId!, termId: ids.termId!, trackId: ids.trackId!, versionId: ids.documentId! };
  return [
    hostileForm({ ...common, id: ids.documentId!, documentId: ids.documentId! }),
    hostileForm({ ...common, id: ids.candidateSkillId! }),
  ];
}

/**
 * Chama toda action não administrativa com cada forma de argumento hostil e
 * devolve quem rodou e TUDO o que voltou — valor e mensagem de erro. Escrita
 * alheia aparece no banco; leitura alheia só aparece no que a action devolve.
 */
async function sweepCandidateActions(ids: Record<string, number>): Promise<{ ran: string[]; returned: string }> {
  const ran: string[] = [];
  const returned: string[] = [];
  for (const { file, name } of GUARDED) {
    if (file.startsWith("app/admin/")) continue;
    const action = await load(file, name);
    for (const form of victimForms(ids)) {
      for (const args of argumentShapes(form, ids.documentId!)) {
        try {
          returned.push(JSON.stringify((await action(...args)) ?? null));
          ran.push(name);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          returned.push(message);
          if (message.startsWith("NEXT_REDIRECT;")) ran.push(name);
        }
      }
    }
  }
  return { ran, returned: returned.join("\n") };
}

/** O que só existe no dado da vítima: se aparecer numa resposta, vazou. */
const VICTIM_SENTINEL = "999999";

let fetchCalls: string[];

beforeEach(async () => {
  db = await useTestDb();
  boundary.token = undefined;
  boundary.effects = [];
  fetchCalls = [];
  vi.stubGlobal("fetch", async (input: unknown) => {
    fetchCalls.push(String(input));
    throw new Error("rede proibida no teste de negação");
  });
  victim = await ensureCandidate({ slug: "vitima", name: "Vítima", email: "vitima@example.test" });
  await saveDocument({ candidateId: victim, kind: "cv", label: "CV", content: "# Vítima\n\nPiso: 999999 USD" });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await releaseTestDb();
});

describe("V03-02 sessão inválida é negada antes de qualquer efeito", () => {
  it("o inventário encontrou as actions guardadas", () => {
    // Guarda contra o teste passar por não ter chamado nada.
    expect(GUARDED.length).toBeGreaterThan(30);
  });

  it("toda função exportada em runtime foi vista pelo inventário", async () => {
    const seen = [
      ...GUARDED.map(({ file, name }) => `${file}#${name}`),
      ...[...UNGUARDED_BY_DESIGN].map(([name, { file }]) => `${file}#${name}`),
    ].sort();
    expect(await runtimeExports()).toEqual(seen);
  });

  const INVALID: Array<[string, () => Promise<string | undefined>]> = [
    ["sem cookie", async () => undefined],
    ["cookie forjado", async () => "forjado-0123456789abcdef0123456789abcdef"],
    [
      "sessão expirada",
      async () => {
        const token = await login("expirada@example.test", ["admin", "candidate"], victim);
        await db.update(authSession).set({ expiresAt: "2000-01-01T00:00:00.000Z" });
        return token;
      },
    ],
    [
      "sessão revogada",
      async () => {
        const token = await login("revogada@example.test", ["admin", "candidate"], victim);
        await endSession(token);
        return token;
      },
    ],
    [
      "conta desabilitada",
      async () => {
        const token = await login("desabilitada@example.test", ["admin", "candidate"], victim);
        await db.update(authUser).set({ disabledAt: "2026-01-01T00:00:00.000Z" }).where(eq(authUser.email, "desabilitada@example.test"));
        return token;
      },
    ],
  ];

  for (const [label, makeToken] of INVALID) {
    it(`${label}: toda action guardada nega, e o banco, o cache, os cookies e a rede ficam intocados`, async () => {
      boundary.token = await makeToken();
      const [doc] = await db.execute<{ id: number }>(sql`select id from production.candidate_document limit 1`);
      const form = hostileForm({ id: doc!.id, versionId: doc!.id, jobId: 1, termId: 1, trackId: 1, userId: 1, linkId: 1 });
      const before = await snapshot();
      boundary.effects = [];

      const leaks: string[] = [];
      for (const { file, name } of GUARDED) {
        const action = await load(file, name);
        for (const args of argumentShapes(form, doc!.id)) {
          const result = await outcome(action, args);
          if (!DENIED.test(result)) leaks.push(`${file}#${name}(${args.length} args): ${result}`);
        }
      }

      expect(leaks).toEqual([]);
      expect(boundary.effects).toEqual([]);
      expect(fetchCalls).toEqual([]);
      expect(await snapshot()).toEqual(before);
    });
  }
});

describe("V03-02 id forjado não alcança outro candidato", () => {
  it("uma sessão de candidato que manda ids da vítima em toda action não muda nada dela", async () => {
    // A sessão é VÁLIDA: as actions rodam, falham ou gravam — no escopo de
    // quem pediu. O que se afirma é o que a regra 15 promete: o dado da
    // vítima fica como estava, byte a byte.
    const own = await ensureCandidate({ slug: "intruso", name: "Intruso" });
    boundary.token = await login("intruso@example.test", ["candidate"], own);
    const ids = await seedVictim();
    const before = await victimSnapshot();

    const { ran, returned } = await sweepCandidateActions(ids);

    expect(await victimSnapshot()).toEqual(before);
    expect(returned).not.toContain(VICTIM_SENTINEL);
    // A sessão é válida, então parte das actions RODOU e gravou — no escopo
    // do intruso. Sem isto o teste passaria com tudo falhando por outro motivo.
    expect(ran).toEqual(expect.arrayContaining(["saveCvAction", "setVisibilityAction"]));
  });
});

describe("V03-03 sessão emprestada não administra, nem quando o alvo é admin", () => {
  it("toda action de administração nega a sessão emprestada antes de efeito", async () => {
    const adminToken = await login("admin@example.test", ["admin"], null);
    await login("alvo@example.test", ["admin", "candidate"], victim);
    const [target] = await db.select({ id: authUser.id }).from(authUser).where(eq(authUser.email, "alvo@example.test"));
    const [admin] = await db.select().from(authUser).where(eq(authUser.email, "admin@example.test"));

    boundary.token = adminToken;
    const borrowed = await beginImpersonation(await resolveSession(adminToken), target!.id);
    if (!borrowed.ok) throw new Error(borrowed.reason);
    boundary.token = borrowed.token;

    const admins = GUARDED.filter(({ file }) => file.startsWith("app/admin/"));
    expect(admins.length).toBeGreaterThan(5);

    const form = hostileForm({ userId: admin!.id, linkId: 1 });
    const before = await snapshot();
    boundary.effects = [];
    const leaks: string[] = [];
    for (const { file, name } of admins) {
      const result = await outcome(await load(file, name), [form]);
      if (!/^negado: .*sessão emprestada/.test(result)) leaks.push(`${file}#${name}: ${result}`);
    }

    expect(leaks).toEqual([]);
    expect(boundary.effects).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it("recrutador vinculado lê, mas não escreve no candidato que acompanha", async () => {
    const recruiterToken = await login("recrutador@example.test", ["recruiter"], null);
    const [recruiter] = await db.select().from(authUser).where(eq(authUser.email, "recrutador@example.test"));
    await linkRecruiterToCandidate(recruiter!.id, victim, recruiter!.id);
    boundary.token = recruiterToken;

    const ids = await seedVictim();
    const before = await victimSnapshot();

    const { ran, returned } = await sweepCandidateActions(ids);

    expect(await victimSnapshot()).toEqual(before);
    expect(returned).not.toContain(VICTIM_SENTINEL);
    // O recrutador acompanha; nenhuma escrita de candidato chega a rodar.
    expect(ran.filter((name) => ["saveCvAction", "setVisibilityAction", "deleteVersionAction"].includes(name))).toEqual([]);
  });
});
