import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadJobsView } from "../app/jobs/jobs-data.ts";
import {
  boardFacets,
  countBoard,
  countHiddenByPayRange,
  createTrack,
  listBoard,
  saveTerm,
  setMatchingProfile,
  suggestTrack,
  targetOf,
  trackScope,
  type BoardFilters,
  type PayFilter,
} from "../src/contexts/matching/index.ts";
import type { DB } from "../src/core/db/client.ts";
import {
  candidate,
  company,
  fxRate,
  job,
  jobPage,
  jobScore,
  savedTerm,
  source,
  termAttribution,
} from "../src/core/db/schema.ts";
import { normalizePayTop } from "../src/core/money.ts";
import { loadProfile } from "../src/core/profile/load.ts";
import { termKey, validateTerm, type ValidTerm } from "../src/core/term.ts";
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

function term(raw: string): ValidTerm {
  const valid = validateTerm(raw);
  if (!valid.ok) throw new Error(valid.code);
  return valid.value;
}

type JobSeed = {
  title: string;
  company?: string;
  description?: string | null;
  page?: string;
  compMin?: number | null;
  compMax?: number | null;
  cur?: string | null;
  per?: string | null;
  firstSeenAt?: string;
  postedAt?: string;
  location?: string;
};

async function addJob(seed: JobSeed): Promise<number> {
  const n = ++seq;
  const name = seed.company ?? `Company ${n}`;
  const [employer] = await db.insert(company).values({ slug: `company-${n}`, name }).returning();
  const [row] = await db
    .insert(job)
    .values({
      sourceId: "manual:board",
      companyId: employer!.id,
      companyName: name,
      externalId: `j${n}`,
      title: seed.title,
      descriptionText: seed.description ?? null,
      url: `https://board.test/${n}`,
      fingerprint: `fp${n}`,
      contentHash: `h${n}`,
      raw: {},
      compMin: seed.compMin ?? null,
      compMax: seed.compMax ?? null,
      compCurrency: seed.cur ?? null,
      compPeriod: seed.per ?? null,
      locationRaw: seed.location ?? null,
      postedAt: seed.postedAt ?? null,
      ...(seed.firstSeenAt ? { firstSeenAt: seed.firstSeenAt } : {}),
    })
    .returning();
  if (seed.page !== undefined) {
    await db.insert(jobPage).values({ jobId: row!.id, finalUrl: row!.url, httpStatus: 200, text: seed.page, contentHash: `p${n}` });
  }
  return row!.id;
}

async function primaryId(): Promise<number> {
  return (await trackScope(owner, { kind: "primary" }))!.primaryTrackId;
}

async function score(jobId: number, fit: number, trackId?: number) {
  await db.insert(jobScore).values({
    candidateId: owner, trackId: trackId ?? (await primaryId()), jobId, fit,
    titleScore: fit, keywordScore: 0, seniorityScore: 0, geoScore: 0, compScore: 0,
    freshnessScore: 0, benefitScore: 0, penalty: 0, cluster: "architect",
    matchedKeywords: [], missingKeywords: [], detectedBenefits: [], ageDays: null,
    reasons: [], blockers: [], scorerVersion: "1.4.1",
  });
}

async function rates(values: Record<string, number>, date = "2026-09-18") {
  await db.insert(fxRate).values(
    Object.entries(values).map(([currency, rate]) => ({ date, base: "USD", currency, rate, provider: "manual" })),
  );
}

const ids = (rows: Array<{ jobId: number }>) => rows.map((row) => row.jobId);
const USD_MONTH: PayFilter = { currency: "USD", period: "month" };

describe("term filter over the corpus (ADR-005, ADR-012)", () => {
  it("IT-105 whole words over title, company and captured text", async () => {
    const onPage = await addJob({ title: "Backend Engineer", page: "We run Laravel queues all day." });
    const java = await addJob({ title: "Java Engineer" });
    const javascript = await addJob({ title: "JavaScript Engineer" });
    const csharp = await addJob({ title: "C# Developer" });
    const node = await addJob({ title: "Node.js Backend" });

    expect(ids(await listBoard(owner, { term: term("laravel") }))).toEqual([onPage]);
    expect(ids(await listBoard(owner, { term: term("Lara") }))).toEqual([]);
    expect(ids(await listBoard(owner, { term: term("java") }))).toEqual([java]);
    expect(ids(await listBoard(owner, { term: term("C#") }))).toEqual([csharp]);
    expect(ids(await listBoard(owner, { term: term("node.js") }))).toEqual([node]);
    expect(await countBoard(owner, { term: term("java") })).toBe(1);
    expect(ids(await listBoard(owner, { term: term("JavaScript") }))).toEqual([javascript]);
  });

  it("IT-106 a job without page or description matches by title alone", async () => {
    const titled = await addJob({ title: "PHP Developer", description: null });
    await addJob({ title: "Backend Engineer", description: null });

    expect(ids(await listBoard(owner, { term: term("php") }))).toEqual([titled]);
  });

  it("IT-107 the term combines with work mode, the fit cut and the recent sort", async () => {
    const newer = await addJob({ title: "Laravel Developer", location: "Remote", postedAt: "2026-09-10T00:00:00Z" });
    const older = await addJob({ title: "Laravel Lead", location: "Remote", postedAt: "2026-09-01T00:00:00Z" });
    const lowFit = await addJob({ title: "Laravel Developer II", location: "Remote", postedAt: "2026-09-12T00:00:00Z" });
    const onsite = await addJob({ title: "Laravel Engineer", location: "On-site, Berlin", postedAt: "2026-09-11T00:00:00Z" });
    const otherTerm = await addJob({ title: "Java Developer", location: "Remote", postedAt: "2026-09-13T00:00:00Z" });
    for (const [id, fit] of [[newer, 60], [older, 80], [lowFit, 30], [onsite, 90], [otherTerm, 90]] as const) await score(id, fit);

    const rows = await listBoard(owner, { term: term("laravel"), workMode: "remote", minFit: 45, sort: "recent" });

    expect(ids(rows)).toEqual([newer, older]);
  });

  it("IT-115 hostile text is data: bound, escaped and literal", async () => {
    const literal = await addJob({ title: "O'Reilly%_ Media Engineer" });
    await addJob({ title: "OReilly Media Engineer" });
    const hostile: ValidTerm = { term: "O'Reilly%_", key: termKey("O'Reilly%_") };

    expect(ids(await listBoard(owner, { term: hostile }))).toEqual([literal]);
  });

  it("IT-214a the indexed prefilter keeps whole words over the description (#214)", async () => {
    const hyphen = await addJob({ title: "Engineer", description: "Hands-on Tech-Lead role." });
    const spaced = await addJob({ title: "Engineer", description: "We need a TECH LEAD now." });
    const glued = await addJob({ title: "Engineer", description: "Our techlead mentors." });
    await addJob({ title: "Engineer", description: "Techleading is one longer word." });
    const java = await addJob({ title: "Engineer", description: "Java 21 and Spring." });
    await addJob({ title: "Engineer", description: "Only JavaScript here." });
    const captured = await addJob({ title: "Engineer", description: "nothing", page: "TypeScript on the captured page." });
    // A página capturada SUBSTITUI a descrição da fonte: o termo só na
    // descrição da fonte não casa, e o pré-filtro não pode mudar isso.
    await addJob({ title: "Engineer", description: "typescript in the source text", page: "captured text says nothing" });
    const closed = await addJob({ title: "Engineer", description: "tech lead" });
    await db.update(job).set({ closedAt: "2026-09-01T00:00:00Z" }).where(eq(job.id, closed));
    const accented = await addJob({ title: "Engineer", description: "Gestão de pessoas." });
    const sorted = (rows: Array<{ jobId: number }>) => ids(rows).sort((a, b) => a - b);

    expect(sorted(await listBoard(owner, { term: term("techlead") }))).toEqual([hyphen, spaced, glued]);
    expect(sorted(await listBoard(owner, { term: term("Tech Lead") }))).toEqual([hyphen, spaced, glued]);
    expect(sorted(await listBoard(owner, { term: term("java") }))).toEqual([java]);
    expect(sorted(await listBoard(owner, { term: term("typescript") }))).toEqual([captured]);
    // Sem pré-filtro (acento): o `~*` sozinho, como antes.
    expect(sorted(await listBoard(owner, { term: term("gestão") }))).toEqual([accented]);
    expect(await countBoard(owner, { term: term("techlead") })).toBe(3);
  });

  it("IT-214b the term query can reach both trigram indexes (#214)", async () => {
    await addJob({ title: "Engineer", description: "Tech lead", page: "tech lead" });
    // Captura o SQL que o quadro realmente envia: a expressão do índice e a da
    // consulta precisam ser idênticas, e só o plano mostra se são.
    const client = db.$client as unknown as {
      unsafe: (...args: unknown[]) => Promise<unknown>;
      begin: <T>(work: (tx: { unsafe: (query: string, values?: unknown[]) => Promise<unknown> }) => Promise<T>) => Promise<T>;
    };
    const original = client.unsafe.bind(client);
    const sent: { query: string; values: unknown[] }[] = [];
    client.unsafe = (...args: unknown[]) => {
      sent.push({ query: String(args[0]), values: Array.isArray(args[1]) ? args[1] : [] });
      return original(...args);
    };
    try {
      await countBoard(owner, { term: term("techlead") });
    } finally {
      client.unsafe = original;
    }
    const counted = sent.find((statement) => statement.query.includes("ilike"));
    expect(counted).toBeDefined();
    // Com poucas linhas o planner prefere outra rota; tirá-las mostra se o
    // índice é ALCANÇÁVEL, que é o que uma divergência de expressão quebraria.
    // Os índices de `closed_at` somem só dentro da transação, desfeita no fim.
    let text = "";
    const rollback = new Error("rollback");
    await client
      .begin(async (tx) => {
        await tx.unsafe("set local enable_seqscan = off");
        await tx.unsafe("drop index production.job_closed_idx, production.job_archive_scan_idx");
        text = JSON.stringify(await tx.unsafe(`explain (format json) ${counted!.query}`, counted!.values));
        throw rollback;
      })
      .catch((error: unknown) => {
        if (error !== rollback) throw error;
      });
    expect(text).toContain("job_description_trgm_idx");
    expect(text).toContain("job_page_text_trgm_idx");
  });
});

describe("brought by a saved term", () => {
  async function phpTrack() {
    const created = await createTrack(owner, {
      name: "PHP",
      target: suggestTrack({ term: "PHP", catalog: [], primary: targetOf(await loadProfile(true)) }).target,
    });
    if (!created.ok) throw new Error(created.code);
    return created.track.id;
  }

  async function savedLaravel(): Promise<number> {
    const result = await saveTerm({ candidateId: owner }, { term: "Laravel", trackId: await phpTrack() }, {
      now: new Date(),
      impersonated: false,
    });
    if (!result.ok) throw new Error(result.code);
    return result.termId;
  }

  const view = (params: Record<string, string>, extra: Partial<Parameters<typeof loadJobsView>[0]> = {}) =>
    loadJobsView({
      candidateId: owner,
      params: { fit: "0", ...params },
      page: 1,
      pageSize: 50,
      prefetch: false,
      schedule: () => undefined,
      now: new Date(),
      ...extra,
    });

  it("IT-108 only the viewer's term narrows; a foreign or deleted id is ignored with a notice", async () => {
    const termId = await savedLaravel();
    const attributed = await addJob({ title: "Laravel Developer" });
    const other = await addJob({ title: "Go Developer" });
    await db.insert(termAttribution).values({ termKey: "laravel", jobId: attributed, platform: "remotive" });

    expect(ids((await view({ by: String(termId) })).rows)).toEqual([attributed]);

    const [stranger] = await db.insert(candidate).values({ slug: "b", name: "B" }).returning();
    await setMatchingProfile(stranger!.id, await loadProfile(true));
    const [foreign] = await db
      .insert(savedTerm)
      .values({ candidateId: stranger!.id, trackId: (await trackScope(stranger!.id, { kind: "primary" }))!.primaryTrackId, term: "Go", termKey: "go" })
      .returning();
    for (const by of [String(foreign!.id), "999999"]) {
      const result = await view({ by });
      expect(result.notices).toContain("term_unknown");
      expect(ids(result.rows).sort()).toEqual([attributed, other].sort());
    }
  });

  it("IT-109 a term that brought nothing yet shows its run state", async () => {
    const termId = await savedLaravel();
    await addJob({ title: "Laravel Developer" });

    const result = await view({ by: String(termId) });

    expect(result.rows).toHaveLength(0);
    expect(result.broughtBy).toMatchObject({ id: termId, term: "Laravel" });
    expect(result.broughtBy!.run).toBe("running");
  });

  it("IT-114 jobs first seen after the given instant are marked new", async () => {
    const before = await addJob({ title: "Laravel A", firstSeenAt: "2026-09-01T00:00:00.000Z" });
    const after = await addJob({ title: "Laravel B", firstSeenAt: "2026-09-15T00:00:00.000Z" });
    for (const jobId of [before, after]) await db.insert(termAttribution).values({ termKey: "laravel", jobId, platform: "remotive" });

    const rows = await listBoard(owner, { broughtBy: { termKey: "laravel" }, newSince: "2026-09-10T00:00:00.000Z" });

    expect(Object.fromEntries(rows.map((row) => [row.jobId, row.isNew]))).toEqual({ [before]: false, [after]: true });
  });

  it("IT-095 the visit is recorded after the render, never by a prefetch", async () => {
    const termId = await savedLaravel();
    const earlier = await addJob({ title: "Laravel A", firstSeenAt: "2026-09-01T00:00:00.000Z" });
    const later = await addJob({ title: "Laravel B", firstSeenAt: "2026-09-15T00:00:00.000Z" });
    for (const jobId of [earlier, later]) await db.insert(termAttribution).values({ termKey: "laravel", jobId, platform: "remotive" });
    await db.update(savedTerm).set({ lastVisitAt: "2026-09-10T00:00:00.000Z" });
    const lastVisit = async () => (await db.select().from(savedTerm).where(eq(savedTerm.id, termId)))[0]!.lastVisitAt;

    const prefetched: Array<() => Promise<void>> = [];
    await view({ by: String(termId) }, { prefetch: true, schedule: (task) => prefetched.push(task) });
    expect(prefetched).toHaveLength(0);
    expect(await lastVisit()).toBe("2026-09-10T00:00:00.000Z");

    const scheduled: Array<() => Promise<void>> = [];
    const now = new Date("2026-09-19T12:00:00.000Z");
    const rendered = await view({ by: String(termId) }, { schedule: (task) => scheduled.push(task), now });
    expect(Object.fromEntries(rendered.rows.map((row) => [row.jobId, row.isNew]))).toEqual({ [earlier]: false, [later]: true });
    expect(await lastVisit()).toBe("2026-09-10T00:00:00.000Z");

    await scheduled[0]!();
    expect(await lastVisit()).toBe(now.toISOString());
  });
});

describe("minimum pay and pay sort (ADR-013)", () => {
  async function paySeed() {
    await rates({ BRL: 5.0, EUR: 0.9 });
    return {
      usd: await addJob({ title: "USD monthly", compMax: 9500, cur: "USD", per: "month" }),
      brl: await addJob({ title: "BRL monthly", compMax: 38_000, cur: "BRL", per: "month" }),
      low: await addJob({ title: "USD low", compMax: 4000, cur: "USD", per: "month" }),
      undisclosed: await addJob({ title: "No pay" }),
      ars: await addJob({ title: "ARS monthly", compMax: 900_000, cur: "ARS", per: "month" }),
    };
  }

  it("IT-110 qualifying first, then the marked ones; below the minimum hidden and counted", async () => {
    const jobs = await paySeed();
    const filters: BoardFilters = { pay: { ...USD_MONTH, min: 6000 } };

    const rows = await listBoard(owner, filters);

    expect(new Set(ids(rows).slice(0, 2))).toEqual(new Set([jobs.usd, jobs.brl]));
    expect(new Set(ids(rows).slice(2))).toEqual(new Set([jobs.undisclosed, jobs.ars]));
    const byId = Object.fromEntries(rows.map((row) => [row.jobId, row]));
    expect(byId[jobs.brl]).toMatchObject({ payAmount: 7600, payState: "amount" });
    expect(byId[jobs.undisclosed]!.payState).toBe("undisclosed");
    expect(byId[jobs.ars]!.payState).toBe("not_comparable");
    expect(await countHiddenByPayRange(owner, filters)).toBe(1);
    expect(await countBoard(owner, filters)).toBe(4);

    const disclosed = await listBoard(owner, { pay: { ...USD_MONTH, min: 6000, disclosedOnly: true } });
    expect(new Set(ids(disclosed))).toEqual(new Set([jobs.usd, jobs.brl]));
  });

  it("IT-134 a ceiling hides what pays above it, and the count covers both sides", async () => {
    const jobs = await paySeed();
    // Normalizado em USD por mês: usd 9.500, brl 7.600, low 4.000.
    const range: BoardFilters = { pay: { ...USD_MONTH, min: 5000, max: 8000 } };

    const rows = await listBoard(owner, range);

    expect(ids(rows).slice(0, 1)).toEqual([jobs.brl]);
    expect(new Set(ids(rows).slice(1))).toEqual(new Set([jobs.undisclosed, jobs.ars]));
    expect(await countBoard(owner, range)).toBe(3);
    expect(await countHiddenByPayRange(owner, range)).toBe(2);

    // Só o teto: quem paga pouco continua, porque nada foi dito sobre piso.
    const capped: BoardFilters = { pay: { ...USD_MONTH, max: 8000 } };
    expect(new Set(ids(await listBoard(owner, capped)))).toEqual(
      new Set([jobs.brl, jobs.low, jobs.undisclosed, jobs.ars]),
    );
    expect(await countHiddenByPayRange(owner, capped)).toBe(1);

    // Regra 8 no teto também: salário não informado não é salário alto.
    const strict: BoardFilters = { pay: { ...USD_MONTH, max: 8000, disclosedOnly: true } };
    expect(new Set(ids(await listBoard(owner, strict)))).toEqual(new Set([jobs.brl, jobs.low]));
  });

  it("a faixa escolhe a publicação elegível do grupo; só ordenar mantém a primeira", async () => {
    await rates({ BRL: 5.0 });
    const first = await addJob({ title: "Engineer", company: "Same employer", compMax: 4000, cur: "USD", per: "month" });
    const eligible = await addJob({ title: "Engineer", company: "Same employer", compMax: 40_000, cur: "BRL", per: "month" });
    const unknown = await addJob({ title: "Other", compMax: 900_000, cur: "ARS", per: "month" });
    const range: BoardFilters = { groupRepeats: true, pay: { ...USD_MONTH, min: 6000, max: 9000 } };

    const rows = await listBoard(owner, range);
    expect(ids(rows)).toEqual([eligible, unknown]);
    expect(rows[0]).toMatchObject({ payAmount: 8000, payState: "amount" });
    expect(rows[0]!.repeats.map((posting) => posting.id)).toEqual([first, eligible]);
    expect(rows[1]).toMatchObject({ payAmount: null, payState: "not_comparable" });
    expect(await countBoard(owner, range)).toBe(2);
    expect(ids(await listBoard(owner, { ...range, pay: { ...USD_MONTH, min: 6000, max: 9000, disclosedOnly: true } }))).toEqual([eligible]);

    const sorted: BoardFilters = { groupRepeats: true, pay: USD_MONTH, sort: "comp" };
    expect(ids(await listBoard(owner, sorted))).toEqual([first, unknown]);
    expect(await countBoard(owner, sorted)).toBe(2);
  });

  it("IT-111 the SQL amount equals the TypeScript normalizer for every period", async () => {
    await rates({ BRL: 5.0 });
    const cases = [
      { compMax: 50, per: "hour" },
      { compMax: 400, per: "day" },
      { compMax: 2500, per: "week" },
      { compMax: 9000, per: "month" },
      { compMax: 150_000, per: "year" },
      { compMin: 90_000, compMax: null, per: "year" },
      { compMax: 60_000, per: "annual" },
      // Spellings only parsePeriod's fallback reads: whole word inside, `annum`.
      { compMax: 45, per: "USD/hour" },
      { compMax: 2000, per: "1 WEEK" },
      { compMax: 80_000, per: "per annum" },
      { compMax: 70_000, per: "salary (annual)" },
      { compMax: 5000, per: "fixed-price" },
    ];
    const seeded = [];
    for (const [n, entry] of cases.entries()) {
      seeded.push({ id: await addJob({ title: `Pay ${n}`, cur: n % 2 ? "BRL" : "USD", ...entry }), entry, cur: n % 2 ? "BRL" : "USD" });
    }
    const fx = { base: "USD", rates: { BRL: 5.0 }, date: "2026-09-18" };

    for (const target of [USD_MONTH, { currency: "BRL", period: "year" } as PayFilter]) {
      const rows = Object.fromEntries((await listBoard(owner, { pay: target })).map((row) => [row.jobId, row.payAmount]));
      for (const { id, entry, cur } of seeded) {
        const expected = normalizePayTop({ compMin: entry.compMin, compMax: entry.compMax, currency: cur, period: entry.per }, target, fx);
        expect(rows[id], `${entry.per} ${cur} -> ${target.currency}/${target.period}`).toBe(
          expected.kind === "amount" ? expected.amount : null,
        );
      }
    }
  });

  it("IT-112 pay sort ties break by fit, then by id, and pages stay disjoint", async () => {
    await rates({ BRL: 5.0 });
    const yearly = await addJob({ title: "Yearly", compMax: 120_000, cur: "USD", per: "year" });
    const monthly = await addJob({ title: "Monthly", compMax: 10_000, cur: "USD", per: "month" });
    const tie = await addJob({ title: "Also monthly", compMax: 10_000, cur: "USD", per: "month" });
    await score(yearly, 50);
    await score(monthly, 70);
    await score(tie, 50);
    const sorted: BoardFilters = { sort: "comp", pay: USD_MONTH };

    expect(ids(await listBoard(owner, sorted))).toEqual([monthly, yearly, tie].sort((a, b) => (a === monthly ? -1 : b === monthly ? 1 : a - b)));
    const pages = [];
    for (let offset = 0; offset < 3; offset++) pages.push(...ids(await listBoard(owner, { ...sorted, limit: 1, offset })));
    expect(new Set(pages).size).toBe(3);
  });

  it("IT-117 filtering by pay writes nothing", async () => {
    await paySeed();
    const before = [await db.select().from(jobScore), await db.select().from(savedTerm)];

    await listBoard(owner, { pay: { ...USD_MONTH, min: 6000 }, sort: "comp" });

    expect([await db.select().from(jobScore), await db.select().from(savedTerm)]).toEqual(before);
  });

  it("IT-118 the currency options are the latest quote's", async () => {
    await rates({ BRL: 5.0, EUR: 0.9, GBP: 0.8 }, "2026-09-10");
    await rates({ BRL: 5.1, EUR: 0.91 }, "2026-09-18");

    const result = await loadJobsView({
      candidateId: owner,
      params: {},
      page: 1,
      pageSize: 10,
      prefetch: false,
      schedule: () => undefined,
      now: new Date(),
    });

    expect(result.currencies).toEqual(["BRL", "EUR", "USD"]);
  });

  it("IT-119 when every match is undisclosed, all stay and each is marked", async () => {
    const first = await addJob({ title: "Quiet one" });
    const second = await addJob({ title: "Quiet two" });

    const rows = await listBoard(owner, { pay: { ...USD_MONTH, min: 6000 } });

    expect(new Set(ids(rows))).toEqual(new Set([first, second]));
    expect(rows.every((row) => row.payState === "undisclosed")).toBe(true);
  });

  it("IT-120 only disclosed pay with nothing qualifying is an empty list that keeps the minimum", async () => {
    await addJob({ title: "Quiet" });
    await addJob({ title: "Low", compMax: 1000, cur: "USD", per: "month" });

    const result = await loadJobsView({
      candidateId: owner,
      params: { fit: "0", pay: "6000", cur: "USD", per: "month", disclosed: "1" },
      page: 1,
      pageSize: 10,
      prefetch: false,
      schedule: () => undefined,
      now: new Date(),
    });

    expect(result.rows).toHaveLength(0);
    expect(result.pay).toMatchObject({ min: 6000, currency: "USD", period: "month", disclosedOnly: true });
    expect(result.hiddenByPayRange).toBe(1);
  });
});

describe("performance", () => {
  it("IT-113 term, pay, track and pay sort over 10,000 jobs answer in under 2 seconds", async () => {
    await rates({ BRL: 5.0, EUR: 0.9 });
    const [employer] = await db.insert(company).values({ slug: "bulk", name: "Bulk" }).returning();
    await db.execute(sql.raw(`
      insert into production.job (source_id, company_id, company_name, external_id, title, description_text,
        url, fingerprint, content_hash, raw, comp_max, comp_currency, comp_period)
      select 'manual:board', ${employer!.id}, 'Bulk', 'bulk-' || x,
        (array['Laravel Developer','Java Engineer','Go Engineer','Data Scientist'])[1 + x % 4],
        repeat('lorem ipsum dolor sit amet ', 75) || case when x % 7 = 0 then ' laravel' else '' end,
        'https://bulk.test/' || x, 'bulk-fp-' || x, 'bulk-h-' || x, '{}',
        case when x % 5 = 0 then null else 3000 + (x % 50) * 200 end,
        (array['USD','BRL','EUR'])[1 + x % 3],
        (array['month','year','hour'])[1 + x % 3]
      from generate_series(1, 10000) as x
    `));
    const scope = (await trackScope(owner, { kind: "all" }))!;

    const started = performance.now();
    const rows = await listBoard(owner, {
      term: term("laravel"),
      pay: { ...USD_MONTH, min: 4000 },
      track: scope,
      sort: "comp",
      limit: 50,
    });
    const elapsed = performance.now() - started;

    expect(rows.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(2000);
  }, 120_000);
});

describe("descrição mínima sem medir o texto inteiro", () => {
  // O limite é 200 caracteres, e a checagem usa `substr`, não `length`: o texto
  // vem comprimido e medir obrigava a descomprimi-lo inteiro em toda vaga aberta.
  // Estas bordas provam que as duas formas continuam dizendo a mesma coisa.
  const chars = (length: number, char = "a") => char.repeat(length);

  it("a lista, o filtro e a faceta concordam em 199 versus 200 caracteres", async () => {
    const short = await addJob({ title: "Curta", description: chars(199) });
    const exact = await addJob({ title: "Exata", description: chars(200) });
    const accented = await addJob({ title: "Acentuada", description: chars(200, "é") });
    const shortAccented = await addJob({ title: "Acentuada curta", description: chars(199, "é") });
    const empty = await addJob({ title: "Vazia", description: "" });
    const missing = await addJob({ title: "Sem texto", description: null });

    const rows = await listBoard(owner, {});
    const flag = new Map(rows.map((row) => [row.jobId, row.hasFullDescription]));
    expect(flag.get(short)).toBe(false);
    expect(flag.get(exact)).toBe(true);
    expect(flag.get(accented)).toBe(true);
    expect(flag.get(shortAccented)).toBe(false);
    expect(flag.get(empty)).toBe(false);
    expect(flag.get(missing)).toBe(false);

    expect(ids(await listBoard(owner, { hasDescription: true })).sort()).toEqual([exact, accented].sort());
    expect(await countBoard(owner, { hasDescription: true })).toBe(2);
    expect((await boardFacets(owner, {})).described).toBe(2);
  });
});
