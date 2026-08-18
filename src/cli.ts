#!/usr/bin/env node
/**
 * job-hunt-os CLI.
 *
 * Everything the agent workflow needs is reachable from here, and every command
 * is safe to re-run. Run `pnpm jho --help` for the full list.
 */
import { Command } from "commander";
import { desc, eq } from "drizzle-orm";
import { closeDb, getDb } from "./core/db/client.ts";
import { runMigrations } from "./core/db/migrate.ts";
import { listBoard, pipelineCounts, setApplicationStatus } from "./core/db/repo.ts";
import { application, job, jobScore, positioningTask, source } from "./core/db/schema.ts";
import { APPLICATION_STATUSES } from "./core/db/schema.ts";
import { syncAll, pruneClosed } from "./core/ingest/run.ts";
import { loadProfile } from "./core/profile/load.ts";
import { buildReport } from "./core/report/markdown.ts";
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
        `${t.updated} updated · ${t.closed} closed · ${t.failed ? c.red(`${t.failed} failed`) : "0 failed"}`,
      );

      if (opts.score !== false) {
        const scored = await scoreAll();
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
  .command("show <id>")
  .description("Full detail for one job, including why it scored the way it did")
  .action(async (id: string) => {
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
            `geo ${s.geoScore} · comp ${s.compScore} · penalty -${s.penalty}`,
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
        console.log(c.bold("\nDescription (first 1200 chars)"));
        console.log(c.dim(j.descriptionText.slice(0, 1200)));
      }
      console.log();
    });
  });

/* -------------------------------- pipeline -------------------------------- */

program
  .command("track <id> <status>")
  .description(`Move a job through the pipeline (${APPLICATION_STATUSES.join(" | ")})`)
  .option("-n, --note <text>", "attach a note to the transition")
  .action(async (id: string, status: string, opts: { note?: string }) => {
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
