/**
 * job-hunt-os data model.
 *
 * Design rules:
 *  - `job` rows are immutable facts observed from a source; anything the user
 *    decides lives in `application` so re-ingesting never destroys decisions.
 *  - Every job carries a stable `fingerprint` so the same posting seen through
 *    two sources (e.g. the company's Ashby board and Himalayas) collapses.
 *  - Scores are derived and versioned, so the scorer can be rerun freely.
 *  - Nothing here stores LinkedIn session material. See docs/linkedin-policy.md.
 */
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

/* -------------------------------------------------------------------------- */
/* Sourcing                                                                    */
/* -------------------------------------------------------------------------- */

/** One configured feed: an ATS board, an aggregator, or a manual import. */
export const source = sqliteTable(
  "source",
  {
    id: text("id").primaryKey(), // "greenhouse:stripe"
    kind: text("kind").notNull(), // greenhouse | lever | ashby | smartrecruiters | workable | himalayas | remotive | arbeitnow | remoteok | adzuna | manual
    handle: text("handle").notNull(), // board token / company slug / query
    label: text("label").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    /** Why this source is on the list — keeps the config self-documenting. */
    rationale: text("rationale"),
    lastSyncedAt: text("last_synced_at"),
    lastStatus: text("last_status"), // ok | error
    lastError: text("last_error"),
    lastJobCount: integer("last_job_count"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("source_kind_handle_idx").on(t.kind, t.handle)],
);

/** Companies, deduplicated across sources, plus contractor-eligibility facts. */
export const company = sqliteTable(
  "company",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    website: text("website"),
    careersUrl: text("careers_url"),
    /** null = unknown. Set by research, never guessed by the ingester. */
    hiresContractors: integer("hires_contractors", { mode: "boolean" }),
    hiresLatam: integer("hires_latam", { mode: "boolean" }),
    /** Was this company reached through BairesDev? Feeds the markup hypothesis. */
    viaAgency: text("via_agency"),
    notes: text("notes"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("company_slug_idx").on(t.slug)],
);

/** A job posting as observed. Re-ingest updates lastSeenAt, never user state. */
export const job = sqliteTable(
  "job",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** sha256 over (companySlug, normalizedTitle, normalizedLocation). */
    fingerprint: text("fingerprint").notNull(),
    /** sha256 over the meaningful content — detects edits to a live posting. */
    contentHash: text("content_hash").notNull(),
    sourceId: text("source_id")
      .notNull()
      .references(() => source.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    companyId: integer("company_id").references(() => company.id),
    companyName: text("company_name").notNull(),
    title: text("title").notNull(),
    descriptionHtml: text("description_html"),
    descriptionText: text("description_text"),
    locationRaw: text("location_raw"),
    /** null = the posting does not say. */
    remote: integer("remote", { mode: "boolean" }),
    employmentType: text("employment_type"), // full-time | contract | ...
    seniorityRaw: text("seniority_raw"),
    compMin: integer("comp_min"),
    compMax: integer("comp_max"),
    compCurrency: text("comp_currency"),
    compPeriod: text("comp_period"), // year | month | hour
    url: text("url").notNull(),
    applyUrl: text("apply_url"),
    postedAt: text("posted_at"),
    firstSeenAt: text("first_seen_at").notNull().default(now),
    lastSeenAt: text("last_seen_at").notNull().default(now),
    /** Set when a previously seen posting disappears from its source. */
    closedAt: text("closed_at"),
    raw: text("raw", { mode: "json" }).notNull(),
  },
  (t) => [
    uniqueIndex("job_fingerprint_idx").on(t.fingerprint),
    index("job_source_idx").on(t.sourceId),
    index("job_company_idx").on(t.companyName),
    index("job_last_seen_idx").on(t.lastSeenAt),
    index("job_closed_idx").on(t.closedAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Scoring (derived — safe to wipe and recompute)                              */
/* -------------------------------------------------------------------------- */

export const jobScore = sqliteTable(
  "job_score",
  {
    jobId: integer("job_id")
      .primaryKey()
      .references(() => job.id, { onDelete: "cascade" }),
    /** 0..100 overall fit. */
    fit: real("fit").notNull(),
    titleScore: real("title_score").notNull(),
    keywordScore: real("keyword_score").notNull(),
    seniorityScore: real("seniority_score").notNull(),
    geoScore: real("geo_score").notNull(),
    compScore: real("comp_score").notNull(),
    /** Negative points from disqualifiers (on-site only, visa required, ...). */
    penalty: real("penalty").notNull().default(0),
    /** architect | staff | ai-lead | backend | other — drives CV variant choice. */
    cluster: text("cluster").notNull(),
    matchedKeywords: text("matched_keywords", { mode: "json" }).notNull(),
    missingKeywords: text("missing_keywords", { mode: "json" }).notNull(),
    /** Human-readable justification lines, for the UI and for agent review. */
    reasons: text("reasons", { mode: "json" }).notNull(),
    /** Hard blockers found in the text, e.g. "requires US work authorization". */
    blockers: text("blockers", { mode: "json" }).notNull(),
    scorerVersion: text("scorer_version").notNull(),
    scoredAt: text("scored_at").notNull().default(now),
  },
  (t) => [index("job_score_fit_idx").on(t.fit)],
);

/* -------------------------------------------------------------------------- */
/* Application pipeline (user-owned state — never touched by ingestion)         */
/* -------------------------------------------------------------------------- */

export const APPLICATION_STATUSES = [
  "backlog",
  "shortlisted",
  "preparing",
  "applied",
  "screening",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
  "archived",
] as const;

export const application = sqliteTable(
  "application",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: integer("job_id")
      .notNull()
      .references(() => job.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("backlog"),
    /** direct | ats | referral | recruiter | agency */
    channel: text("channel"),
    appliedAt: text("applied_at"),
    /** Which tailored CV went out — ties back to profile/variants. */
    cvVariant: text("cv_variant"),
    coverLetterPath: text("cover_letter_path"),
    contactName: text("contact_name"),
    contactUrl: text("contact_url"),
    /** Salary or rate actually discussed. */
    rateDiscussed: text("rate_discussed"),
    nextAction: text("next_action"),
    nextActionAt: text("next_action_at"),
    notes: text("notes"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("application_job_idx").on(t.jobId),
    index("application_status_idx").on(t.status),
    index("application_next_action_idx").on(t.nextActionAt),
  ],
);

/** Append-only history so the funnel metrics are reconstructable. */
export const applicationEvent = sqliteTable(
  "application_event",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    applicationId: integer("application_id")
      .notNull()
      .references(() => application.id, { onDelete: "cascade" }),
    at: text("at").notNull().default(now),
    kind: text("kind").notNull(), // status_change | note | email | interview | followup
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    detail: text("detail"),
  },
  (t) => [index("application_event_app_idx").on(t.applicationId)],
);

/* -------------------------------------------------------------------------- */
/* LinkedIn positioning                                                        */
/* -------------------------------------------------------------------------- */

/** Content drafts. Published through the official w_member_social API only. */
export const post = sqliteTable(
  "post",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    slug: text("slug").notNull(),
    /** Maps to the content pillars in section 13.2 of the positioning audit. */
    pillar: text("pillar").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    lang: text("lang").notNull().default("en"),
    status: text("status").notNull().default("draft"), // draft | ready | published | archived
    scheduledFor: text("scheduled_for"),
    publishedAt: text("published_at"),
    /** URN returned by the LinkedIn Posts API, e.g. urn:li:share:123. */
    linkedinUrn: text("linkedin_urn"),
    impressions: integer("impressions"),
    reactions: integer("reactions"),
    commentCount: integer("comment_count"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [uniqueIndex("post_slug_idx").on(t.slug)],
);

/**
 * Assisted engagement queue.
 *
 * Rows here are NEVER executed automatically. The agent drafts, the human
 * opens the URL and acts. This is the deliberate boundary that keeps the
 * account inside the LinkedIn User Agreement.
 */
export const engagement = sqliteTable(
  "engagement",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind").notNull(), // comment | connect | follow | message | endorse
    targetUrl: text("target_url").notNull(),
    targetName: text("target_name"),
    targetRole: text("target_role"),
    targetCompany: text("target_company"),
    /** Why this target matters — keeps the queue from becoming spray-and-pray. */
    rationale: text("rationale"),
    draft: text("draft"),
    status: text("status").notNull().default("queued"), // queued | done | skipped
    queuedFor: text("queued_for"),
    doneAt: text("done_at"),
    outcome: text("outcome"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("engagement_status_idx").on(t.status, t.queuedFor)],
);

/** The 30 target accounts from section 2.2 of the audit. */
export const targetAccount = sqliteTable(
  "target_account",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    linkedinUrl: text("linkedin_url"),
    category: text("category").notNull(), // recruiter | ai-leader | peer | company
    company: text("company"),
    role: text("role"),
    country: text("country"),
    status: text("status").notNull().default("identified"), // identified | following | engaged | connected | conversing
    lastTouchAt: text("last_touch_at"),
    notes: text("notes"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("target_account_url_idx").on(t.linkedinUrl)],
);

/** Manually recorded funnel metrics — SSI, search appearances, profile views. */
export const metricSnapshot = sqliteTable(
  "metric_snapshot",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    at: text("at").notNull(),
    key: text("key").notNull(),
    value: real("value").notNull(),
    note: text("note"),
  },
  (t) => [uniqueIndex("metric_at_key_idx").on(t.at, t.key)],
);

/** The action plan from section 14, as executable rows. */
export const positioningTask = sqliteTable("positioning_task", {
  id: text("id").primaryKey(), // PT-0001
  horizon: text("horizon").notNull(), // 24h | week | 30d | 60d | 90d
  title: text("title").notNull(),
  why: text("why"),
  how: text("how"),
  expected: text("expected"),
  priority: text("priority").notNull(), // P0 | P1 | P2 | P3
  effort: text("effort"),
  status: text("status").notNull().default("todo"), // todo | doing | done | skipped
  doneAt: text("done_at"),
  /** Pointer back into the audit, e.g. "§14 Primeiras 24 horas". */
  sourceRef: text("source_ref"),
  createdAt: text("created_at").notNull().default(now),
});

/* -------------------------------------------------------------------------- */
/* Foreign exchange                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Cached exchange rates.
 *
 * Rates are stored rather than fetched per score for two reasons: the scorer
 * must stay pure and offline, and a score has to remain reproducible — knowing
 * only that a job "was above the floor" is useless without the rate that made
 * it so.
 */
export const fxRate = sqliteTable(
  "fx_rate",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Quote date as published by the provider, not the fetch time. */
    date: text("date").notNull(),
    base: text("base").notNull(),
    currency: text("currency").notNull(),
    /** 1 unit of `base` buys `rate` units of `currency`. */
    rate: real("rate").notNull(),
    provider: text("provider").notNull(), // frankfurter | erapi | manual
    fetchedAt: text("fetched_at").notNull().default(now),
  },
  (t) => [uniqueIndex("fx_rate_unique_idx").on(t.date, t.base, t.currency)],
);

/* -------------------------------------------------------------------------- */
/* Inferred types                                                              */
/* -------------------------------------------------------------------------- */

export type Source = typeof source.$inferSelect;
export type NewSource = typeof source.$inferInsert;
export type Job = typeof job.$inferSelect;
export type NewJob = typeof job.$inferInsert;
export type JobScore = typeof jobScore.$inferSelect;
export type Application = typeof application.$inferSelect;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export type Post = typeof post.$inferSelect;
export type Engagement = typeof engagement.$inferSelect;
export type PositioningTask = typeof positioningTask.$inferSelect;
export type FxRate = typeof fxRate.$inferSelect;
export type NewPositioningTask = typeof positioningTask.$inferInsert;
export type NewTargetAccount = typeof targetAccount.$inferInsert;
export type MetricSnapshot = typeof metricSnapshot.$inferSelect;
