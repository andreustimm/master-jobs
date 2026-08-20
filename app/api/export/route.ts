import { listBoard } from "../../../src/contexts/matching/index.ts";
import { scoreMessages } from "../../../src/contexts/matching/index.ts";
import { renderScoreMessage } from "../../../src/core/i18n/index.ts";
import { requireOwnCandidatePage } from "../../auth";
import { readFilters, toBoardFilters } from "../../filters";
import { getTranslator } from "../../i18n";

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
  // Middleware only proves that a cookie exists. Resolve it here before this
  // endpoint reads the complete corpus and the private funnel into one CSV.
  const { candidateId } = await requireOwnCandidatePage("candidate:read");
  const { t } = await getTranslator();

  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const filters = toBoardFilters(readFilters(params));
  const rows = await listBoard(candidateId, { ...filters, limit: 5000 });

  const lines = [COLUMNS.join(",")];
  for (const r of rows) {
    const blockers = scoreMessages(r.blockers).map((blocker) => renderScoreMessage(blocker, t));
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
