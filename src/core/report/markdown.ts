/**
 * Markdown export back into the Obsidian vault.
 *
 * The database is the source of truth, but the vault is where the user
 * actually reads and thinks, so every run leaves a readable snapshot there.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { listBoard, pipelineCounts } from "../db/repo.ts";

function esc(text: string | null | undefined): string {
  return (text ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

export type ReportOptions = {
  minFit?: number;
  limit?: number;
  outPath?: string;
};

export async function buildReport(opts: ReportOptions = {}): Promise<{ markdown: string; path: string | null }> {
  const minFit = opts.minFit ?? 45;
  const rows = await listBoard({ minFit, limit: opts.limit ?? 100 });
  const counts = await pipelineCounts();
  const today = new Date().toISOString().slice(0, 10);

  const open = rows.filter((r) => !r.status || r.status === "backlog");
  const tracked = rows.filter((r) => r.status && r.status !== "backlog");

  const lines: string[] = [];
  lines.push(`# Vagas — match com o perfil (${today})`);
  lines.push("");
  lines.push("> Gerado por `job-hunt-os`. Fontes: APIs públicas de ATS e agregadores remotos.");
  lines.push(`> Corte de fit: ${minFit}. Vagas listadas: ${rows.length}.`);
  lines.push("");

  lines.push("## Funil");
  lines.push("");
  lines.push("| Status | Quantidade |");
  lines.push("|---|---:|");
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) lines.push("| _(nenhuma candidatura registrada)_ | 0 |");
  for (const [status, n] of entries) lines.push(`| ${status} | ${n} |`);
  lines.push("");

  lines.push("## Novas oportunidades");
  lines.push("");
  lines.push("| Fit | Cluster | Empresa | Vaga | Local | Bloqueios | Link |");
  lines.push("|---:|---|---|---|---|---|---|");
  for (const r of open) {
    const blockers = Array.isArray(r.blockers) ? (r.blockers as string[]) : [];
    lines.push(
      `| ${r.fit?.toFixed(0) ?? "—"} | ${r.cluster ?? "—"} | ${esc(r.companyName)} | ${esc(r.title)} | ${esc(r.locationRaw)} | ${blockers.length ? esc(blockers.join("; ")) : "—"} | [aplicar](${r.applyUrl ?? r.url}) |`,
    );
  }
  if (open.length === 0) {
    lines.push("| — | — | — | _nenhuma vaga nova acima do corte_ | — | — | — |");
  }
  lines.push("");

  if (tracked.length > 0) {
    lines.push("## Em andamento");
    lines.push("");
    lines.push("| Status | Fit | Empresa | Vaga | Aplicado em | Link |");
    lines.push("|---|---:|---|---|---|---|");
    for (const r of tracked) {
      lines.push(
        `| ${r.status} | ${r.fit?.toFixed(0) ?? "—"} | ${esc(r.companyName)} | ${esc(r.title)} | ${r.appliedAt?.slice(0, 10) ?? "—"} | [vaga](${r.url}) |`,
      );
    }
    lines.push("");
  }

  const markdown = lines.join("\n");
  const vault = process.env.JHO_VAULT_PATH;
  const dir = process.env.JHO_REPORT_DIR ?? "05_Interviews/LinkedIn";
  const target = opts.outPath ?? (vault ? join(vault, dir, `vagas-match-${today}.md`) : null);

  if (target) {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, markdown, "utf8");
  }

  return { markdown, path: target };
}

/* -------------------------------------------------------------------------- */
/* Offline dossiers                                                            */
/* -------------------------------------------------------------------------- */

import { mkdir as mkdirp, writeFile as write } from "node:fs/promises";
import { join as joinPath } from "node:path";
import { getJobDetail } from "../db/repo.ts";
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
export async function exportDossiers(opts: {
  minFit?: number;
  limit?: number;
  outDir?: string;
  onlyTracked?: boolean;
} = {}): Promise<{ written: number; dir: string }> {
  const vault = process.env.JHO_VAULT_PATH;
  const reportDir = process.env.JHO_REPORT_DIR ?? "05_Interviews/LinkedIn";
  const dir =
    opts.outDir ?? (vault ? joinPath(vault, reportDir, "vagas") : joinPath(process.cwd(), "out", "vagas"));

  await mkdirp(dir, { recursive: true });

  let rows = await listBoard({ minFit: opts.minFit ?? 60, limit: opts.limit ?? 50 });
  if (opts.onlyTracked) rows = rows.filter((r) => r.status !== null);

  let written = 0;
  for (const row of rows) {
    const detail = await getJobDetail(row.jobId);
    if (!detail) continue;
    const { job, score, application } = detail;

    const blockers = (score?.blockers as string[]) ?? [];
    const matched = (score?.matchedKeywords as string[]) ?? [];
    const reasons = (score?.reasons as string[]) ?? [];

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
      `url: ${job.url}`,
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
      `[Ver vaga](${job.url})${job.applyUrl && job.applyUrl !== job.url ? ` · [Aplicar](${job.applyUrl})` : ""}`,
      "",
      "## Descrição",
      "",
      job.descriptionText ?? "_Sem descrição — esta vaga entrou por um ponteiro (job alert)._",
      "",
    ].join("\n");

    const name = `${slugifyCompany(job.companyName)}-${job.id}.md`;
    await write(joinPath(dir, name), front + body, "utf8");
    written++;
  }

  return { written, dir };
}
