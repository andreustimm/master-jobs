/**
 * The queue language, independent of how tasks are persisted.
 *
 * Keeping these values outside the Drizzle schema matters: workers and future
 * adapters (for example Upstash) share the state machine without depending on
 * SQLite or on a particular ORM representation.
 */
export const SCRAPE_STATUSES = [
  "pending",
  "fetching",
  "fetched",
  "parsing",
  "done",
  "failed",
  "blocked",
] as const;

export type ScrapeStatus = (typeof SCRAPE_STATUSES)[number];

/** States from which one of the two workers may claim a task. */
export type ClaimableScrapeStatus = Extract<ScrapeStatus, "pending" | "fetched">;
