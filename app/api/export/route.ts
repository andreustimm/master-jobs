import { listBoard } from "../../../src/core/db/repo.ts";
import { readFilters, toBoardFilters } from "../../filters";

export const dynamic = "force-dynamic";

/** RFC 4180: quote everything, double any embedded quote. */
function cell(value: unknown): string {
  const s = value == null ? "" : String(value);
  return `"${s.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
}

const COLUMNS = [
  "id",
  "fit",
  "cluster",
  "empresa",
  "cargo",
  "local",
  "salario",
  "moeda",
  "periodo",
  "publicada",
  "fonte",
  "status",
  "bloqueios",
  "url",
  "aplicar",
] as const;

/**
 * Export exactly what the current filters produced.
 *
 * Reads the same query string the page reads, through the same parser, so a
 * CSV can never disagree with the list the user was looking at.
 */
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const filters = toBoardFilters(readFilters(params));
  const rows = await listBoard({ ...filters, limit: 5000 });

  const lines = [COLUMNS.join(",")];
  for (const r of rows) {
    const blockers = Array.isArray(r.blockers) ? (r.blockers as string[]) : [];
    lines.push(
      [
        r.jobId,
        r.fit?.toFixed(1) ?? "",
        r.cluster ?? "",
        r.companyName,
        r.title,
        r.locationRaw ?? "",
        r.compMax ?? r.compMin ?? "",
        r.compCurrency ?? "",
        r.compPeriod ?? "",
        r.postedAt?.slice(0, 10) ?? "",
        r.sourceId,
        r.status ?? "",
        blockers.join("; "),
        r.url,
        r.applyUrl ?? "",
      ]
        .map(cell)
        .join(","),
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  return new Response(`﻿${lines.join("\n")}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="vagas-${today}.csv"`,
    },
  });
}
