/**
 * Turning a `RawJob` into a stable, deduplicated database row.
 *
 * The fingerprint is what makes re-running the sync safe and what collapses
 * the same posting seen through a company's own Ashby board *and* through an
 * aggregator. It deliberately excludes the source and the URL, because those
 * are exactly what differ between duplicates.
 */
import { createHash } from "node:crypto";
import type { RawJob } from "../sources/types.ts";

/** Company suffixes that add nothing and break matching across sources. */
const COMPANY_NOISE =
  /\b(inc|inc\.|llc|l\.l\.c\.|ltd|ltda|limited|corp|corporation|gmbh|s\.a\.|sa|bv|b\.v\.|plc|co|company|technologies|technology|labs|group|holdings)\b/gi;

/** Title decorations that vary between boards for the same role. */
const TITLE_NOISE =
  /\((remote|hybrid|onsite|on-site|contract|contractor|full[- ]time|part[- ]time|us|usa|emea|latam|brazil|canada|uk|europe)[^)]*\)|\b(w\/m\/d|m\/f\/d|m\/w\/d|f\/m\/x|all genders)\b|#\d+|\bjob id[: ]*\w+/gi;

export function slugifyCompany(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(COMPANY_NOISE, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(TITLE_NOISE, " ")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Collapses "Remote - LATAM", "LATAM (Remote)" and "latam remote" together. */
export function normalizeLocation(location: string | null | undefined): string {
  if (!location) return "";
  return location
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");
}

/**
 * Identity of a posting, independent of where we found it.
 *
 * Location is included because large companies genuinely open the same title
 * in several regions and only some of them are reachable from Brazil.
 */
export function fingerprint(raw: RawJob): string {
  const parts = [
    slugifyCompany(raw.companyName),
    normalizeTitle(raw.title),
    normalizeLocation(raw.locationRaw),
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

/** Changes to these fields mean the posting was edited and is worth re-reading. */
export function contentHash(raw: RawJob): string {
  const parts = [
    raw.title,
    raw.locationRaw ?? "",
    raw.employmentType ?? "",
    String(raw.compMin ?? ""),
    String(raw.compMax ?? ""),
    (raw.descriptionText ?? "").slice(0, 4000),
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

/** Best-effort ISO date; sources disagree wildly on format. */
export function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}
