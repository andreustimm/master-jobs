/**
 * Markdown export back into the Obsidian vault.
 *
 * The database is the source of truth, but the vault is where the user
 * actually reads and thinks, so every run leaves a readable snapshot there.
 */
import {
  listBoard,
  scoreMessages,
  type BoardRow,
} from "../../contexts/matching/index.ts";
import { getJobDetail, pipelineCounts } from "../../contexts/pursuit/index.ts";
import { renderScoreMessage, translator } from "../i18n/index.ts";
import {
  isPublicJobUrl,
  publicApplyUrl,
  publicPostingUrl,
} from "../job-url.ts";

function esc(text: string | null | undefined): string {
  return (text ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

export type ReportOptions = {
  minFit?: number;
  limit?: number;
};

export type ReportRow = Pick<
  BoardRow,
  | "fit"
  | "cluster"
  | "companyName"
  | "title"
  | "locationRaw"
  | "blockers"
  | "url"
  | "applyUrl"
  | "status"
  | "appliedAt"
>;

export function renderBoardMarkdown(input: {
  rows: ReportRow[];
  counts: Record<string, number>;
  today: string;
  minFit: number;
}): string {
  const { rows, counts, today, minFit } = input;
  const t = translator("pt-BR").t;
  const open = rows.filter((r) => !r.status || r.status === "backlog");
  const tracked = rows.filter((r) => r.status && r.status !== "backlog");
  const lines: string[] = [];
  lines.push(`# Vagas — match com o perfil (${today})`, "");
  lines.push("> Gerado por `job-hunt-os`. Fontes: APIs públicas de ATS e agregadores remotos.");
  lines.push(`> Corte de fit: ${minFit}. Vagas listadas: ${rows.length}.`, "");
  lines.push("## Funil", "", "| Status | Quantidade |", "|---|---:|");
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) lines.push("| _(nenhuma candidatura registrada)_ | 0 |");
  for (const [status, n] of entries) lines.push(`| ${status} | ${n} |`);
  lines.push("", "## Novas oportunidades", "");
  lines.push("| Fit | Cluster | Empresa | Vaga | Local | Bloqueios | Link |");
  lines.push("|---:|---|---|---|---|---|---|");
  for (const row of open) {
    const blockers = scoreMessages(row.blockers).map((blocker) => renderScoreMessage(blocker, t));
    const externalUrl = publicApplyUrl(row);
    lines.push(
      `| ${row.fit?.toFixed(0) ?? "—"} | ${row.cluster ?? "—"} | ${esc(row.companyName)} | ${esc(row.title)} | ${esc(row.locationRaw)} | ${blockers.length ? esc(blockers.join("; ")) : "—"} | ${externalUrl ? `[aplicar](${externalUrl})` : "—"} |`,
    );
  }
  if (open.length === 0) {
    lines.push("| — | — | — | _nenhuma vaga nova acima do corte_ | — | — | — |");
  }
  lines.push("");
  if (tracked.length > 0) {
    lines.push("## Em andamento", "", "| Status | Fit | Empresa | Vaga | Aplicado em | Link |");
    lines.push("|---|---:|---|---|---|---|");
    for (const row of tracked) {
      const externalUrl = publicPostingUrl(row) ?? publicApplyUrl(row);
      lines.push(
        `| ${row.status} | ${row.fit?.toFixed(0) ?? "—"} | ${esc(row.companyName)} | ${esc(row.title)} | ${row.appliedAt?.slice(0, 10) ?? "—"} | ${externalUrl ? `[vaga](${externalUrl})` : "—"} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

export async function buildReport(
  candidateId: number,
  opts: ReportOptions = {},
): Promise<{ markdown: string }> {
  const minFit = opts.minFit ?? 45;
  const rows = await listBoard(candidateId, { minFit, limit: opts.limit ?? 100 });
  const counts = await pipelineCounts(candidateId);
  const today = new Date().toISOString().slice(0, 10);
  return { markdown: renderBoardMarkdown({ rows, counts, today, minFit }) };
}

/* -------------------------------------------------------------------------- */
/* Offline dossiers                                                            */
/* -------------------------------------------------------------------------- */

import { slugifyCompany } from "../ingest/normalize.ts";

/**
 * Write one markdown file per job into the Obsidian vault.
 *
 * The descriptions are already offline — they have been in `job.description_text`
 * since the first sync, which is why the database is 127 MB. What was missing is
 * a way to *read* them where the user actually thinks. A dossier in the vault
 * can be annotated, linked to the CV, and searched next to the positioning
 * audit, none of which a terminal pager allows.
 */
export async function exportDossiers(candidateId: number, opts: {
  minFit?: number;
  limit?: number;
  onlyTracked?: boolean;
} = {}): Promise<{ documents: Array<{ name: string; markdown: string }> }> {
  const t = translator("pt-BR").t;

  let rows = await listBoard(candidateId, { minFit: opts.minFit ?? 60, limit: opts.limit ?? 50 });
  if (opts.onlyTracked) rows = rows.filter((r) => r.status !== null);

  const documents: Array<{ name: string; markdown: string }> = [];
  for (const row of rows) {
    const detail = await getJobDetail(candidateId, row.jobId);
    if (!detail) continue;
    const { job, score, application } = detail;

    const blockers = scoreMessages(score?.blockers).map((blocker) => renderScoreMessage(blocker, t));
    const matched = (score?.matchedKeywords as string[]) ?? [];
    const reasons = scoreMessages(score?.reasons).map((reason) => renderScoreMessage(reason, t));
    const postingUrl = publicPostingUrl(job);
    const applyUrl = isPublicJobUrl(job.applyUrl) ? job.applyUrl : null;
    const externalUrl = postingUrl ?? applyUrl;

    // Obsidian reads frontmatter, so the numbers become queryable in the vault.
    const front = [
      "---",
      `titulo: "${job.title.replace(/"/g, "'")}"`,
      `empresa: "${job.companyName.replace(/"/g, "'")}"`,
      `fit: ${score?.fit ?? ""}`,
      `cluster: ${score?.cluster ?? ""}`,
      `status: ${application?.status ?? "não triada"}`,
      `local: "${(job.locationRaw ?? "").replace(/"/g, "'")}"`,
      `fonte: ${job.sourceId}`,
      `publicada: ${job.postedAt?.slice(0, 10) ?? ""}`,
      `url: ${externalUrl ?? ""}`,
      blockers.length ? `bloqueios: [${blockers.map((b) => `"${b}"`).join(", ")}]` : "bloqueios: []",
      "tags: [vaga]",
      "---",
      "",
    ].join("\n");

    const body = [
      `# ${job.title}`,
      "",
      `**${job.companyName}**${job.locationRaw ? ` · ${job.locationRaw}` : ""}`,
      "",
      score ? `Fit **${score.fit.toFixed(1)}** · cluster \`${score.cluster}\`` : "",
      "",
      ...(reasons.length ? ["## Por que pontuou assim", "", ...reasons.map((r) => `- ${r}`), ""] : []),
      ...(blockers.length ? [`> ⚠ **Bloqueios:** ${blockers.join("; ")}`, ""] : []),
      ...(matched.length ? [`**Keywords casadas:** ${matched.join(", ")}`, ""] : []),
      [
        postingUrl ? `[Ver vaga](${postingUrl})` : "",
        applyUrl && applyUrl !== postingUrl ? `[Aplicar](${applyUrl})` : "",
      ].filter(Boolean).join(" · "),
      "",
      "## Descrição",
      "",
      job.descriptionText ?? "_Sem descrição — esta vaga entrou por um ponteiro (job alert)._",
      "",
    ].join("\n");

    const name = `${slugifyCompany(job.companyName)}-${job.id}.md`;
    documents.push({ name, markdown: front + body });
  }

  return { documents };
}
