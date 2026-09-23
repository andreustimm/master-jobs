/**
 * Busca da tela Vagas no PostgreSQL (#223, tarefa 05).
 *
 * IT-009: relevância não muda conjunto nem contagem; localização entra no
 * filtro; a ordem da consulta é a de `compareByRelevance`.
 * IT-010: grupo de termos parecidos separado, limitado e só com quem passa nos
 * filtros; plano com `job_title_trgm_idx`; sem `pg_trgm`, o resultado segue.
 */
import { sql, TransactionRollbackError } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  countBoard,
  listBoard,
  nearMatches,
  setMatchingProfile,
  trackScope,
  type BoardFilters,
} from "../src/contexts/matching/index.ts";
import type { DB } from "../src/core/db/client.ts";
import { NEAR_LIMIT, NEAR_THRESHOLD, nearMatchesQuery } from "../src/core/db/repo.ts";
import { candidate, job, jobScore, source } from "../src/core/db/schema.ts";
import { loadProfile } from "../src/core/profile/load.ts";
import { compareByRelevance, parseQuery } from "../src/core/search.ts";
import { validateTerm, type ValidTerm } from "../src/core/term.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;
let owner: number;
let seq = 0;

beforeEach(async () => {
  db = await useTestDb();
  const [row] = await db.insert(candidate).values({ slug: "owner", name: "Owner", isDefault: true }).returning();
  owner = row!.id;
  await setMatchingProfile(owner, await loadProfile(true));
  await db.insert(source).values({ id: "manual:board", kind: "manual", handle: "board", label: "Board" });
});

afterEach(async () => {
  await releaseTestDb();
});

function valid(raw: string): ValidTerm {
  const result = validateTerm(raw);
  if (!result.ok) throw new Error(result.code);
  return result.value;
}

/** A consulta como a tela a monta: `parseQuery` e a validação de cada parte. */
function query(raw: string): BoardFilters["query"] {
  const parsed = parseQuery(raw);
  return { terms: parsed.terms.map(valid), phrases: parsed.phrases.map(valid) };
}

type Seed = { title: string; company?: string; location?: string; description?: string; postedAt?: string; remote?: boolean };

async function addJob(seed: Seed, fit?: number): Promise<number> {
  const n = ++seq;
  const [row] = await db
    .insert(job)
    .values({
      sourceId: "manual:board",
      companyName: seed.company ?? `Empresa ${n}`,
      externalId: `j${n}`,
      title: seed.title,
      descriptionText: seed.description ?? null,
      locationRaw: seed.location ?? null,
      remote: seed.remote ?? null,
      postedAt: seed.postedAt ?? null,
      firstSeenAt: "2026-09-01T00:00:00.000Z",
      url: `https://board.test/${n}`,
      fingerprint: `fp${n}`,
      contentHash: `h${n}`,
      raw: {},
    })
    .returning();
  if (fit !== undefined) {
    const trackId = (await trackScope(owner, { kind: "primary" }))!.primaryTrackId;
    await db.insert(jobScore).values({
      candidateId: owner, trackId, jobId: row!.id, fit,
      titleScore: fit, keywordScore: 0, seniorityScore: 0, geoScore: 0, compScore: 0,
      freshnessScore: 0, benefitScore: 0, penalty: 0, cluster: "architect",
      matchedKeywords: [], missingKeywords: [], detectedBenefits: [], ageDays: null,
      reasons: [], blockers: [], scorerVersion: "1.4.1",
    });
  }
  return row!.id;
}

const ids = (rows: Array<{ jobId: number }>) => rows.map((row) => row.jobId);
const sorted = (values: number[]) => [...values].sort((a, b) => a - b);

/** A fixture de referência: o termo em cada campo, fits e datas diferentes. */
async function reference() {
  return {
    inTitle: await addJob({ title: "Tech Lead Backend", postedAt: "2026-09-10T00:00:00.000Z" }, 40),
    inCompany: await addJob({ title: "Engenheira de Dados", company: "Tech Lead Labs" }, 90),
    inDescription: await addJob({ title: "Staff Engineer", description: "You will act as tech lead for a squad." }, 70),
    inTitleHighFit: await addJob({ title: "Senior Tech Lead", postedAt: "2026-09-02T00:00:00.000Z" }, 80),
    noMatch: await addJob({ title: "Designer de Produto", location: "São Paulo, Brasil" }, 95),
  };
}

describe("IT-009 relevância, conjunto e localização", () => {
  it("relevância e fit devolvem o mesmo conjunto e a mesma contagem", async () => {
    await reference();
    for (const raw of ["tech lead", '"tech lead"', 'lead "tech lead"']) {
      const base: BoardFilters = { query: query(raw), minFit: 0 };
      const byFit = await listBoard(owner, { ...base, sort: "fit" });
      const byRelevance = await listBoard(owner, { ...base, sort: "relevance" });
      expect(sorted(ids(byRelevance)), raw).toEqual(sorted(ids(byFit)));
      expect(await countBoard(owner, { ...base, sort: "relevance" }), raw).toBe(await countBoard(owner, { ...base, sort: "fit" }));
    }
  });

  it("sem casamento em localização, o conjunto é o mesmo do filtro de termo de antes", async () => {
    await reference();
    // `term` é o caminho anterior à tarefa, ainda usado pela CLI e pelo cockpit.
    const before = await listBoard(owner, { term: valid("tech lead"), minFit: 0 });
    const now = await listBoard(owner, { query: query("tech lead"), minFit: 0, sort: "relevance" });
    expect(sorted(ids(now))).toEqual(sorted(ids(before)));
  });

  it("uma vaga que só casa na localização aparece, e a explicação diz localização", async () => {
    const { noMatch } = await reference();
    const rows = await listBoard(owner, { query: query("paulo"), minFit: 0, sort: "relevance" });
    expect(ids(rows)).toEqual([noMatch]);
    expect(rows[0]!.matchedFields).toEqual(["location"]);
  });

  it("a explicação lista cada campo onde a consulta casou; sem consulta, nada", async () => {
    const { inCompany, inDescription } = await reference();
    const rows = await listBoard(owner, { query: query("tech lead"), minFit: 0 });
    const byId = new Map(rows.map((row) => [row.jobId, row.matchedFields]));
    expect(byId.get(inCompany)).toEqual(["company"]);
    expect(byId.get(inDescription)).toEqual(["description"]);
    expect((await listBoard(owner, { minFit: 0 }))[0]!.matchedFields).toBeNull();
  });

  it("a ordem da consulta coincide com compareByRelevance", async () => {
    const { inTitle, inTitleHighFit, inCompany, inDescription } = await reference();
    const rows = await listBoard(owner, { query: query("tech lead"), minFit: 0, sort: "relevance" });
    expect(ids(rows)).toEqual([inTitleHighFit, inTitle, inCompany, inDescription]);
    const ranked = rows.map((row) => ({
      id: row.jobId,
      fields: row.matchedFields ?? [],
      fit: row.fit,
      postedAt: row.postedAt ?? row.firstSeenAt,
    }));
    expect([...ranked].sort(compareByRelevance).map((row) => row.id)).toEqual(ids(rows));
  });

  it("frase exata não casa a grafia colada que o termo aceita", async () => {
    const colado = await addJob({ title: "Techlead Java" });
    const separado = await addJob({ title: "Tech Lead Java" });
    expect(sorted(ids(await listBoard(owner, { query: query("tech lead") })))).toEqual(sorted([colado, separado]));
    expect(ids(await listBoard(owner, { query: query('"tech lead"') }))).toEqual([separado]);
  });
});

describe("IT-010 grupo de termos parecidos", () => {
  it("só vagas que passam nos filtros e NÃO casaram, acima do limiar", async () => {
    const exact = await addJob({ title: "Kubernets Operator", remote: true });
    const near = await addJob({ title: "Kubernetes Engineer", remote: true });
    const nearOnSite = await addJob({ title: "Kubernetes Platform Engineer", remote: false });
    const far = await addJob({ title: "Backend Engineer", remote: true });

    const filters: BoardFilters = { query: query("kubernets"), workMode: "remote" };
    expect(ids(await listBoard(owner, filters))).toEqual([exact]);
    const group = await nearMatches(owner, filters);
    expect(group.available).toBe(true);
    expect(group.rows.map((row) => row.jobId)).toEqual([near]);
    expect(group.rows.map((row) => row.jobId)).not.toContain(nearOnSite);
    expect(group.rows.map((row) => row.jobId)).not.toContain(far);
    // O grupo nunca mexe no resultado principal.
    expect(await countBoard(owner, filters)).toBe(1);
  });

  it("abaixo do limiar fica fora", async () => {
    await addJob({ title: "Frontend Engineer" });
    const backend = await addJob({ title: "Backend Engineer" });
    const group = await nearMatches(owner, { query: query("frontend"), minFit: 0 });
    expect(group.rows.map((row) => row.jobId)).not.toContain(backend);
  });

  it("é limitado a NEAR_LIMIT", async () => {
    for (let i = 0; i < NEAR_LIMIT + 5; i++) await addJob({ title: `Kubernetes Engineer ${i}` });
    const group = await nearMatches(owner, { query: query("kubernets") });
    expect(group.rows).toHaveLength(NEAR_LIMIT);
  });

  it("sem consulta não há grupo", async () => {
    await addJob({ title: "Kubernetes Engineer" });
    expect(await nearMatches(owner, {})).toEqual({ available: false, rows: [] });
  });

  it("o grupo filtra por <% e job_title_trgm_idx é elegível no plano", async () => {
    await addJob({ title: "Kubernetes Engineer" });
    const [index] = await db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where schemaname = 'production' and indexname = 'job_title_trgm_idx'`,
    );
    expect(index?.indexdef).toMatch(/gin \(title gin_trgm_ops\) WHERE \(closed_at IS NULL\)/);

    // A fixture é pequena demais para o planejador preferir o índice sozinho.
    // Na transação do teste, desfeita no fim: sem varredura sequencial, sem
    // index scan simples (só bitmap, que exige condição de índice) e sem os
    // dois índices de `closed_at`, que também cobrem o predicado parcial. Se
    // `<%` não fosse elegível para `job_title_trgm_idx`, não haveria plano.
    let plan = "";
    await db
      .transaction(async (tx) => {
        await tx.execute(sql`drop index production.job_archive_scan_idx`);
        await tx.execute(sql`drop index production.job_closed_idx`);
        await tx.execute(sql`set local enable_seqscan = off`);
        await tx.execute(sql`set local enable_indexscan = off`);
        await tx.execute(sql`select set_config('pg_trgm.word_similarity_threshold', ${String(NEAR_THRESHOLD)}, true)`);
        const built = nearMatchesQuery(tx, owner, { query: query("kubernets") }).toSQL();
        expect(built.sql).toContain("<%");
        const rows = await tx.execute<{ "QUERY PLAN": string }>(
          sql.raw(`explain ${inline(built.sql, built.params)}`),
        );
        plan = rows.map((row) => row["QUERY PLAN"]).join("\n");
        tx.rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof TransactionRollbackError)) throw error;
      });
    // `title %> termo` é o comutador de `termo <% title`: a mesma condição, do lado do índice.
    expect(plan).toMatch(/Bitmap Index Scan on job_title_trgm_idx[^\n]*\n\s+Index Cond: \(title %> /);
    const [still] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from pg_indexes where indexname = 'job_archive_scan_idx'`,
    );
    expect(still!.n).toBe(1);
  });

  it("sem pg_trgm, o resultado principal continua e o grupo some", async () => {
    const hit = await addJob({ title: "Kubernets Operator" });
    await addJob({ title: "Kubernetes Engineer" });
    await db.execute(sql`drop extension pg_trgm cascade`);
    expect(ids(await listBoard(owner, { query: query("kubernets") }))).toEqual([hit]);
    expect(await nearMatches(owner, { query: query("kubernets") })).toEqual({ available: false, rows: [] });
  });
});

/** Parâmetros no texto só para o EXPLAIN do teste; valores controlados aqui. */
function inline(text: string, params: unknown[]): string {
  return text.replace(/\$(\d+)/g, (_m, n: string) => {
    const value = params[Number(n) - 1];
    if (typeof value === "number") return String(value);
    if (typeof value === "boolean") return value ? "true" : "false";
    return `'${String(value).replaceAll("'", "''")}'`;
  });
}
