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
