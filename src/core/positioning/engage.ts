/**
 * The assisted engagement queue.
 *
 * This is the other half of ADR 0001. Refusing to scrape LinkedIn only works as
 * a decision if the alternative actually exists: the agent drafts, the human
 * acts. Until now the table existed and nothing wrote to it, which meant the
 * ADR was promising something the code did not deliver.
 *
 * > **Invariante:** nothing here is ever executed automatically. A row is a
 * > draft plus a URL. The human opens the link and acts. The moment software
 * > posts a comment or sends an invitation, we are inside §8.2 item 13 and the
 * > whole policy collapses.
 *
 * The audit is specific about what makes engagement work: two substantive
 * comments per weekday on 30 target accounts, where substantive means adding
 * architecture, a trade-off, a risk or an example. "Great post" does not count
 * and actively dilutes — which is why every queued row carries a rationale.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { engagement, metricSnapshot, post, targetAccount } from "../db/schema.ts";

export const ENGAGEMENT_KINDS = ["comment", "connect", "follow", "message", "endorse"] as const;
export type EngagementKind = (typeof ENGAGEMENT_KINDS)[number];

export type NewEngagement = {
  kind: EngagementKind;
  targetUrl: string;
  targetName?: string | null;
  targetRole?: string | null;
  targetCompany?: string | null;
  /** Why this target matters — what keeps the queue from becoming spray-and-pray. */
  rationale?: string | null;
  draft?: string | null;
  queuedFor?: string | null;
};

export async function queueEngagement(input: NewEngagement): Promise<number> {
  const db = getDb();
  const rows = await db
    .insert(engagement)
    .values({
      kind: input.kind,
      targetUrl: input.targetUrl,
      targetName: input.targetName ?? null,
      targetRole: input.targetRole ?? null,
      targetCompany: input.targetCompany ?? null,
      rationale: input.rationale ?? null,
      draft: input.draft ?? null,
      queuedFor: input.queuedFor ?? new Date().toISOString().slice(0, 10),
      status: "queued",
    })
    .returning({ id: engagement.id });
  const row = rows[0];
  if (!row) throw new Error("insert returned no row");
  return row.id;
}

/** What to do today, oldest first — a queue, not a pile. */
export async function pendingEngagements(limit = 20) {
  const db = getDb();
  return db
    .select()
    .from(engagement)
    .where(eq(engagement.status, "queued"))
    .orderBy(engagement.queuedFor, engagement.id)
    .limit(limit);
}

export async function markEngagement(
  id: number,
  status: "done" | "skipped",
  outcome?: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(engagement)
    .set({ status, doneAt: new Date().toISOString(), outcome: outcome ?? null })
    .where(eq(engagement.id, id));
}

/** Cadence check: the audit asks for 2 substantive comments per weekday. */
export async function engagementStats(days = 7) {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = await db
    .select({ kind: engagement.kind, status: engagement.status, n: sql<number>`count(*)` })
    .from(engagement)
    .where(sql`${engagement.doneAt} >= ${cutoff} or ${engagement.status} = 'queued'`)
    .groupBy(engagement.kind, engagement.status);
  return rows;
}

/* -------------------------------------------------------------------------- */
/* Content                                                                     */
/* -------------------------------------------------------------------------- */

/** Content pillars from §13.2 of the positioning audit. */
export const PILLARS = {
  "production-ai": "O trabalho começa depois do protótipo: evals, segurança, custo, fallback",
  agentic: "Agentes precisam de isolamento, contexto e auditabilidade antes de mais agentes",
  "saas-arch": "Multi-tenancy e evolução de plataforma exigem decisão explícita",
  modernization: "Legado evolui sem big-bang rewrite",
  "data-rag": "Qualidade de retrieval depende do pipeline, não do modelo",
  leadership: "Staff+ transforma ambiguidade em direção",
} as const;

export async function draftPost(input: {
  slug: string;
  pillar: keyof typeof PILLARS;
  title: string;
  body: string;
  lang?: string;
}): Promise<number> {
  const db = getDb();
  const rows = await db
    .insert(post)
    .values({
      slug: input.slug,
      pillar: input.pillar,
      title: input.title,
      body: input.body,
      lang: input.lang ?? "en",
      status: "draft",
    })
    .onConflictDoUpdate({
      target: post.slug,
      set: {
        title: input.title,
        body: input.body,
        pillar: input.pillar,
        updatedAt: new Date().toISOString(),
      },
    })
    .returning({ id: post.id });
  const row = rows[0];
  if (!row) throw new Error("insert returned no row");
  return row.id;
}

export async function listPosts(status?: string) {
  const db = getDb();
  const rows = await db.select().from(post).orderBy(desc(post.updatedAt));
  return status ? rows.filter((r) => r.status === status) : rows;
}

export async function markPublished(slug: string, urn?: string): Promise<void> {
  const db = getDb();
  await db
    .update(post)
    .set({
      status: "published",
      publishedAt: new Date().toISOString(),
      linkedinUrn: urn ?? null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(post.slug, slug));
}

/* -------------------------------------------------------------------------- */
/* Metrics                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Record a funnel metric by hand.
 *
 * There is no API for any of these — SSI, search appearances, profile views are
 * all read off the LinkedIn UI. That is a consequence of ADR 0001, not an
 * oversight, and recording them manually is the honest cost of not scraping.
 */
export async function recordMetric(
  key: string,
  value: number,
  opts: { at?: string; note?: string } = {},
): Promise<void> {
  const db = getDb();
  const at = opts.at ?? new Date().toISOString().slice(0, 10);
  await db
    .insert(metricSnapshot)
    .values({ at, key, value, note: opts.note ?? null })
    .onConflictDoUpdate({
      target: [metricSnapshot.at, metricSnapshot.key],
      set: { value, note: opts.note ?? null },
    });
}

/** Every metric with its baseline and latest reading, for the trend view. */
export async function metricTrend() {
  const db = getDb();
  const rows = await db
    .select()
    .from(metricSnapshot)
    .orderBy(metricSnapshot.key, metricSnapshot.at);

  const byKey = new Map<string, { at: string; value: number }[]>();
  for (const r of rows) {
    byKey.set(r.key, [...(byKey.get(r.key) ?? []), { at: r.at, value: r.value }]);
  }

  return [...byKey.entries()].map(([key, series]) => {
    const first = series[0]!;
    const last = series[series.length - 1]!;
    return {
      key,
      baseline: first.value,
      baselineAt: first.at,
      latest: last.value,
      latestAt: last.at,
      delta: series.length > 1 ? last.value - first.value : null,
      readings: series.length,
    };
  });
}

/** Target accounts that have never been engaged — the audit's §2.2 gap. */
export async function coldTargets(limit = 20) {
  const db = getDb();
  return db
    .select()
    .from(targetAccount)
    .where(and(eq(targetAccount.status, "identified"), sql`${targetAccount.linkedinUrl} is not null`))
    .limit(limit);
}
