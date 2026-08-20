/**
 * Importing jobs from a JSON payload the user captured by hand.
 *
 * Why this exists: some platforms (Revelo, BairesDev, most talent marketplaces)
 * only serve jobs inside an authenticated session. There is no public adapter
 * to write — see docs/sources-autenticadas.md — and persisting an SSO token is
 * exactly what ADR 0001 refused. So the human authenticates, copies the payload
 * the page already fetched, and this turns it into normal rows.
 *
 * Deliberately format-agnostic: every marketplace names its fields differently,
 * and hard-coding one shape would mean a new parser per platform. Instead we
 * look for the field names that actually appear across these APIs and report
 * honestly what could not be mapped.
 */
import { readFile } from "node:fs/promises";
import type { RawJob } from "../sources/types.ts";
import { htmlToText } from "../sources/http.ts";

/** Field aliases observed across marketplace payloads, best candidate first. */
const FIELDS = {
  id: ["id", "uuid", "positionId", "jobId", "slug", "externalId"],
  title: ["title", "name", "position", "positionTitle", "roleTitle", "jobTitle"],
  company: ["companyName", "company", "employer", "organization", "clientName", "account"],
  description: [
    "description",
    "descriptionHtml",
    "jobDescription",
    "details",
    "summary",
    "requirements",
    "body",
  ],
  location: ["location", "locationName", "city", "region", "country", "workplace"],
  url: ["url", "link", "applyUrl", "jobUrl", "permalink", "applicationUrl"],
  postedAt: ["publishedAt", "createdAt", "postedAt", "date", "published_date", "openedAt"],
  compMin: ["salaryMin", "minSalary", "compensationMin", "salary_from", "minimumSalary"],
  compMax: ["salaryMax", "maxSalary", "compensationMax", "salary_to", "maximumSalary"],
  currency: ["currency", "salaryCurrency", "compensationCurrency", "currencyCode"],
  period: ["salaryPeriod", "period", "compensationPeriod", "payPeriod", "rateType"],
} as const;

function pick(obj: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const k of keys) {
    // Case-insensitive: APIs disagree on camelCase vs snake_case.
    const match = Object.keys(obj).find((o) => o.toLowerCase() === k.toLowerCase());
    if (match !== undefined) {
      const v = obj[match];
      if (v !== null && v !== undefined && v !== "") return v;
    }
  }
  return undefined;
}

function asString(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  // Nested objects are common: { location: { name: "Remote" } }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["name", "label", "title", "value", "displayName"]) {
      if (typeof o[k] === "string") return (o[k] as string).trim() || null;
    }
  }
  return null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) && n !== 0 ? n : null;
  }
  return null;
}

/** Find the array of jobs, whatever the envelope is called. */
function extractArray(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (payload && typeof payload === "object") {
    const o = payload as Record<string, unknown>;
    for (const key of ["positions", "jobs", "data", "results", "content", "items", "records"]) {
      if (Array.isArray(o[key])) return o[key] as Record<string, unknown>[];
    }
    // Some APIs nest one level deeper: { data: { positions: [...] } }
    for (const v of Object.values(o)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const nested = extractArray(v);
        if (nested.length > 0) return nested;
      }
    }
  }
  return [];
}

export type ImportResult = {
  jobs: RawJob[];
  /** Entries dropped because they had no usable title. */
  skipped: number;
  /** Field names present in the payload that we did not map — useful feedback. */
  unmappedFields: string[];
  warnings: string[];
};

export function parsePayload(
  payload: unknown,
  opts: { company?: string; baseUrl?: string } = {},
): ImportResult {
  const entries = extractArray(payload);
  const warnings: string[] = [];
  const jobs: RawJob[] = [];
  let skipped = 0;

  if (entries.length === 0) {
    return {
      jobs: [],
      skipped: 0,
      unmappedFields: [],
      warnings: ["Nenhum array de vagas encontrado no JSON."],
    };
  }

  const known = new Set(Object.values(FIELDS).flat().map((f) => f.toLowerCase()));
  const seenFields = new Set<string>();

  for (const entry of entries) {
    for (const k of Object.keys(entry)) seenFields.add(k);

    const title = asString(pick(entry, FIELDS.title));
    if (!title) {
      skipped++;
      continue;
    }

    const id = asString(pick(entry, FIELDS.id)) ?? title;
    const rawUrl = asString(pick(entry, FIELDS.url));
    const url = rawUrl ?? (opts.baseUrl ? `${opts.baseUrl.replace(/\/$/, "")}/${id}` : null);
    if (!url) {
      skipped++;
      continue;
    }

    const descRaw = asString(pick(entry, FIELDS.description));
    const company =
      asString(pick(entry, FIELDS.company)) ?? opts.company ?? "Desconhecida";

    jobs.push({
      externalId: id,
      companyName: company,
      title,
      url,
      applyUrl: url,
      locationRaw: asString(pick(entry, FIELDS.location)),
      remote: null,
      descriptionHtml: descRaw && /<[a-z]/i.test(descRaw) ? descRaw : null,
      descriptionText: descRaw ? (htmlToText(descRaw) ?? descRaw) : null,
      postedAt: asString(pick(entry, FIELDS.postedAt)),
      compMin: asNumber(pick(entry, FIELDS.compMin)),
      compMax: asNumber(pick(entry, FIELDS.compMax)),
      compCurrency: asString(pick(entry, FIELDS.currency)),
      compPeriod: asString(pick(entry, FIELDS.period)),
      raw: entry,
    });
  }

  const unmappedFields = [...seenFields].filter((f) => !known.has(f.toLowerCase())).sort();

  if (skipped > 0) {
    warnings.push(`${skipped} entrada(s) ignorada(s) por falta de título ou URL.`);
  }
  if (jobs.length > 0 && jobs.every((j) => !j.descriptionText)) {
    warnings.push(
      "Nenhuma vaga trouxe descrição — o score de keywords ficará em zero. Verifique se o payload é da listagem (resumida) em vez do detalhe.",
    );
  }

  return { jobs, skipped, unmappedFields, warnings };
}

export async function parseFile(
  path: string,
  opts: { company?: string; baseUrl?: string } = {},
): Promise<ImportResult> {
  const text = await readFile(path, "utf8");
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${path} não é JSON válido: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parsePayload(payload, opts);
}

/* -------------------------------------------------------------------------- */
/* Persistence                                                                 */
/* -------------------------------------------------------------------------- */

import { ensureImportSource } from "./manual.ts";
import { observeRawJob } from "./observe.ts";

export type ImportRunResult = ImportResult & {
  inserted: number;
  unchanged: number;
  changed: number;
  reopened: number;
  /** Compatibility aggregate: every observation that was not inserted. */
  updated: number;
  jobIds: number[];
};

/**
 * Persist a parsed payload under an explicit source id.
 *
 * The source is created disabled: `jobs sync` must never try to fetch it,
 * because there is nothing public to fetch.
 */
export async function importJobs(
  result: ImportResult,
  opts: { sourceKey: string; label: string },
): Promise<ImportRunResult> {
  const sourceId = `manual:${opts.sourceKey}`;
  await ensureImportSource(sourceId, "manual", opts.sourceKey, opts.label);

  let inserted = 0;
  let unchanged = 0;
  let changed = 0;
  let reopened = 0;
  let updated = 0;
  const jobIds: number[] = [];

  for (const raw of result.jobs) {
    const observation = await observeRawJob(raw, sourceId);
    jobIds.push(observation.jobId);
    if (observation.outcome === "inserted") inserted++;
    else updated++;
    if (observation.outcome === "unchanged") unchanged++;
    if (observation.outcome === "changed") changed++;
    if (observation.outcome === "reopened") reopened++;
  }

  return { ...result, inserted, unchanged, changed, reopened, updated, jobIds };
}
