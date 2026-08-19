#!/usr/bin/env node
/**
 * job-hunt-os CLI.
 *
 * Everything the agent workflow needs is reachable from here, and every command
 * is safe to re-run. Run `pnpm jho --help` for the full list.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { Command } from "commander";
import { desc, eq } from "drizzle-orm";
import { closeDb, getDb } from "./core/db/client.ts";
import { runMigrations } from "./core/db/migrate.ts";
import { listBoard, pipelineCounts, setApplicationStatus } from "./core/db/repo.ts";
import { application, job, jobScore, positioningTask, source } from "./core/db/schema.ts";
import { APPLICATION_STATUSES } from "./core/db/schema.ts";
import { ageInDays, loadRates, refreshRates, STALE_AFTER_DAYS } from "./core/fx.ts";
import { importJobs, parseFile } from "./core/ingest/import.ts";
import {
  CONTACT_CATEGORIES,
  addContact,
  companiesWithContacts,
  listContacts,
  referralOpportunities,
  seedWorkHistory,
} from "./core/contacts.ts";
import { decideSuggestion, importMail, listSuggestions } from "./core/mail/run.ts";
import {
  ENGAGEMENT_KINDS,
  PILLARS,
  coldTargets,
  draftPost,
  listPosts,
  markEngagement,
  markPublished,
  metricTrend,
  pendingEngagements,
  queueEngagement,
  recordMetric,
} from "./core/positioning/engage.ts";
import { addJob } from "./core/ingest/manual.ts";
import { syncAll, pruneClosed } from "./core/ingest/run.ts";
import { verifyJobs } from "./core/ingest/verify.ts";
import { loadProfile } from "./core/profile/load.ts";
import {
  analyseGap,
  currentDocument,
  documentHistory,
  saveDocument,
  syncCandidateFromProfile,
} from "./core/candidate.ts";
import {
  auditSkill,
  candidateSkills,
  listCatalog,
  seedCatalog,
  skillDemand,
} from "./core/skills.ts";
import { skillExtraction, vocabularyGap } from "./contexts/skills/index.ts";
import { buildReport, exportDossiers } from "./core/report/markdown.ts";
import { seedPositioning } from "./core/positioning/seed.ts";
import { scoreAll } from "./core/scoring/apply.ts";
import { loadSources } from "./core/sources/config.ts";
import { getAdapter } from "./core/sources/registry.ts";

const program = new Command();
program
  .name("jho")
  .description("Job sourcing, fit scoring and application pipeline")
  .version("0.1.0");

/* --------------------------------- helpers -------------------------------- */

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

function fitColor(fit: number | null): string {
  if (fit == null) return c.dim("  — ");
  const label = fit.toFixed(0).padStart(3);
  if (fit >= 70) return c.green(label);
  if (fit >= 50) return c.yellow(label);
  return c.dim(label);
}

function truncate(text: string | null | undefined, width: number): string {
  const s = (text ?? "").replace(/\s+/g, " ").trim();
  return s.length <= width ? s.padEnd(width) : `${s.slice(0, width - 1)}…`;
}

async function withDb<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } finally {
    closeDb();
  }
}

/* ----------------------------------- db ----------------------------------- */

const db = program.command("db").description("Database maintenance");

db.command("migrate")
  .description("Create or upgrade the database schema")
  .action(async () => {
    await withDb(async () => {
      await runMigrations();
      console.log(c.green("✓") + " schema is up to date");
    });
  });

db.command("prune")
  .description("Delete long-closed jobs you never applied to")
  .option("--days <n>", "age threshold in days", "90")
  .action(async (opts: { days: string }) => {
    await withDb(async () => {
      const removed = await pruneClosed(Number(opts.days));
      console.log(`${c.green("✓")} pruned ${removed} closed job(s)`);
    });
  });

db.command("seed")
  .description("Load the positioning action plan and the July 2026 metrics baseline")
  .action(async () => {
    await withDb(async () => {
      await runMigrations();
      const r = await seedPositioning();
      console.log(
        `${c.green("\u2713")} ${r.tasksInserted} task(s) inserted, ${r.tasksUpdated} refreshed, ` +
        `${r.metricsInserted} baseline metric(s) recorded`,
      );
    });
  });

/* --------------------------------- tasks ---------------------------------- */

const tasks = program
  .command("tasks")
  .description("Positioning plan derived from the July 2026 audit");

tasks
  .command("list")
  .alias("ls")
  .description("Show the positioning plan")
  .option("--horizon <name>", "24h | week | 30d | 60d | 90d")
  .option("--all", "include completed and skipped tasks")
  .action(async (opts: { horizon?: string; all?: boolean }) => {
    await withDb(async () => {
      let rows = await getDb().select().from(positioningTask).orderBy(positioningTask.id);
      if (!opts.all) rows = rows.filter((r) => r.status === "todo" || r.status === "doing");
      if (opts.horizon) rows = rows.filter((r) => r.horizon === opts.horizon);

      if (rows.length === 0) {
        console.log(c.dim("\n  Nothing to show. Seed with: jho db seed\n"));
        return;
      }

      let horizon = "";
      for (const r of rows) {
        if (r.horizon !== horizon) {
          horizon = r.horizon;
          console.log(c.bold(`\n  ${horizon.toUpperCase()}`));
        }
        const mark = r.status === "done" ? c.green("\u2713") : r.status === "skipped" ? c.dim("\u2013") : " ";
        const prio = r.priority === "P0" ? c.red(r.priority) : r.priority === "P1" ? c.yellow(r.priority) : c.dim(r.priority);
        console.log(`  ${mark} ${r.id}  ${prio}  ${truncate(r.title, 52)} ${c.dim(r.effort ?? "")}`);
      }
      console.log(c.dim(`\n  ${rows.length} task(s). Detail: jho tasks show <id>\n`));
    });
  });

tasks
  .command("show <id>")
  .description("Full detail for one plan item, including its source in the audit")
  .action(async (id: string) => {
    await withDb(async () => {
      const rows = await getDb()
        .select()
        .from(positioningTask)
        .where(eq(positioningTask.id, id.toUpperCase()))
        .limit(1);
      const t = rows[0];
      if (!t) {
        console.error(c.red(`No task ${id}`));
        process.exitCode = 1;
        return;
      }
      console.log(`\n${c.bold(t.title)}  ${c.dim(t.id)}`);
      console.log(c.dim(`${t.horizon} \u00b7 ${t.priority} \u00b7 ${t.effort ?? "?"} \u00b7 ${t.status}`));
      if (t.why) console.log(`\n${c.bold("Por que")}  ${t.why}`);
      if (t.how) console.log(`${c.bold("Como")}     ${t.how}`);
      if (t.expected) console.log(`${c.bold("Espera")}   ${t.expected}`);
      if (t.sourceRef) console.log(c.dim(`\nFonte: ${t.sourceRef}`));
      console.log();
    });
  });

tasks
  .command("done <id>")
  .description("Mark a plan item as done")
  .option("--status <name>", "todo | doing | done | skipped", "done")
  .action(async (id: string, opts: { status: string }) => {
    await withDb(async () => {
      await getDb()
        .update(positioningTask)
        .set({
          status: opts.status,
          doneAt: opts.status === "done" ? new Date().toISOString() : null,
        })
        .where(eq(positioningTask.id, id.toUpperCase()));
      console.log(`${c.green("\u2713")} ${id.toUpperCase()} \u2192 ${c.cyan(opts.status)}`);
    });
  });

/* ----------------------------------- fx ----------------------------------- */

const fx = program
  .command("fx")
  .description("Exchange rates used to compare pay across currencies");

fx.command("refresh")
  .description("Fetch the latest rates (Frankfurter/ECB, falling back to open.er-api)")
  .option("--base <currency>", "base currency", "USD")
  .action(async (opts: { base: string }) => {
    await withDb(async () => {
      await runMigrations();
      const r = await refreshRates(opts.base.toUpperCase());
      console.log(
        `${c.green("\u2713")} ${r.count} cotações de ${c.bold(r.date)} ` +
        `(base ${r.base}, via ${r.provider})`,
      );
      console.log(c.dim(`  ${r.currencies.join(" ")}`));
    });
  });

fx.command("show")
  .description("Show the cached rate table")
  .option("--base <currency>", "base currency", "USD")
  .action(async (opts: { base: string }) => {
    await withDb(async () => {
      const table = await loadRates(opts.base.toUpperCase());
      if (!table) {
        console.log(c.yellow("Nenhuma cotação em cache. Rode: jho fx refresh"));
        return;
      }
      const age = ageInDays(table);
      const stamp = age > STALE_AFTER_DAYS ? c.red(`${table.date} (${age}d)`) : c.green(table.date);
      console.log(`\n  Base ${c.bold(table.base)} · cotação de ${stamp}\n`);
      const entries = Object.entries(table.rates).sort(([a], [b]) => a.localeCompare(b));
      for (const [code, rate] of entries) {
        console.log(`  1 ${table.base} = ${String(rate.toFixed(4)).padStart(12)} ${code}`);
      }
      if (age > STALE_AFTER_DAYS) {
        console.log(c.yellow(`\n  Cotações com mais de ${STALE_AFTER_DAYS} dias. Rode: jho fx refresh`));
      }
      console.log();
    });
  });

/* -------------------------------- sources --------------------------------- */

const sources = program.command("sources").description("Inspect configured job sources");

sources
  .command("list")
  .description("Show every configured source and its last sync result")
  .action(async () => {
    await withDb(async () => {
      const configs = await loadSources();
      const rows = await getDb().select().from(source);
      const byId = new Map(rows.map((r) => [r.id, r]));
      console.log(c.bold("\n  KIND             HANDLE               LAST SYNC            JOBS   STATUS"));
      for (const config of configs) {
        const id = `${config.kind}:${config.handle}`;
        const row = byId.get(id);
        const status = row?.lastStatus === "ok"
          ? c.green("ok")
          : row?.lastStatus === "error"
            ? c.red("error")
            : c.dim("never");
        console.log(
          `  ${truncate(config.kind, 16)} ${truncate(config.handle || "(all)", 20)} ` +
          `${truncate(row?.lastSyncedAt?.slice(0, 19).replace("T", " ") ?? "—", 20)} ` +
          `${String(row?.lastJobCount ?? "—").padStart(5)}  ${status}`,
        );
        if (row?.lastError) console.log(c.red(`      ↳ ${row.lastError}`));
      }
      console.log();
    });
  });

sources
  .command("probe <kind> <handle>")
  .description("Test a source handle without writing anything to the database")
  .action(async (kind: string, handle: string) => {
    const adapter = getAdapter(kind as never);
    const result = await adapter.fetchJobs({ kind: kind as never, handle, label: handle });
    console.log(`${c.green("✓")} ${kind}:${handle} returned ${result.jobs.length} job(s)`);
    for (const w of result.warnings) console.log(c.yellow(`  ! ${w}`));
    for (const j of result.jobs.slice(0, 5)) {
      console.log(`  ${c.dim("·")} ${j.title} ${c.dim(`— ${j.locationRaw ?? "?"}`)}`);
    }
  });

/* ---------------------------------- jobs ---------------------------------- */

const jobs = program.command("jobs").description("Sync, score and browse jobs");

jobs
  .command("sync")
  .description("Fetch every configured source and upsert the results")
  .option("--concurrency <n>", "parallel sources", "4")
  .option("--no-score", "skip scoring after the sync")
  .action(async (opts: { concurrency: string; score: boolean }) => {
    await withDb(async () => {
      await runMigrations();
      const configs = await loadSources();
      console.log(`Syncing ${configs.length} source(s)…\n`);

      const result = await syncAll(configs, {
        concurrency: Number(opts.concurrency),
        onProgress: (r) => {
          const mark = r.ok ? c.green("✓") : c.red("✗");
          const detail = r.ok
            ? `${String(r.fetched).padStart(4)} fetched  ${c.green(`+${r.inserted}`)} new  ${r.updated} updated  ${r.closed} closed`
            : c.red(r.error ?? "failed");
          console.log(`  ${mark} ${truncate(r.sourceId, 28)} ${detail} ${c.dim(`${r.durationMs}ms`)}`);
          for (const w of r.warnings) console.log(c.yellow(`      ! ${w}`));
        },
      });

      const t = result.totals;
      console.log(
        `\n${c.bold("Totals")}  ${t.fetched} fetched · ${c.green(`${t.inserted} new`)} · ` +
        `${t.updated} updated · ${t.closed} closed · ` +
        (t.rescored ? `${c.yellow(`${t.rescored} rescore`)} · ` : "") +
        `${t.failed ? c.red(`${t.failed} failed`) : "0 failed"}`,
      );

      if (opts.score !== false) {
        const scored = await scoreAll();
        if (scored.fxWarning) console.log(c.yellow(`  ! ${scored.fxWarning}`));
        console.log(`${c.bold("Scoring")} ${scored.scored} job(s) scored · best fit ${scored.topFit.toFixed(0)}`);
      }
      console.log();
    });
  });

jobs
  .command("score")
  .description("Recompute fit scores")
  .option("--all", "rescore every open job, not just unscored ones")
  .action(async (opts: { all?: boolean }) => {
    await withDb(async () => {
      const result = await scoreAll({ all: opts.all });
      console.log(`${c.green("✓")} scored ${result.scored} job(s) · best fit ${result.topFit.toFixed(0)}`);
    });
  });

jobs
  .command("list")
  .alias("ls")
  .description("Browse matching jobs, best fit first")
  .option("--min-fit <n>", "minimum fit score", "45")
  .option("--cluster <name>", "filter by target cluster")
  .option("--status <name>", "filter by pipeline status, or 'unfiled'")
  .option("--limit <n>", "maximum rows", "30")
  .option("--json", "machine-readable output")
  .action(async (opts: { minFit: string; cluster?: string; status?: string; limit: string; json?: boolean }) => {
    await withDb(async () => {
      let rows = await listBoard({
        minFit: Number(opts.minFit),
        status: opts.status as never,
        limit: Number(opts.limit) * 3,
      });
      if (opts.cluster) rows = rows.filter((r) => r.cluster === opts.cluster);
      rows = rows.slice(0, Number(opts.limit));

      if (opts.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }

      console.log(
        c.bold("\n   ID  FIT  CLUSTER    COMPANY               ROLE                                     STATUS"),
      );
      for (const r of rows) {
        const blockers = Array.isArray(r.blockers) ? (r.blockers as string[]) : [];
        const status = r.status ? c.cyan(r.status) : c.dim("—");
        console.log(
          `  ${String(r.jobId).padStart(3)} ${fitColor(r.fit)}  ${truncate(r.cluster, 10)} ` +
          `${truncate(r.companyName, 21)} ${truncate(r.title, 40)} ${status}`,
        );
        if (blockers.length > 0) console.log(c.red(`       ⚠ ${blockers.join("; ")}`));
      }
      console.log(c.dim(`\n  ${rows.length} row(s). Details: jho jobs show <id>\n`));
    });
  });

jobs
  .command("add <url>")
  .description("Register a job by URL — pulls the full posting when the ATS is known")
  .option("-t, --title <text>", "title, when the URL cannot be resolved")
  .option("-c, --company <name>", "company, when the URL cannot be resolved")
  .option("-l, --location <text>", "location as advertised")
  .option("-d, --description <text>", "job description; without it keyword scoring is 0")
  .option("--posted <date>", "publication date (ISO)")
  .option("-n, --notes <text>", "your own note about this job")
  .option("-s, --status <name>", "put it straight into the funnel")
  .action(async (url: string, opts: {
    title?: string; company?: string; location?: string;
    description?: string; posted?: string; notes?: string; status?: string;
  }) => {
    await withDb(async () => {
      await runMigrations();
      const result = await addJob({
        url,
        title: opts.title,
        companyName: opts.company,
        location: opts.location,
        description: opts.description,
        postedAt: opts.posted,
        notes: opts.notes,
      });

      for (const w of result.warnings) console.log(c.yellow(`  ! ${w}`));

      const verb = result.created ? "added" : "already known, updated";
      const how = result.via === "ats" ? c.green(`via ${result.kind} API`) : c.dim("manual entry");
      console.log(
        `${c.green("\u2713")} ${verb}: ${c.bold(result.title)} \u2014 ${result.companyName} ` +
        `${c.dim(`#${result.jobId}`)} ${how}`,
      );

      // Score immediately so the new row is comparable with everything else.
      const scored = await scoreAll();
      if (scored.scored > 0) {
        const rows = await getDb()
          .select({ fit: jobScore.fit, cluster: jobScore.cluster, blockers: jobScore.blockers })
          .from(jobScore)
          .where(eq(jobScore.jobId, result.jobId))
          .limit(1);
        const s = rows[0];
        if (s) {
          console.log(`  fit ${c.bold(s.fit.toFixed(1))} ${c.dim(`(cluster: ${s.cluster})`)}`);
          const blockers = s.blockers as string[];
          if (blockers.length > 0) console.log(c.red(`  \u26a0 ${blockers.join("; ")}`));
        }
      }

      if (opts.status) {
        if (!(APPLICATION_STATUSES as readonly string[]).includes(opts.status)) {
          console.error(c.red(`Unknown status "${opts.status}"`));
          process.exitCode = 1;
          return;
        }
        await setApplicationStatus(result.jobId, opts.status as never, opts.notes);
        console.log(`  ${c.cyan(opts.status)} \u2014 tracked`);
      }

      console.log(c.dim(`\n  Detalhes: jho jobs show ${result.jobId}\n`));
    });
  });

jobs
  .command("import <file>")
  .description("Import jobs from a JSON payload captured from an authenticated platform")
  .requiredOption("--source <key>", "short source key, e.g. revelo or bairesdev")
  .option("--label <name>", "human-readable source label")
  .option("--company <name>", "company, when the payload does not carry one")
  .option("--base-url <url>", "prefix for building job URLs when the payload has only ids")
  .option("--dry-run", "parse and report without writing anything")
  .action(async (file: string, opts: {
    source: string; label?: string; company?: string; baseUrl?: string; dryRun?: boolean;
  }) => {
    await withDb(async () => {
      await runMigrations();
      const parsed = await parseFile(file, { company: opts.company, baseUrl: opts.baseUrl });

      for (const w of parsed.warnings) console.log(c.yellow(`  ! ${w}`));

      if (parsed.jobs.length === 0) {
        console.error(c.red("Nenhuma vaga reconhecida no payload."));
        if (parsed.unmappedFields.length > 0) {
          console.log(c.dim(`  Campos encontrados: ${parsed.unmappedFields.slice(0, 25).join(", ")}`));
        }
        process.exitCode = 1;
        return;
      }

      console.log(`\n${c.bold(String(parsed.jobs.length))} vaga(s) reconhecida(s):\n`);
      for (const j of parsed.jobs.slice(0, 10)) {
        const desc = j.descriptionText ? `${j.descriptionText.length} chars` : c.yellow("sem descrição");
        console.log(`  ${truncate(j.title, 44)} ${c.dim(`${j.companyName} · ${desc}`)}`);
      }
      if (parsed.jobs.length > 10) console.log(c.dim(`  … e mais ${parsed.jobs.length - 10}`));

      if (parsed.unmappedFields.length > 0) {
        console.log(c.dim(`\n  Campos não mapeados: ${parsed.unmappedFields.slice(0, 15).join(", ")}`));
      }

      if (opts.dryRun) {
        console.log(c.dim("\n  --dry-run: nada foi gravado.\n"));
        return;
      }

      const run = await importJobs(parsed, {
        sourceKey: opts.source,
        label: opts.label ?? opts.source,
      });
      console.log(
        `\n${c.green("\u2713")} ${c.green(`${run.inserted} nova(s)`)} · ${run.updated} já conhecida(s)`,
      );

      const scored = await scoreAll();
      if (scored.fxWarning) console.log(c.yellow(`  ! ${scored.fxWarning}`));
      console.log(`${c.bold("Scoring")} ${scored.scored} pontuada(s)\n`);
    });
  });

jobs
  .command("verify")
  .description("Check that top-ranked postings still exist — closes the ones that 404")
  .option("--min-fit <n>", "only verify above this fit", "55")
  .option("--limit <n>", "how many to check", "100")
  .option("--dry-run", "report without closing anything")
  .action(async (opts: { minFit: string; limit: string; dryRun?: boolean }) => {
    await withDb(async () => {
      let last = 0;
      const r = await verifyJobs({
        minFit: Number(opts.minFit),
        limit: Number(opts.limit),
        dryRun: opts.dryRun,
        onProgress: (done, total) => {
          if (done - last >= 20 || done === total) {
            process.stdout.write(`\r  ${done}/${total} verificadas`);
            last = done;
          }
        },
      });
      process.stdout.write("\r\x1b[K");

      console.log(
        `\n${c.green("\u2713")} ${r.checked} verificadas · ` +
        `${c.green(`${r.alive} vivas`)} · ${c.red(`${r.gone} mortas`)} · ` +
        c.dim(`${r.inconclusive} inconclusivas`),
      );

      const kinds = Object.entries(r.bySource).sort((a, b) => b[1].gone - a[1].gone);
      if (kinds.length > 0) {
        console.log();
        for (const [kind, s] of kinds) {
          const total = s.gone + s.alive + s.inconclusive;
          const rate = total > 0 ? Math.round((s.gone / total) * 100) : 0;
          console.log(
            `  ${truncate(kind, 18)} ${String(s.gone).padStart(3)} mortas de ${String(total).padStart(3)}` +
            (rate > 0 ? c.red(`  ${rate}%`) : ""),
          );
        }
      }

      if (r.inconclusive > 0) {
        console.log(
          c.dim("\n  Inconclusivas são bloqueio de bot (403) ou erro de rede — não foram fechadas."),
        );
      }
      if (opts.dryRun) console.log(c.dim("  --dry-run: nada foi fechado."));
      console.log();
    });
  });

jobs
  .command("show <id>")
  .description("Full detail for one job, including why it scored the way it did")
  .option("-f, --full", "print the entire description instead of the first 1200 chars")
  .action(async (id: string, opts: { full?: boolean }) => {
    await withDb(async () => {
      const rows = await getDb()
        .select()
        .from(job)
        .leftJoin(jobScore, eq(jobScore.jobId, job.id))
        .leftJoin(application, eq(application.jobId, job.id))
        .where(eq(job.id, Number(id)))
        .limit(1);

      const row = rows[0];
      if (!row) {
        console.error(c.red(`No job with id ${id}`));
        process.exitCode = 1;
        return;
      }

      const j = row.job;
      const s = row.job_score;
      const a = row.application;

      console.log(`\n${c.bold(j.title)}  ${c.dim(`#${j.id}`)}`);
      console.log(`${j.companyName} · ${j.locationRaw ?? "location not stated"}`);
      console.log(c.dim(`source ${j.sourceId} · first seen ${j.firstSeenAt.slice(0, 10)}${j.closedAt ? ` · CLOSED ${j.closedAt.slice(0, 10)}` : ""}`));
      console.log(`\n${c.cyan(j.applyUrl ?? j.url)}`);

      if (s) {
        console.log(`\n${c.bold("Fit")} ${s.fit.toFixed(1)} / 100  ${c.dim(`(cluster: ${s.cluster})`)}`);
        console.log(
          c.dim(
            `  title ${s.titleScore} · keywords ${s.keywordScore} · seniority ${s.seniorityScore} · ` +
            `geo ${s.geoScore} · comp ${s.compScore} · fresh ${s.freshnessScore} · ` +
            `benefits ${s.benefitScore} · penalty -${s.penalty}`,
          ),
        );
        for (const reason of s.reasons as string[]) console.log(`  · ${reason}`);
        const blockers = s.blockers as string[];
        if (blockers.length) {
          console.log(c.red(`\n  Blockers: ${blockers.join("; ")}`));
        }
        const matched = s.matchedKeywords as string[];
        if (matched.length) console.log(c.dim(`\n  Matched: ${matched.join(", ")}`));
        const missing = s.missingKeywords as string[];
        if (missing.length) console.log(c.dim(`  Missing: ${missing.join(", ")}`));
      }

      if (a) {
        console.log(`\n${c.bold("Pipeline")} ${c.cyan(a.status)}${a.appliedAt ? ` · applied ${a.appliedAt.slice(0, 10)}` : ""}`);
        if (a.notes) console.log(`  ${a.notes}`);
        if (a.nextAction) console.log(`  next: ${a.nextAction}${a.nextActionAt ? ` (${a.nextActionAt.slice(0, 10)})` : ""}`);
      } else {
        console.log(c.dim("\nNot in the pipeline yet — jho track " + j.id + " shortlisted"));
      }

      if (j.descriptionText) {
        const full = opts.full === true;
        const shown = full ? j.descriptionText : j.descriptionText.slice(0, 1200);
        console.log(c.bold(`\nDescription${full ? "" : ` (1200 de ${j.descriptionText.length} chars)`}`));
        console.log(c.dim(shown));
        if (!full && j.descriptionText.length > 1200) {
          console.log(c.dim(`\n  ... use --full para ver tudo (${j.descriptionText.length} chars, já offline)`));
        }
      }
      console.log();
    });
  });

/* -------------------------------- pipeline -------------------------------- */

program
  .command("track <id> <status>")
  .description(`Move a job through the pipeline (${APPLICATION_STATUSES.join(" | ")})`)
  .option("-n, --note <text>", "attach a note to the transition")
  .option(
    "--channel <name>",
    "direct | ats | referral | recruiter | agency — referral is worth recording",
  )
  .action(async (id: string, status: string, opts: { note?: string; channel?: string }) => {
    if (!(APPLICATION_STATUSES as readonly string[]).includes(status)) {
      console.error(c.red(`Unknown status "${status}". Valid: ${APPLICATION_STATUSES.join(", ")}`));
      process.exitCode = 1;
      return;
    }
    await withDb(async () => {
      await setApplicationStatus(Number(id), status as never, opts.note);
      console.log(`${c.green("✓")} job ${id} → ${c.cyan(status)}`);
    });
  });

program
  .command("pipeline")
  .description("Show the application funnel")
  .action(async () => {
    await withDb(async () => {
      const counts = await pipelineCounts();
      const rows = await getDb()
        .select({
          id: job.id,
          title: job.title,
          companyName: job.companyName,
          status: application.status,
          appliedAt: application.appliedAt,
          nextAction: application.nextAction,
        })
        .from(application)
        .innerJoin(job, eq(job.id, application.jobId))
        .orderBy(desc(application.updatedAt));

      console.log(c.bold("\n  FUNNEL"));
      for (const status of APPLICATION_STATUSES) {
        const n = counts[status];
        if (n) console.log(`    ${truncate(status, 14)} ${String(n).padStart(3)}`);
      }
      if (rows.length === 0) {
        console.log(c.dim("\n  Nothing tracked yet. Start with: jho track <id> shortlisted\n"));
        return;
      }
      console.log(c.bold("\n   ID  STATUS         COMPANY               ROLE"));
      for (const r of rows) {
        console.log(
          `  ${String(r.id).padStart(3)} ${truncate(r.status, 14)} ${truncate(r.companyName, 21)} ${truncate(r.title, 40)}`,
        );
        if (r.nextAction) console.log(c.dim(`       next: ${r.nextAction}`));
      }
      console.log();
    });
  });

/* -------------------------------- contacts -------------------------------- */

const contacts = program
  .command("contacts")
  .description("Your network — who you know, and where");

contacts
  .command("add <name>")
  .description("Record someone in your network")
  .requiredOption("-c, --company <name>", "where they work")
  .option("-r, --role <title>", "their role")
  .option("-u, --url <linkedin>", "LinkedIn profile URL")
  .option(
    "-k, --category <name>",
    CONTACT_CATEGORIES.join(" | "),
    "peer",
  )
  .option("--country <code>", "country")
  .option("-n, --notes <text>", "how you know them")
  .action(async (name: string, opts: {
    company: string; role?: string; url?: string; category: string;
    country?: string; notes?: string;
  }) => {
    if (!(CONTACT_CATEGORIES as readonly string[]).includes(opts.category)) {
      console.error(c.red(`Categoria inválida. Use: ${CONTACT_CATEGORIES.join(", ")}`));
      process.exitCode = 1;
      return;
    }
    await withDb(async () => {
      await runMigrations();
      const r = await addContact({
        name,
        company: opts.company,
        role: opts.role,
        linkedinUrl: opts.url,
        category: opts.category as never,
        country: opts.country,
        notes: opts.notes,
      });
      console.log(
        `${c.green("\u2713")} ${r.created ? "adicionado" : "atualizado"}: ${c.bold(name)} ` +
        c.dim(`@ ${opts.company} · ${opts.category} · #${r.id}`),
      );

      // Immediately useful: does this unlock anything already in the board?
      const opps = await referralOpportunities(45);
      const here = opps.filter((o) => o.contacts.some((x) => x.startsWith(name)));
      if (here.length > 0) {
        console.log(c.green(`\n  ${here.length} vaga(s) aberta(s) nessa empresa:`));
        for (const o of here.slice(0, 5)) {
          console.log(`    ${String(o.fit.toFixed(0)).padStart(3)} ${truncate(o.title, 48)}`);
        }
      }
      console.log();
    });
  });

contacts
  .command("seed")
  .description("Seed companies you have worked with — your strongest referral surface")
  .action(async () => {
    await withDb(async () => {
      await runMigrations();
      const r = await seedWorkHistory();
      console.log(
        `${c.green("\u2713")} ${r.inserted} empresa(s) adicionada(s), ${r.updated} atualizada(s)`,
      );
      const opps = await referralOpportunities(45);
      if (opps.length > 0) {
        console.log(c.green(`\n  ${opps.length} vaga(s) aberta(s) onde você já tem histórico:`));
        for (const o of opps.slice(0, 8)) {
          console.log(`    ${String(o.fit.toFixed(0)).padStart(3)} ${truncate(o.companyName, 20)} ${truncate(o.title, 40)}`);
        }
        console.log(c.dim("\n  Detalhes: jho referrals"));
      }
      console.log();
    });
  });

contacts
  .command("list")
  .alias("ls")
  .description("Show your network")
  .option("-k, --category <name>", "filter by category")
  .action(async (opts: { category?: string }) => {
    await withDb(async () => {
      const rows = await listContacts(opts.category);
      if (rows.length === 0) {
        console.log(c.dim("\n  Nenhum contato. Comece com: jho contacts add \"Nome\" -c Empresa\n"));
        return;
      }
      console.log(c.bold("\n   ID  CATEGORIA    EMPRESA               NOME"));
      for (const r of rows) {
        console.log(
          `  ${String(r.id).padStart(3)} ${truncate(r.category, 12)} ${truncate(r.company, 21)} ${truncate(r.name, 28)}`,
        );
        if (r.role) console.log(c.dim(`       ${r.role}`));
      }
      console.log(c.dim(`\n  ${rows.length} contato(s)\n`));
    });
  });

program
  .command("referrals")
  .description("Open jobs where you already know someone — the highest-yield list you have")
  .option("--min-fit <n>", "minimum fit", "45")
  .action(async (opts: { minFit: string }) => {
    await withDb(async () => {
      const opps = await referralOpportunities(Number(opts.minFit));
      if (opps.length === 0) {
        const known = await companiesWithContacts();
        console.log(
          known.size === 0
            ? c.dim("\n  Nenhum contato registrado ainda. jho contacts add \"Nome\" -c Empresa\n")
            : c.dim(`\n  ${known.size} empresa(s) com contato, nenhuma com vaga aberta acima do corte.\n`),
        );
        return;
      }
      console.log(
        c.bold("\n   ID  FIT  EMPRESA               VAGA") +
        c.dim("\n  referral vale ~10x uma candidatura fria\n"),
      );
      for (const o of opps) {
        const status = o.status ? c.cyan(` [${o.status}]`) : "";
        console.log(
          `  ${String(o.jobId).padStart(4)} ${fitColor(o.fit)}  ${truncate(o.companyName, 21)} ${truncate(o.title, 40)}${status}`,
        );
        console.log(c.green(`        via ${o.contacts.join(", ")}`));
      }
      console.log(c.dim(`\n  ${opps.length} oportunidade(s)\n`));
    });
  });

/* ---------------------------------- mail ---------------------------------- */

const mail = program
  .command("mail")
  .description("Ingest job alerts and ATS mail from your own inbox (ADR 0008)");

mail
  .command("import <path>")
  .description("Parse .eml files from a directory or a single file")
  .option("--dry-run", "classify and report without writing anything")
  .action(async (path: string, opts: { dryRun?: boolean }) => {
    await withDb(async () => {
      await runMigrations();
      const r = await importMail(path, { dryRun: opts.dryRun });

      for (const w of r.warnings.slice(0, 12)) console.log(c.yellow(`  ! ${w}`));

      console.log(
        `\n${c.bold(String(r.files))} arquivo(s) · ${r.parsed} novo(s) · ${r.duplicates} já conhecido(s)`,
      );

      const kinds = Object.entries(r.byKind).sort((a, b) => b[1] - a[1]);
      if (kinds.length > 0) {
        console.log();
        for (const [kind, n] of kinds) {
          const colour = kind === "unknown" ? c.dim : kind.startsWith("ats_") ? c.cyan : c.green;
          console.log(`  ${colour(truncate(kind, 18))} ${String(n).padStart(4)}`);
        }
      }

      if (r.jobsCreated > 0) console.log(`\n${c.green("\u2713")} ${r.jobsCreated} vaga(s) nova(s) dos alertas`);
      if (r.suggestions > 0) {
        console.log(
          `${c.green("\u2713")} ${r.suggestions} sugestão(ões) de funil` +
          (r.unmatched > 0 ? c.dim(` (${r.unmatched} sem candidatura correspondente)`) : ""),
        );
        console.log(c.dim("  Revise com: jho mail suggestions"));
      }

      if (opts.dryRun) console.log(c.dim("\n  --dry-run: nada foi gravado.\n"));
      else console.log();

      if (!opts.dryRun && r.jobsCreated > 0) {
        const scored = await scoreAll();
        console.log(`${c.bold("Scoring")} ${scored.scored} pontuada(s)\n`);
      }
    });
  });

mail
  .command("suggestions")
  .alias("sug")
  .description("Funnel changes implied by email, awaiting your decision")
  .action(async () => {
    await withDb(async () => {
      const rows = await listSuggestions();
      if (rows.length === 0) {
        console.log(c.dim("\n  Nenhuma sugestão pendente.\n"));
        return;
      }
      console.log(c.bold("\n   ID  CONF  STATUS SUGERIDO  ASSUNTO"));
      for (const r of rows) {
        const conf = r.confidence >= 0.8 ? c.green : r.confidence >= 0.5 ? c.yellow : c.dim;
        const target = r.applicationId ? c.cyan(r.suggestedStatus ?? "?") : c.dim(`${r.suggestedStatus} (sem match)`);
        console.log(
          `  ${String(r.id).padStart(3)} ${conf(r.confidence.toFixed(2))}  ${truncate(target, 18)} ${truncate(r.subject, 46)}`,
        );
        console.log(c.dim(`       ${r.rationale}`));
      }
      console.log(c.dim("\n  jho mail accept <id> · jho mail dismiss <id>\n"));
    });
  });

mail
  .command("accept <id>")
  .description("Apply a suggested funnel change")
  .action(async (id: string) => {
    await withDb(async () => {
      const { jobId, status } = await decideSuggestion(Number(id), "accepted");
      if (!jobId || !status) {
        console.log(c.yellow("Sugestão sem candidatura correspondente — nada a aplicar."));
        return;
      }
      // Routed through the normal path so the transition lands in
      // application_event exactly like a manual one.
      await setApplicationStatus(jobId, status as never, `via e-mail (sugestão #${id})`);
      console.log(`${c.green("\u2713")} vaga ${jobId} → ${c.cyan(status)}`);
    });
  });

mail
  .command("dismiss <id>")
  .description("Reject a suggestion without touching the funnel")
  .action(async (id: string) => {
    await withDb(async () => {
      await decideSuggestion(Number(id), "dismissed");
      console.log(`${c.dim("\u2013")} sugestão ${id} descartada`);
    });
  });

/* --------------------------------- engage --------------------------------- */

const engage = program
  .command("engage")
  .description("Assisted engagement queue — the agent drafts, you act (ADR 0001)");

engage
  .command("add <url>")
  .description("Queue a comment, connection or message")
  .option("-k, --kind <name>", ENGAGEMENT_KINDS.join(" | "), "comment")
  .option("-n, --name <text>", "who")
  .option("-r, --role <text>", "their role")
  .option("-c, --company <text>", "their company")
  .option("--why <text>", "why this target matters — keeps the queue intentional")
  .option("-d, --draft <text>", "the text you will post")
  .option("--for <date>", "queue for a specific day (YYYY-MM-DD)")
  .action(async (url: string, opts: {
    kind: string; name?: string; role?: string; company?: string;
    why?: string; draft?: string; for?: string;
  }) => {
    if (!(ENGAGEMENT_KINDS as readonly string[]).includes(opts.kind)) {
      console.error(c.red(`Tipo inválido. Use: ${ENGAGEMENT_KINDS.join(", ")}`));
      process.exitCode = 1;
      return;
    }
    await withDb(async () => {
      await runMigrations();
      const id = await queueEngagement({
        kind: opts.kind as never,
        targetUrl: url,
        targetName: opts.name,
        targetRole: opts.role,
        targetCompany: opts.company,
        rationale: opts.why,
        draft: opts.draft,
        queuedFor: opts.for,
      });
      console.log(`${c.green("\u2713")} #${id} na fila · ${c.cyan(opts.kind)}`);
      if (!opts.draft) {
        console.log(c.dim("  Sem rascunho — peça a um agente para redigir antes de abrir o link."));
      }
    });
  });

engage
  .command("next")
  .alias("today")
  .description("What to act on now")
  .option("--limit <n>", "how many", "10")
  .action(async (opts: { limit: string }) => {
    await withDb(async () => {
      const rows = await pendingEngagements(Number(opts.limit));
      if (rows.length === 0) {
        console.log(c.dim("\n  Fila vazia. A auditoria pede 2 comentários substantivos por dia útil.\n"));
        return;
      }
      console.log(c.bold(`\n  ${rows.length} na fila\n`));
      for (const r of rows) {
        console.log(
          `  ${String(r.id).padStart(3)} ${c.cyan(truncate(r.kind, 9))} ` +
          `${truncate(r.targetName ?? r.targetCompany ?? "—", 26)} ${c.dim(r.queuedFor ?? "")}`,
        );
        if (r.rationale) console.log(c.dim(`      por quê: ${r.rationale}`));
        if (r.draft) {
          console.log(`      ${c.dim("rascunho:")} ${truncate(r.draft, 96)}`);
        } else {
          console.log(c.yellow("      sem rascunho"));
        }
        console.log(c.dim(`      ${r.targetUrl}`));
        console.log();
      }
      console.log(c.dim("  jho engage done <id> · jho engage skip <id>\n"));
    });
  });

engage
  .command("done <id>")
  .description("Mark as acted on")
  .option("-o, --outcome <text>", "what happened")
  .action(async (id: string, opts: { outcome?: string }) => {
    await withDb(async () => {
      await markEngagement(Number(id), "done", opts.outcome);
      console.log(`${c.green("\u2713")} #${id} feito`);
    });
  });

engage
  .command("skip <id>")
  .description("Drop it without acting")
  .action(async (id: string) => {
    await withDb(async () => {
      await markEngagement(Number(id), "skipped");
      console.log(`${c.dim("\u2013")} #${id} pulado`);
    });
  });

engage
  .command("targets")
  .description("Target accounts never engaged — the §2.2 gap")
  .action(async () => {
    await withDb(async () => {
      const rows = await coldTargets();
      if (rows.length === 0) {
        console.log(c.dim("\n  Nenhuma conta-alvo com URL cadastrada ainda.\n"));
        return;
      }
      for (const r of rows) {
        console.log(`  ${truncate(r.category, 12)} ${truncate(r.name, 28)} ${c.dim(r.company ?? "")}`);
      }
      console.log();
    });
  });

/* ---------------------------------- posts --------------------------------- */

const posts = program.command("posts").description("Content drafts, by pillar");

posts
  .command("add <slug>")
  .description("Draft a post")
  .requiredOption("-t, --title <text>", "title")
  .requiredOption("-p, --pillar <name>", Object.keys(PILLARS).join(" | "))
  .requiredOption("-b, --body <text>", "the post text")
  .option("--lang <code>", "en | pt", "en")
  .action(async (slug: string, opts: { title: string; pillar: string; body: string; lang: string }) => {
    if (!(opts.pillar in PILLARS)) {
      console.error(c.red(`Pilar inválido. Use: ${Object.keys(PILLARS).join(", ")}`));
      process.exitCode = 1;
      return;
    }
    await withDb(async () => {
      await runMigrations();
      const id = await draftPost({
        slug,
        pillar: opts.pillar as never,
        title: opts.title,
        body: opts.body,
        lang: opts.lang,
      });
      console.log(`${c.green("\u2713")} rascunho #${id} · ${c.cyan(opts.pillar)}`);
      console.log(c.dim(`  ${PILLARS[opts.pillar as keyof typeof PILLARS]}`));
    });
  });

posts
  .command("list")
  .alias("ls")
  .description("Show drafts and published posts")
  .action(async () => {
    await withDb(async () => {
      const rows = await listPosts();
      if (rows.length === 0) {
        console.log(c.dim("\n  Nenhum post. A auditoria pede 1 original por semana.\n"));
        return;
      }
      for (const r of rows) {
        const mark = r.status === "published" ? c.green("\u2713") : " ";
        console.log(`  ${mark} ${truncate(r.slug, 26)} ${c.cyan(truncate(r.pillar, 15))} ${truncate(r.title, 44)}`);
      }
      console.log();
    });
  });

posts
  .command("published <slug>")
  .description("Mark a draft as published")
  .option("--urn <urn>", "LinkedIn URN, when published through the official API")
  .action(async (slug: string, opts: { urn?: string }) => {
    await withDb(async () => {
      await markPublished(slug, opts.urn);
      console.log(`${c.green("\u2713")} ${slug} publicado`);
    });
  });

/* -------------------------------- metrics --------------------------------- */

const metrics = program
  .command("metrics")
  .description("Funnel metrics — recorded by hand, because no API exposes them");

metrics
  .command("record <key> <value>")
  .description("Record a reading, e.g. ssi_total 62")
  .option("--at <date>", "reading date (YYYY-MM-DD)")
  .option("-n, --note <text>", "context")
  .action(async (key: string, value: string, opts: { at?: string; note?: string }) => {
    await withDb(async () => {
      await runMigrations();
      await recordMetric(key, Number(value), { at: opts.at, note: opts.note });
      console.log(`${c.green("\u2713")} ${key} = ${value}`);
    });
  });

metrics
  .command("trend")
  .alias("show")
  .description("Every metric against its baseline")
  .action(async () => {
    await withDb(async () => {
      const rows = await metricTrend();
      if (rows.length === 0) {
        console.log(c.dim("\n  Nenhuma métrica. Rode: jho db seed\n"));
        return;
      }
      console.log(c.bold("\n  MÉTRICA                    BASELINE    ATUAL   DELTA"));
      for (const r of rows) {
        const delta =
          r.delta === null
            ? c.dim("  —  ")
            : r.delta > 0
              ? c.green(`+${r.delta.toFixed(1)}`)
              : r.delta < 0
                ? c.red(r.delta.toFixed(1))
                : c.dim("0");
        console.log(
          `  ${truncate(r.key, 26)} ${String(r.baseline).padStart(8)} ${String(r.latest).padStart(8)}   ${delta}` +
          (r.readings === 1 ? c.dim("  (só baseline)") : ""),
        );
      }
      console.log(c.dim("\n  jho metrics record ssi_total 62\n"));
    });
  });

/* --------------------------------- report --------------------------------- */

program
  .command("report")
  .description("Export a markdown snapshot into the Obsidian vault")
  .option("--min-fit <n>", "minimum fit score", "45")
  .option("--limit <n>", "maximum rows", "100")
  .option("--out <path>", "write somewhere else")
  .option("--stdout", "print instead of writing")
  .action(async (opts: { minFit: string; limit: string; out?: string; stdout?: boolean }) => {
    await withDb(async () => {
      const { markdown, path } = await buildReport({
        minFit: Number(opts.minFit),
        limit: Number(opts.limit),
        outPath: opts.stdout ? undefined : opts.out,
      });
      if (opts.stdout || !path) {
        console.log(markdown);
        return;
      }
      console.log(`${c.green("✓")} wrote ${path}`);
    });
  });

program
  .command("dossiers")
  .description("Write one markdown file per job into the Obsidian vault, descriptions included")
  .option("--min-fit <n>", "minimum fit", "60")
  .option("--limit <n>", "how many", "50")
  .option("--tracked", "only jobs already in the funnel")
  .option("--out <dir>", "write somewhere else")
  .action(async (opts: { minFit: string; limit: string; tracked?: boolean; out?: string }) => {
    await withDb(async () => {
      const r = await exportDossiers({
        minFit: Number(opts.minFit),
        limit: Number(opts.limit),
        onlyTracked: opts.tracked,
        outDir: opts.out,
      });
      console.log(`${c.green("\u2713")} ${r.written} dossiê(s) em ${r.dir}`);
      console.log(c.dim("  Frontmatter com fit, cluster e bloqueios — consultável no Obsidian.\n"));
    });
  });

const cv = program
  .command("cv")
  .description("The candidate's own material — CV text and what the market says about it");

cv.command("set <file>")
  .description("Store a CV from a text or markdown file")
  .option("-l, --label <text>", "version label")
  .action(async (file: string, opts: { label?: string }) => {
    await withDb(async () => {
      await runMigrations();
      const content = await readFile(file, "utf8");
      if (content.trim().length < 100) {
        console.error(c.red("Arquivo curto demais para ser um currículo."));
        process.exitCode = 1;
        return;
      }
      const candidateId = await syncCandidateFromProfile();
      const label = opts.label ?? basename(file);
      const r = await saveDocument({ candidateId, kind: "cv", label, content, format: "text" });
      console.log(
        `${c.green("\u2713")} versão #${r.id} salva · ${content.length.toLocaleString("pt-BR")} caracteres` +
        (r.previousRetired ? c.dim(" · versão anterior arquivada") : ""),
      );
    });
  });

cv.command("show")
  .description("Print the current CV")
  .action(async () => {
    await withDb(async () => {
      const candidateId = await syncCandidateFromProfile();
      const doc = await currentDocument(candidateId, "cv");
      if (!doc) {
        console.log(c.dim("\n  Nenhum currículo salvo. jho cv set <arquivo>\n"));
        return;
      }
      console.log(c.dim(`\n  ${doc.label} · ${doc.createdAt.slice(0, 10)}\n`));
      console.log(doc.content);
    });
  });

cv.command("versions")
  .description("Every stored version")
  .action(async () => {
    await withDb(async () => {
      const candidateId = await syncCandidateFromProfile();
      const rows = await documentHistory(candidateId, "cv");
      if (rows.length === 0) {
        console.log(c.dim("\n  Nenhuma versão.\n"));
        return;
      }
      for (const r of rows) {
        const mark = r.isCurrent ? c.green("\u2713") : " ";
        console.log(
          `  ${mark} #${String(r.id).padStart(3)} ${truncate(r.label, 32)} ` +
          `${String(Number(r.length).toLocaleString("pt-BR")).padStart(9)} chars  ${c.dim(r.createdAt.slice(0, 10))}`,
        );
      }
      console.log();
    });
  });

cv.command("gap")
  .description("Terms the target jobs use that your CV never says")
  .option("--min-fit <n>", "which jobs count as target", "60")
  .action(async (opts: { minFit: string }) => {
    await withDb(async () => {
      const report = await analyseGap({ minFit: Number(opts.minFit) });
      if (!report) {
        console.log(c.dim("\n  Salve um currículo primeiro: jho cv set <arquivo>\n"));
        return;
      }
      console.log(
        `\n  CV de ${report.cvLength.toLocaleString("pt-BR")} caracteres contra ` +
        `${report.jobsAnalysed} vagas acima de ${report.minFit}\n`,
      );

      if (report.missing.length === 0) {
        console.log(c.green("  Nenhuma lacuna relevante.\n"));
      } else {
        console.log(c.bold("  AUSENTES NO CV, PRESENTES NAS VAGAS"));
        for (const t of report.missing.slice(0, 15)) {
          const pct = Math.round(t.coverage * 100);
          const bar = "█".repeat(Math.max(1, Math.round(pct / 5)));
          console.log(`    ${truncate(t.term, 30)} ${c.yellow(bar)} ${String(pct).padStart(3)}%`);
        }
      }

      console.log(c.dim(`\n  ${report.confirmed.length} termo(s) já cobertos · ${report.unused.length} raros no alvo\n`));
    });
  });

const skills = program
  .command("skills")
  .description("Skill catalogue, detection from the CV, and market demand");

skills
  .command("seed")
  .description("Load the global skill catalogue")
  .action(async () => {
    await withDb(async () => {
      await runMigrations();
      const r = await seedCatalog();
      console.log(`${c.green("\u2713")} ${r.inserted} skill(s) adicionada(s), ${r.updated} atualizada(s)`);
    });
  });

skills
  .command("gap")
  .description("Palavras que o mercado usa e o seu CV não — a lacuna de vocabulário")
  .option("--min-fit <n>", "só vagas com fit acima disso definem o mercado", "60")
  .option("--limit <n>", "teto de vagas lidas", "400")
  .option("--all", "mostrar também o que já está coberto")
  .action(async (opts) => {
    await withDb(async () => {
      await runMigrations();
      const candidateId = await syncCandidateFromProfile();
      const doc = await currentDocument(candidateId, "cv");
      if (!doc) {
        console.log(c.dim("\n  Nenhum currículo salvo. jho cv set <arquivo>\n"));
        return;
      }

      const report = await vocabularyGap({
        cvText: doc.content,
        minFit: Number(opts.minFit),
        limit: Number(opts.limit),
      });

      if (report.totalJobs === 0) {
        console.log(c.dim(`\n  Nenhuma vaga com fit >= ${opts.minFit}. Baixe o corte.\n`));
        return;
      }

      const pct = (n: number) => `${Math.round(n * 100)}%`;
      console.log(
        `\n${c.bold("Lacuna de vocabulário")} ${c.dim(`· ${report.totalJobs} vagas com fit >= ${opts.minFit}`)}`,
      );
      console.log(
        c.dim(
          `  cobertura ponderada ${pct(report.coverage.weighted)} · ` +
          `${report.coverage.covered} cobertas · ${report.coverage.vocabulary} de vocabulário · ` +
          `${report.coverage.missing} lacunas reais`,
        ),
      );

      if (report.quickWins.length > 0) {
        console.log(`\n${c.bold("Ganho rápido")} ${c.dim("— você tem a experiência, falta a palavra")}`);
        for (const item of report.quickWins) {
          console.log(
            `  ${c.green(item.marketTerm.padEnd(22))} ${c.dim(`${pct(item.demand)} das vagas`)}`,
          );
          console.log(c.dim(`    CV escreve: ${item.cvTerms.join(", ")}`));
        }
        console.log(
          c.dim("\n  Trocar a palavra só vale se a evidência existir. Não invente."),
        );
      } else {
        console.log(c.dim("\n  Nenhuma lacuna de vocabulário — o CV fala a língua do mercado."));
      }

      if (report.realGaps.length > 0) {
        console.log(`\n${c.bold("Lacuna real")} ${c.dim("— o mercado pede, o CV não mostra")}`);
        for (const item of report.realGaps.slice(0, 12)) {
          console.log(
            `  ${item.marketTerm.padEnd(22)} ${c.dim(`${pct(item.demand)} · ${item.jobCount} vagas`)}`,
          );
        }
      }

      if (opts.all) {
        console.log(`\n${c.bold("Já coberto")}`);
        for (const item of report.items.filter((i) => i.kind === "covered")) {
          console.log(`  ${c.dim(item.marketTerm.padEnd(22))} ${c.dim(pct(item.demand))}`);
        }
      }
      console.log();
    });
  });

skills
  .command("detect")
  .description("Detect skills in the current CV — produces candidates for audit, not claims")
  .action(async () => {
    await withDb(async () => {
      await runMigrations();
      const candidateId = await syncCandidateFromProfile();
      const doc = await currentDocument(candidateId, "cv");
      if (!doc) {
        console.log(c.dim("\n  Nenhum currículo salvo. jho cv set <arquivo>\n"));
        return;
      }
      const r = await skillExtraction({ candidateId, text: doc.content, source: "cv" });
      console.log(
        `${c.green("\u2713")} ${r.added} nova(s) · ${r.refreshed} atualizada(s) · ` +
        c.dim(`${r.preserved} já auditada(s), preservada(s)`),
      );

      const strong = r.detections.filter((d) => d.confidence >= 0.75);
      const weak = r.detections.filter((d) => d.confidence < 0.55);
      console.log(
        c.dim(`  ${r.detections.length} detecções · `) +
        c.green(`${strong.length} com evidência de uso`) +
        c.dim(` · ${weak.length} só menção solta`),
      );
      console.log(c.dim("  Detectada não é confirmada. Revise: jho skills list\n"));
    });
  });

skills
  .command("list")
  .alias("ls")
  .description("Skills attributed to the candidate")
  .option("-s, --status <name>", "detected | confirmed | rejected")
  .action(async (opts: { status?: string }) => {
    await withDb(async () => {
      const candidateId = await syncCandidateFromProfile();
      const rows = await candidateSkills(candidateId, opts.status);
      if (rows.length === 0) {
        console.log(c.dim("\n  Nenhuma skill. Rode: jho skills seed && jho skills detect\n"));
        return;
      }
      let cat = "";
      for (const r of rows.sort((a, b) => a.category.localeCompare(b.category) || b.occurrences - a.occurrences)) {
        if (r.category !== cat) {
          cat = r.category;
          console.log(c.bold(`\n  ${cat.toUpperCase()}`));
        }
        const mark =
          r.status === "confirmed" ? c.green("\u2713") : r.status === "rejected" ? c.red("\u2717") : c.dim("?");
        console.log(
          `  ${mark} ${String(r.id).padStart(3)} ${truncate(r.name, 26)} ${c.dim(`${r.occurrences}x`)}`,
        );
      }
      const counts = rows.reduce<Record<string, number>>((a, r) => {
        a[r.status] = (a[r.status] ?? 0) + 1;
        return a;
      }, {});
      console.log(
        c.dim(`\n  ${counts.detected ?? 0} a auditar · ${counts.confirmed ?? 0} confirmadas · ${counts.rejected ?? 0} rejeitadas`),
      );
      console.log(c.dim("  jho skills confirm <id> · jho skills reject <id>\n"));
    });
  });

skills
  .command("confirm <id>")
  .description("Confirm a detected skill — only confirmed skills may be cited as experience")
  .option("-l, --level <text>", "your own assessment")
  .action(async (id: string, opts: { level?: string }) => {
    await withDb(async () => {
      await auditSkill(Number(id), "confirmed", { level: opts.level });
      console.log(`${c.green("\u2713")} #${id} confirmada`);
    });
  });

skills
  .command("reject <id>")
  .description("Reject a false positive")
  .action(async (id: string) => {
    await withDb(async () => {
      await auditSkill(Number(id), "rejected");
      console.log(`${c.red("\u2717")} #${id} rejeitada`);
    });
  });

skills
  .command("demand")
  .description("What the target market asks for, against what you have")
  .option("--min-fit <n>", "which jobs count as target", "60")
  .option("--limit <n>", "how many rows", "25")
  .action(async (opts: { minFit: string; limit: string }) => {
    await withDb(async () => {
      const candidateId = await syncCandidateFromProfile();
      const rows = await skillDemand({ minFit: Number(opts.minFit), candidateId });
      console.log(c.bold("\n  DEMANDA DO MERCADO-ALVO\n"));
      for (const r of rows.slice(0, Number(opts.limit))) {
        const pct = Math.round(r.demand * 100);
        const bar = "\u2588".repeat(Math.max(1, Math.round(pct / 5)));
        const mine =
          r.candidateStatus === "confirmed"
            ? c.green(" voce tem")
            : r.candidateStatus === "detected"
              ? c.yellow(" a auditar")
              : r.candidateStatus === "rejected"
                ? c.red(" rejeitada")
                : c.dim(" ausente");
        console.log(`  ${truncate(r.name, 24)} ${c.cyan(bar)} ${String(pct).padStart(3)}%${mine}`);
      }
      console.log();
    });
  });

skills
  .command("catalog")
  .description("The global catalogue")
  .option("-c, --category <name>", "filter")
  .action(async (opts: { category?: string }) => {
    await withDb(async () => {
      const rows = await listCatalog(opts.category);
      let cat = "";
      for (const r of rows) {
        if (r.category !== cat) {
          cat = r.category;
          console.log(c.bold(`\n  ${cat.toUpperCase()}`));
        }
        const aliases = (r.aliases as string[]) ?? [];
        console.log(`    ${truncate(r.canonicalName, 26)} ${c.dim(aliases.slice(0, 4).join(", "))}`);
      }
      console.log(c.dim(`\n  ${rows.length} skill(s) no catálogo\n`));
    });
  });

/* --------------------------------- profile -------------------------------- */

program
  .command("profile")
  .description("Validate profile.yaml and print the resolved targets")
  .action(async () => {
    const profile = await loadProfile(true);
    console.log(`${c.green("✓")} profile.yaml is valid`);
    console.log(`\n${c.bold(profile.identity.name)} — ${profile.identity.headline}`);
    console.log(c.dim(`${profile.identity.location} · ${profile.seniority.years_experience}+ years`));
    console.log(c.bold("\nTarget clusters"));
    for (const [name, cluster] of Object.entries(profile.targets.clusters)) {
      console.log(`  ${truncate(name, 12)} weight ${cluster.weight}  cv:${cluster.cv_variant}`);
      console.log(c.dim(`    ${cluster.titles.join(" · ")}`));
    }
    const kw = profile.keywords;
    console.log(
      c.bold("\nKeywords") +
      c.dim(` ${kw.critical.length} critical · ${kw.strong.length} strong · ${kw.stack.length} stack · ${kw.negative.length} negative`),
    );
    console.log(c.bold("Blockers") + c.dim(` ${profile.blockers.length} patterns`));
    console.log();
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(c.red(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
