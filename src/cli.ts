#!/usr/bin/env node
/**
 * job-hunt-os CLI.
 *
 * Everything the agent workflow needs is reachable from here, and every command
 * is safe to re-run. Run `pnpm jho --help` for the full list.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { and, desc, eq } from "drizzle-orm";
import { closeDb, getDb } from "./core/db/client.ts";
import { runMigrations } from "./core/db/migrate.ts";
import { listBoard } from "./contexts/matching/index.ts";
import { pipelineCounts, setApplicationStatus } from "./contexts/pursuit/index.ts";
import { application, job, jobScore, positioningTask, source } from "./core/db/schema.ts";
import { APPLICATION_STATUSES, type ApplicationStatus } from "./core/db/schema.ts";
import { ageInDays, loadRates, refreshRates, STALE_AFTER_DAYS } from "./contexts/fx/index.ts";
import { importJobs, parseFile } from "./core/ingest/import.ts";
import {
  CONTACT_CATEGORIES,
  addContact,
  companiesWithContacts,
  listContacts,
  referralOpportunities,
  seedWorkHistory,
} from "./core/contacts.ts";
import { decideSuggestion, importMail, listSuggestions } from "./contexts/correspondence/index.ts";
import {
  ENGAGEMENT_KINDS,
  PILLAR_KEYS,
  PILLARS,
  coldTargets,
  draftPost,
  listPosts,
  markEngagement,
  markPublished,
  metricTrend,
  pendingEngagements,
  parsePillar,
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
  getCandidate,
  saveDocument,
  syncCandidateFromProfile,
} from "./core/candidate.ts";
import {
  auditSkill,
  candidateSkills,
  listCatalog,
  parseSkillCategory,
  parseSkillStatus,
  seedCatalog,
  skillDemand,
  skillExtraction,
  vocabularyGap,
} from "./contexts/skills/index.ts";
import { buildReport, exportDossiers } from "./core/report/markdown.ts";
import { seedPositioning } from "./core/positioning/seed.ts";
import { scoreAll } from "./core/scoring/apply.ts";
import { scoreMessages } from "./contexts/matching/index.ts";
import { renderScoreMessage, translator } from "./core/i18n/index.ts";
import { loadSources } from "./core/sources/config.ts";
import { getAdapter, parseFetchableSourceKind } from "./core/sources/registry.ts";

const cliTranslator = translator("pt-BR").t;
const renderScoreMessages = (value: unknown): string[] =>
  scoreMessages(value).map((item) => renderScoreMessage(item, cliTranslator));

/**
 * One-line confirmation on stdin.
 *
 * Used before anything that leaves the machine or costs money. Defaults to no:
 * an empty Enter must never be read as consent.
 */
async function ask(question: string): Promise<string> {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

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

async function activeCandidateId(): Promise<number> {
  const active = await getCandidate();
  if (!active) {
    throw new Error("Candidato padrão não cadastrado. Execute `jho db seed` primeiro.");
  }
  return active.id;
}

function applicationStatus(value: string): ApplicationStatus | null {
  return APPLICATION_STATUSES.find((status) => status === value) ?? null;
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

db.command("check")
  .description("Check relational integrity without changing data")
  .action(async () => {
    await withDb(async () => {
      const { foreignKeyViolations, orphanAuthSessionCount } = await import(
        "./core/db/integrity.ts"
      );
      const [violations, orphanSessions] = await Promise.all([
        foreignKeyViolations(),
        orphanAuthSessionCount(),
      ]);
      if (violations.length === 0) {
        console.log(`${c.green("✓")} foreign keys íntegros · nenhuma sessão órfã`);
        return;
      }
      console.error(c.red(`${violations.length} violação(ões) de foreign key`));
      for (const violation of violations) {
        console.error(
          c.dim(
            `  ${violation.table} rowid=${violation.rowid} → ${violation.parent} fk=${violation.fkid}`,
          ),
        );
      }
      if (orphanSessions > 0) {
        console.error(c.dim(`  ${orphanSessions} sessão(ões) órfã(s); execute jho db migrate`));
      }
      process.exitCode = 1;
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
  .description("Semear o banco: conta do dono, catálogo de skills, provedores e plano de posicionamento")
  .option("--skip-auth", "não criar a conta do dono")
  .action(async (opts: { skipAuth?: boolean }) => {
    await withDb(async () => {
      await runMigrations();

      // Ordem deliberada: primeiro o que destrava o uso do sistema (entrar),
      // depois o que o enriquece. Um seed que falha no meio deve ter deixado o
      // login funcionando.
      if (!opts.skipAuth) {
        const { seedOwner } = await import("./contexts/auth/index.ts");
        try {
          const a = await seedOwner();
          if (a.passwordSet && a.password) {
            console.log(`${c.green("\u2713")} conta ${c.bold(a.email)}`);
            console.log(`  ${c.bold("Senha")}  ${c.cyan(a.password)}  ${c.dim("— anote, aparece só aqui")}`);
          } else {
            console.log(`${c.green("\u2713")} conta ${a.email} ${c.dim("(senha preservada)")}`);
          }
        } catch (error) {
          // Perfil sem e-mail não deve impedir o resto do seed.
          console.log(c.yellow(`!  conta não criada: ${(error as Error).message}`));
        }
      }

      const { seedCatalog } = await import("./contexts/skills/index.ts");
      const skills = await seedCatalog();
      console.log(`${c.green("\u2713")} catálogo de skills · ${skills.inserted} nova(s)`);

      const { seedProviders } = await import("./core/llm/registry.ts");
      const llm = await seedProviders();
      console.log(`${c.green("\u2713")} ${llm.providers} provedor(es) de LLM, ${llm.models} modelo(s)`);

      const r = await seedPositioning();
      console.log(
        `${c.green("\u2713")} posicionamento · ${r.tasksInserted} tarefa(s), ` +
        `${r.metricsInserted} métrica(s) de baseline`,
      );
      console.log(c.dim("\n  Tudo idempotente: rodar de novo não duplica nem sobrescreve.\n"));
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
    const fetchableKind = parseFetchableSourceKind(kind);
    const adapter = getAdapter(fetchableKind);
    const result = await adapter.fetchJobs({ kind: fetchableKind, handle, label: handle });
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
        const scored = await scoreAll(await activeCandidateId());
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
      const result = await scoreAll(await activeCandidateId(), { all: opts.all });
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
      const candidateId = await activeCandidateId();
      const status = opts.status === "unfiled" || opts.status === "any"
        ? opts.status
        : opts.status
          ? applicationStatus(opts.status)
          : undefined;
      if (opts.status && !status) {
        throw new Error(`Unknown status "${opts.status}". Valid: ${APPLICATION_STATUSES.join(", ")}, unfiled, any`);
      }
      let rows = await listBoard(candidateId, {
        minFit: Number(opts.minFit),
        status: status ?? undefined,
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
        const blockers = renderScoreMessages(r.blockers);
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
      const candidateId = await activeCandidateId();
      const scored = await scoreAll(candidateId);
      if (scored.scored > 0) {
        const rows = await getDb()
          .select({ fit: jobScore.fit, cluster: jobScore.cluster, blockers: jobScore.blockers })
          .from(jobScore)
          .where(and(eq(jobScore.candidateId, candidateId), eq(jobScore.jobId, result.jobId)))
          .limit(1);
        const s = rows[0];
        if (s) {
          console.log(`  fit ${c.bold(s.fit.toFixed(1))} ${c.dim(`(cluster: ${s.cluster})`)}`);
          const blockers = renderScoreMessages(s.blockers);
          if (blockers.length > 0) console.log(c.red(`  \u26a0 ${blockers.join("; ")}`));
        }
      }

      if (opts.status) {
        const status = applicationStatus(opts.status);
        if (!status) {
          console.error(c.red(`Unknown status "${opts.status}"`));
          process.exitCode = 1;
          return;
        }
        await setApplicationStatus(candidateId, result.jobId, status, opts.notes);
        console.log(`  ${c.cyan(status)} \u2014 tracked`);
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

      const scored = await scoreAll(await activeCandidateId());
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

/* ------------------------------ Reconferência ----------------------------- */

/**
 * `jobs verify` continua sendo o lote de uma execução só. Estes comandos são a
 * outra metade: a fila que o botão da interface alimenta, para a conferência
 * acontecer fora do pedido HTTP. Sondar 200 links dentro de um clique deixaria
 * a página pendurada por minutos.
 */
const recheck = jobs
  .command("recheck")
  .description("Fila de reconferência: a vaga ainda existe? (alimentada pelo botão e pela varredura)");

recheck
  .command("queue")
  .description("Enfileira as vagas há mais tempo sem conferência")
  .option("--min-fit <n>", "só acima deste fit", "55")
  .option("--limit <n>", "quantas enfileirar", "200")
  .option("--older-than <days>", "só as conferidas há mais de N dias", "7")
  .action(async (opts: { minFit: string; limit: string; olderThan: string }) => {
    await withDb(async () => {
      const { enqueueStale, verifyStats } = await import("./core/ingest/verify-queue.ts");
      const n = await enqueueStale({
        minFit: Number(opts.minFit),
        limit: Number(opts.limit),
        olderThanDays: Number(opts.olderThan),
      });
      const stats = await verifyStats();
      console.log(`\n${c.green("\u2713")} ${n} enfileirada(s)`);
      console.log(c.dim(`  fila: ${JSON.stringify(stats)}`));
      console.log(c.dim("  Processar: pnpm jho jobs recheck run\n"));
    });
  });

recheck
  .command("run")
  .description("Consome a fila de reconferência até esvaziar")
  .option("--max <n>", "para depois de N verificações")
  .option("--delay <ms>", "pausa entre sondagens", "300")
  .action(async (opts: { max?: string; delay: string }) => {
    await withDb(async () => {
      const { runVerifyQueue } = await import("./core/ingest/verify-queue.ts");
      const r = await runVerifyQueue({
        max: opts.max ? Number(opts.max) : undefined,
        delayMs: Number(opts.delay),
        onProgress: (done) => process.stdout.write(`\r  ${done} verificadas`),
      });
      process.stdout.write("\r\x1b[K");
      console.log(
        `\n${c.green("\u2713")} ${r.checked} verificadas · ` +
        `${c.green(`${r.alive} vivas`)} · ${c.red(`${r.gone} mortas`)} · ` +
        c.dim(`${r.inconclusive} inconclusivas`),
      );
      if (r.inconclusive > 0) {
        console.log(
          c.dim("  Inconclusiva é bloqueio de robô (403) ou erro de rede — nenhuma foi fechada."),
        );
      }
      console.log();
    });
  });

recheck
  .command("status")
  .description("Estado da fila de reconferência")
  .action(async () => {
    await withDb(async () => {
      const { verifyStats } = await import("./core/ingest/verify-queue.ts");
      const stats = await verifyStats();
      if (Object.keys(stats).length === 0) {
        console.log(c.dim("\n  vazia — pnpm jho jobs recheck queue\n"));
        return;
      }
      console.log();
      for (const [status, n] of Object.entries(stats)) {
        console.log(`  ${status.padEnd(10)} ${String(n).padStart(5)}`);
      }
      console.log();
    });
  });

jobs
  .command("show <id>")
  .description("Full detail for one job, including why it scored the way it did")
  .option("-f, --full", "print the entire description instead of the first 1200 chars")
  .action(async (id: string, opts: { full?: boolean }) => {
    await withDb(async () => {
      const candidateId = await activeCandidateId();
      const rows = await getDb()
        .select()
        .from(job)
        .leftJoin(
          jobScore,
          and(eq(jobScore.jobId, job.id), eq(jobScore.candidateId, candidateId)),
        )
        .leftJoin(
          application,
          and(eq(application.jobId, job.id), eq(application.candidateId, candidateId)),
        )
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
        for (const reason of renderScoreMessages(s.reasons)) console.log(`  · ${reason}`);
        const blockers = renderScoreMessages(s.blockers);
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
    const parsedStatus = applicationStatus(status);
    if (!parsedStatus) {
      console.error(c.red(`Unknown status "${status}". Valid: ${APPLICATION_STATUSES.join(", ")}`));
      process.exitCode = 1;
      return;
    }
    await withDb(async () => {
      const candidateId = await activeCandidateId();
      // `opts.channel` era aceito pela flag e descartado aqui: a coluna existe,
      // o funil a renderiza, o CLAUDE.md documenta o comando e o `jho prep`
      // imprime essa linha como próximo passo — e nada escrevia nela.
      await setApplicationStatus(candidateId, Number(id), parsedStatus, opts.note, opts.channel);
      console.log(`${c.green("✓")} job ${id} → ${c.cyan(parsedStatus)}`);
    });
  });

program
  .command("pipeline")
  .description("Show the application funnel")
  .option("--json", "saída legível por máquina")
  .action(async (opts: { json?: boolean }) => {
    await withDb(async () => {
      const candidateId = await activeCandidateId();
      const counts = await pipelineCounts(candidateId);
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
        .where(eq(application.candidateId, candidateId))
        .orderBy(desc(application.updatedAt));

      if (opts.json) {
        console.log(JSON.stringify({ counts, applications: rows }, null, 2));
        return;
      }

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
    const category = CONTACT_CATEGORIES.find((candidate) => candidate === opts.category);
    if (!category) {
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
        category,
        country: opts.country,
        notes: opts.notes,
      });
      console.log(
        `${c.green("\u2713")} ${r.created ? "adicionado" : "atualizado"}: ${c.bold(name)} ` +
        c.dim(`@ ${opts.company} · ${opts.category} · #${r.id}`),
      );

      // Immediately useful: does this unlock anything already in the board?
      const opps = await referralOpportunities(await activeCandidateId(), 45);
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
      const opps = await referralOpportunities(await activeCandidateId(), 45);
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
  .option("--json", "saída legível por máquina")
  .action(async (opts: { minFit: string; json?: boolean }) => {
    await withDb(async () => {
      const opps = await referralOpportunities(
        await activeCandidateId(),
        Number(opts.minFit),
      );
      if (opts.json) {
        console.log(JSON.stringify(opps, null, 2));
        return;
      }
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
  .command("auth")
  .description("Conectar o Gmail (somente leitura) via OAuth")
  .action(async () => {
    const { authorize, credentialsFromEnv } = await import("./core/mail/gmail.ts");
    const creds = credentialsFromEnv();
    if (!creds) {
      console.error(c.red("\n  GMAIL_CLIENT_ID e GMAIL_CLIENT_SECRET não estão definidos."));
      console.log(c.dim("  Veja docs/email-ingestion.md — leva uns 5 minutos no Google Cloud.\n"));
      process.exitCode = 1;
      return;
    }

    console.log(c.dim("\n  Abra esta URL no navegador e autorize:\n"));
    try {
      const result = await authorize(creds, (url) => console.log(`  ${c.cyan(url)}\n`));
      console.log(
        `${c.green("\u2713")} Gmail conectado${result.email ? ` como ${c.bold(result.email)}` : ""}`,
      );
      console.log(c.dim(`  Token em ${result.savedTo} (modo 600, fora do Git)`));
      console.log(c.dim("  Escopo: somente leitura. Não consegue enviar nem apagar nada.\n"));
    } catch (error) {
      console.error(c.red(`\n  ${(error as Error).message}\n`));
      process.exitCode = 1;
    }
  });

mail
  .command("fetch")
  .description("Baixar e-mails do Gmail como .eml (não importa — use `mail import` depois)")
  .option("-q, --query <gmail>", "consulta na sintaxe do Gmail")
  .option("-n, --max <n>", "teto de mensagens", "100")
  .option("-o, --out <dir>", "destino", "data/mail")
  .action(async (opts: { query?: string; max: string; out: string }) => {
    const { credentialsFromEnv, fetchToDir, readToken } = await import("./core/mail/gmail.ts");
    const creds = credentialsFromEnv();
    if (!creds) {
      console.error(c.red("\n  Credenciais ausentes. Ver docs/email-ingestion.md\n"));
      process.exitCode = 1;
      return;
    }
    const stored = await readToken();
    if (!stored) {
      console.error(c.red("\n  Gmail não conectado. Rode: jho mail auth\n"));
      process.exitCode = 1;
      return;
    }

    try {
      const r = await fetchToDir(creds, stored, {
        query: opts.query,
        max: Number(opts.max),
        outDir: opts.out,
      });
      console.log(
        `\n${c.green("\u2713")} ${r.written} novo(s) · ${c.dim(`${r.skipped} já baixado(s) · ${r.found} encontrado(s)`)}`,
      );
      console.log(c.dim(`  Salvos em ${r.dir}`));
      console.log(
        c.dim(`  Nada entrou no banco ainda. Confira e rode: jho mail import ${opts.out} --dry-run\n`),
      );
    } catch (error) {
      console.error(c.red(`\n  ${(error as Error).message}\n`));
      process.exitCode = 1;
    }
  });

mail
  .command("import <path>")
  .description("Parse .eml files from a directory or a single file")
  .option("--dry-run", "classify and report without writing anything")
  .action(async (path: string, opts: { dryRun?: boolean }) => {
    await withDb(async () => {
      await runMigrations();
      const candidateId = await activeCandidateId();
      const r = await importMail(path, { candidateId, dryRun: opts.dryRun });

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
        const scored = await scoreAll(await activeCandidateId());
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
      const candidateId = await activeCandidateId();
      const { jobId, status } = await decideSuggestion(candidateId, Number(id), "accepted");
      if (!jobId || !status) throw new Error(`Sugestão ${id} aceita sem candidatura`);
      console.log(`${c.green("\u2713")} vaga ${jobId} → ${c.cyan(status)}`);
    });
  });

mail
  .command("dismiss <id>")
  .description("Reject a suggestion without touching the funnel")
  .action(async (id: string) => {
    await withDb(async () => {
      await decideSuggestion(await activeCandidateId(), Number(id), "dismissed");
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
    const kind = ENGAGEMENT_KINDS.find((candidate) => candidate === opts.kind);
    if (!kind) {
      console.error(c.red(`Tipo inválido. Use: ${ENGAGEMENT_KINDS.join(", ")}`));
      process.exitCode = 1;
      return;
    }
    await withDb(async () => {
      await runMigrations();
      const id = await queueEngagement({
        kind,
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
  .requiredOption("-p, --pillar <name>", PILLAR_KEYS.join(" | "))
  .requiredOption("-b, --body <text>", "the post text")
  .option("--lang <code>", "en | pt", "en")
  .action(async (slug: string, opts: { title: string; pillar: string; body: string; lang: string }) => {
    const pillar = parsePillar(opts.pillar);
    if (!pillar) {
      console.error(c.red(`Pilar inválido. Use: ${PILLAR_KEYS.join(", ")}`));
      process.exitCode = 1;
      return;
    }
    await withDb(async () => {
      await runMigrations();
      const id = await draftPost({
        slug,
        pillar,
        title: opts.title,
        body: opts.body,
        lang: opts.lang,
      });
      console.log(`${c.green("\u2713")} rascunho #${id} · ${c.cyan(opts.pillar)}`);
      console.log(c.dim(`  ${PILLARS[pillar]}`));
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
      const { markdown } = await buildReport(await activeCandidateId(), {
        minFit: Number(opts.minFit),
        limit: Number(opts.limit),
      });
      const today = new Date().toISOString().slice(0, 10);
      const vault = process.env.JHO_VAULT_PATH;
      const reportDir = process.env.JHO_REPORT_DIR ?? "05_Interviews/LinkedIn";
      const path = opts.stdout
        ? null
        : opts.out ?? (vault ? join(vault, reportDir, `vagas-match-${today}.md`) : null);
      if (!path) {
        console.log(markdown);
        return;
      }
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, markdown, "utf8");
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
      const result = await exportDossiers(await activeCandidateId(), {
        minFit: Number(opts.minFit),
        limit: Number(opts.limit),
        onlyTracked: opts.tracked,
      });
      const vault = process.env.JHO_VAULT_PATH;
      const reportDir = process.env.JHO_REPORT_DIR ?? "05_Interviews/LinkedIn";
      const dir = opts.out ?? (vault ? join(vault, reportDir, "vagas") : join(process.cwd(), "out", "vagas"));
      await mkdir(dir, { recursive: true });
      for (const document of result.documents) {
        await writeFile(join(dir, document.name), document.markdown, "utf8");
      }
      console.log(`${c.green("\u2713")} ${result.documents.length} dossiê(s) em ${dir}`);
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

cv.command("import <file>")
  .description("Extrair um currículo de PDF e salvá-lo como texto")
  .option("-l, --label <text>", "rótulo da versão")
  .option("--dry-run", "mostrar o que seria extraído sem salvar")
  .action(async (file: string, opts: { label?: string; dryRun?: boolean }) => {
    await withDb(async () => {
      await runMigrations();
      const bytes = await readFile(file);
      const { extractPdfText } = await import("./core/pdf.ts");
      const r = await extractPdfText(new Uint8Array(bytes));

      console.log(
        `\n${c.bold(basename(file))} ${c.dim(`· ${r.pages} página(s) · ${r.text.length.toLocaleString("pt-BR")} caracteres`)}`,
      );
      for (const w of r.warnings) console.log(c.yellow(`  ! ${w}`));

      if (r.text.trim().length < 100) {
        console.error(c.red("\n  Texto insuficiente. Nada foi salvo.\n"));
        process.exitCode = 1;
        return;
      }

      if (opts.dryRun) {
        console.log(c.dim("\n--- início ---"));
        console.log(r.text.slice(0, 1200));
        console.log(c.dim("--- corte ---\n"));
        return;
      }

      const candidateId = await syncCandidateFromProfile();
      const saved = await saveDocument({
        candidateId,
        kind: "cv",
        label: opts.label ?? basename(file),
        content: r.text,
        format: "text",
      });
      console.log(
        `${c.green("\u2713")} versão #${saved.id} salva` +
        (saved.previousRetired ? c.dim(" · versão anterior arquivada") : ""),
      );
      console.log(c.dim("  Extração de PDF erra. Revise em /candidate antes de confiar.\n"));
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
      const report = await analyseGap({
        candidateId: await activeCandidateId(),
        minFit: Number(opts.minFit),
      });
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

const auth = program
  .command("auth")
  .description("Contas e sessões (AUTH-01)");

auth
  .command("status", { isDefault: true })
  .description("Modo de autenticação e contas cadastradas")
  .action(async () => {
    await withDb(async () => {
      await runMigrations();
      const { isOpenMode } = await import("./contexts/auth/index.ts");
      const { authUser } = await import("./core/db/schema.ts");
      const users = await getDb().select().from(authUser);

      const open = isOpenMode();
      console.log(`\n${c.bold("Modo")} ${open ? c.red("SEM PROTEÇÃO") : c.green("autenticado")}`);
      console.log(
        c.dim(
          open
            ? "  JHO_AUTH_MODE=open — currículo, funil e export acessíveis sem login.\n" +
              "  Remova a variável do .env para exigir autenticação."
            : "  Login obrigatório. Nenhuma página ou API responde sem sessão válida.",
        ),
      );

      if (users.length === 0) {
        console.log(c.dim("\n  Nenhuma conta. Crie: jho auth add-user <email>\n"));
        return;
      }
      console.log(`\n${c.bold("Contas")}`);
      for (const u of users) {
        const roles = (u.roles as string[]).join(", ");
        console.log(
          `  ${u.email.padEnd(30)} ${roles.padEnd(14)}` +
          (u.disabledAt ? c.red("desabilitada") : c.dim(`candidato ${u.candidateId ?? "—"}`)),
        );
      }
      console.log();
    });
  });

auth
  .command("seed [email]")
  .description("Criar a conta do dono, com senha gerada e exibida uma vez")
  .option("--password <senha>", "usar esta senha em vez de gerar uma")
  .option("--force", "redefinir a senha mesmo se a conta já tiver uma")
  .action(async (email: string | undefined, opts: { password?: string; force?: boolean }) => {
    await withDb(async () => {
      await runMigrations();
      const { seedOwner } = await import("./contexts/auth/index.ts");

      try {
        const r = await seedOwner({ email, password: opts.password, force: opts.force });

        console.log(
          `\n${c.green("\u2713")} ${r.created ? "conta criada" : "conta já existia"}: ` +
          `${c.bold(r.email)} ${c.dim(`(${r.roles.join(", ")})`)}`,
        );

        if (!r.passwordSet) {
          console.log(c.dim("  A senha atual foi preservada. Para trocar: jho auth set-password <email>"));
          console.log(c.dim("  Para redefinir agora: jho auth seed --force\n"));
          return;
        }

        if (r.password && !opts.password) {
          // Mostrada uma vez, e só aqui: o banco guarda apenas o hash, então
          // nem este comando consegue recuperá-la depois.
          console.log(`\n  ${c.bold("Senha")}  ${c.cyan(r.password)}`);
          console.log(
            c.dim(
              "\n  Anote agora — o banco guarda só o hash e nem este comando a recupera.\n" +
              "  Troque quando quiser: jho auth set-password " + r.email,
            ),
          );
        } else {
          console.log(c.dim("  Senha definida.\n"));
        }

        console.log(c.dim(`\n  Entrar em http://127.0.0.1:3000/login\n`));
      } catch (error) {
        console.error(c.red(`\n  ${(error as Error).message}\n`));
        process.exitCode = 1;
      }
    });
  });

auth
  .command("add-user <email>")
  .description("Criar conta")
  .option("--role <papel>", "admin | candidate | recruiter (repetível com vírgula)", "candidate")
  .option("--candidate <id>", "candidato que esta conta representa")
  .action(async (email: string, opts: { role: string; candidate?: string }) => {
    await withDb(async () => {
      await runMigrations();
      const { ROLES } = await import("./contexts/auth/index.ts");
      const roles = opts.role.split(",").map((r) => r.trim());
      const invalid = roles.filter((r) => !(ROLES as readonly string[]).includes(r));
      if (invalid.length > 0) {
        console.error(c.red(`\n  Papel inválido: ${invalid.join(", ")}. Use ${ROLES.join(" ou ")}.\n`));
        process.exitCode = 1;
        return;
      }

      // `candidate`, e não `owner`.
      //
      // O papel `owner` foi renomeado para `candidate` quando os três papéis
      // entraram, e esta linha ficou para trás — em duas frentes. O default de
      // `--role` fazia `jho auth add-user <email>` falhar com "Papel inválido:
      // owner", e é o comando que a regra 14 do CLAUDE.md manda rodar e que a
      // tela de login mostra para quem ainda não tem conta: o primeiro acesso
      // ao sistema estava quebrado.
      //
      // E esta derivação virou código morto, com efeito silencioso: toda conta
      // criada sem `--candidate` nascia com `candidateId` nulo, inclusive uma
      // de papel candidato — justamente a que precisa dele para ter currículo e
      // funil.
      const candidateId = opts.candidate
        ? Number(opts.candidate)
        : roles.includes("candidate")
          ? await syncCandidateFromProfile()
          : null;

      const { authUser } = await import("./core/db/schema.ts");
      await getDb()
        .insert(authUser)
        .values({ email: email.toLowerCase().trim(), roles, candidateId })
        .onConflictDoUpdate({ target: authUser.email, set: { roles, candidateId } });

      console.log(`${c.green("\u2713")} ${email} · ${roles.join(", ")}`);
      console.log(c.dim("  Entrar: jho auth login <email>\n"));
    });
  });

auth
  .command("set-password <email>")
  .description("Definir senha (lida do terminal ou de stdin, nunca de argumento)")
  .option("--stdin", "ler a senha de stdin, uma linha — para automação")
  .action(async (email: string, opts: { stdin?: boolean }) => {
    await withDb(async () => {
      await runMigrations();
      const { checkPassword, MIN_LENGTH, setPassword } = await import("./contexts/auth/index.ts");

      // Never as an argument: argv shows up in shell history and in `ps`.
      let password: string;
      let confirmation: string;

      if (opts.stdin) {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
        password = Buffer.concat(chunks).toString("utf8").split("\n")[0]!.trim();
        confirmation = password;
      } else {
        const { createInterface } = await import("node:readline/promises");
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        try {
          console.log(c.dim(`\n  Mínimo de ${MIN_LENGTH} caracteres. A digitação fica visível neste terminal.`));
          password = await rl.question("  Senha: ");
          confirmation = await rl.question("  Repita: ");
        } finally {
          rl.close();
        }
      }

      if (password !== confirmation) {
        console.error(c.red("\n  As senhas não conferem.\n"));
        process.exitCode = 1;
        return;
      }
      const check = checkPassword(password);
      if (!check.ok) {
        console.error(c.red(`\n  ${check.reason}\n`));
        process.exitCode = 1;
        return;
      }

      if (await setPassword(email, password)) {
        console.log(`${c.green("\u2713")} senha definida para ${email}`);
        console.log(c.dim("  Sessões anteriores foram encerradas — é o ponto de trocar a senha.\n"));
      } else {
        console.error(c.red(`\n  Conta ${email} não existe. Crie com: jho auth add-user\n`));
        process.exitCode = 1;
      }
    });
  });

auth
  .command("login <email>")
  .description("Gerar um link de acesso de uso único")
  .action(async (email: string) => {
    await withDb(async () => {
      await runMigrations();
      const { startLogin } = await import("./contexts/auth/index.ts");
      const { token, expiresAt } = await startLogin(email);
      console.log(`\n${c.bold("Link de acesso")} ${c.dim(`· válido até ${expiresAt.slice(11, 16)}`)}`);
      console.log(`  ${c.cyan(`http://127.0.0.1:3000/login/callback?token=${token}`)}`);
      console.log(
        c.dim(
          "\n  Uso único e curto. Se o e-mail não tiver conta, o link simplesmente\n" +
          "  não funciona — e daqui não dá para saber qual dos dois foi.\n",
        ),
      );
    });
  });

auth
  .command("revoke <email>")
  .description("Encerrar todas as sessões de uma conta")
  .action(async (email: string) => {
    await withDb(async () => {
      const { revokeUserSessions } = await import("./contexts/auth/index.ts");
      const revoked = await revokeUserSessions(email);
      if (revoked === null) {
        console.error(c.red(`\n  Conta ${email} não existe.\n`));
        process.exitCode = 1;
        return;
      }
      console.log(`${c.green("\u2713")} ${revoked} sessão(ões) encerrada(s)\n`);
    });
  });

const llm = program
  .command("llm")
  .description("Provedores e modelos de LLM (BYOK — a chave fica no seu .env)");

llm
  .command("seed")
  .description("Cadastrar os provedores conhecidos")
  .action(async () => {
    await withDb(async () => {
      await runMigrations();
      const { seedProviders } = await import("./core/llm/registry.ts");
      const r = await seedProviders();
      console.log(`${c.green("\u2713")} ${r.providers} provedor(es), ${r.models} modelo(s)`);
      console.log(c.dim("  Nada foi sobrescrito. Veja: jho llm list\n"));
    });
  });

llm
  .command("list", { isDefault: true })
  .description("Modelos cadastrados e quais têm chave disponível")
  .option("--all", "incluir desabilitados")
  .action(async (opts: { all?: boolean }) => {
    await withDb(async () => {
      await runMigrations();
      const { chooseModel, listModels } = await import("./core/llm/registry.ts");
      const models = await listModels(!opts.all);

      if (models.length === 0) {
        console.log(c.dim("\n  Nenhum modelo cadastrado. Rode: jho llm seed\n"));
        return;
      }

      const active = await chooseModel();
      console.log(`\n  ${"provedor".padEnd(12)}${"modelo".padEnd(30)}${"esforço".padEnd(9)}${"custo /Mtok".padEnd(14)}chave`);
      for (const m of models) {
        const cost =
          m.inputCostPerMTok === null
            ? "—"
            : `$${m.inputCostPerMTok}/$${m.outputCostPerMTok ?? "?"}`;
        const isActive = active?.modelId === m.modelId;
        const name = `${isActive ? "→ " : "  "}${m.modelLabel}`;
        console.log(
          (isActive ? c.green : (x: string) => x)(
            `  ${m.providerLabel.padEnd(12)}${name.padEnd(30)}` +
            `${(m.supportsReasoning ? (m.effort ?? "sim") : "—").padEnd(9)}${cost.padEnd(14)}` +
            (m.keyPresent ? c.green("ok") : c.dim(m.apiKeyEnv)),
          ),
        );
      }
      console.log(
        c.dim(
          "\n  → é o modelo em uso. Trocar: jho llm use <modelo>\n" +
          "  A chave nunca é gravada no banco: o cadastro guarda só o NOME da variável.\n",
        ),
      );
    });
  });

llm
  .command("use <model>")
  .description("Definir o modelo padrão")
  .action(async (model: string) => {
    await withDb(async () => {
      const { setDefaultModel } = await import("./core/llm/registry.ts");
      if (await setDefaultModel(model)) {
        console.log(`${c.green("\u2713")} padrão: ${model}\n`);
      } else {
        console.error(c.red(`\n  Modelo "${model}" não cadastrado. Veja: jho llm list\n`));
        process.exitCode = 1;
      }
    });
  });

llm
  .command("add-provider <slug>")
  .description("Cadastrar um provedor (inclusive compatível com OpenAI)")
  .requiredOption("--label <nome>", "nome exibido")
  .requiredOption("--key-env <VAR>", "nome da variável de ambiente com a chave")
  .option("--kind <tipo>", "anthropic | openai | compatible", "compatible")
  .option("--base-url <url>", "endpoint, para serviço compatível ou self-hosted")
  .action(async (slug: string, opts: { label: string; keyEnv: string; kind: string; baseUrl?: string }) => {
    await withDb(async () => {
      await runMigrations();
      const { isKind } = await import("./core/llm/registry.ts");
      if (!isKind(opts.kind)) {
        console.error(c.red(`\n  Tipo inválido: ${opts.kind}. Use anthropic, openai ou compatible.\n`));
        process.exitCode = 1;
        return;
      }
      const { llmProvider } = await import("./core/db/schema.ts");
      await getDb()
        .insert(llmProvider)
        .values({
          slug,
          label: opts.label,
          kind: opts.kind,
          apiKeyEnv: opts.keyEnv,
          baseUrl: opts.baseUrl ?? null,
        })
        .onConflictDoUpdate({
          target: llmProvider.slug,
          set: { label: opts.label, kind: opts.kind, apiKeyEnv: opts.keyEnv, baseUrl: opts.baseUrl ?? null },
        });
      console.log(`${c.green("\u2713")} provedor ${slug}`);
      console.log(c.dim(`  A chave continua sendo sua: defina ${opts.keyEnv} no .env.\n`));
    });
  });

llm
  .command("add-model <providerSlug> <modelId>")
  .description("Cadastrar um modelo de um provedor")
  .requiredOption("--label <nome>", "nome exibido")
  .option("--reasoning", "o modelo aceita controle de esforço")
  .option("--effort <nivel>", "low | medium | high | xhigh | max")
  .option("--max-tokens <n>", "teto de saída", "4096")
  .option("--in-cost <usd>", "custo de entrada por milhão de tokens")
  .option("--out-cost <usd>", "custo de saída por milhão de tokens")
  .action(async (providerSlug: string, modelId: string, opts: Record<string, string | boolean>) => {
    await withDb(async () => {
      await runMigrations();
      const { isEffort } = await import("./core/llm/registry.ts");
      const effort = typeof opts.effort === "string" ? opts.effort : null;
      if (effort && !isEffort(effort)) {
        console.error(c.red(`\n  Esforço inválido: ${effort}. Use low, medium, high, xhigh ou max.\n`));
        process.exitCode = 1;
        return;
      }

      const { llmModel, llmProvider } = await import("./core/db/schema.ts");
      const [provider] = await getDb()
        .select({ id: llmProvider.id })
        .from(llmProvider)
        .where(eq(llmProvider.slug, providerSlug))
        .limit(1);

      if (!provider) {
        console.error(c.red(`\n  Provedor "${providerSlug}" não cadastrado.\n`));
        process.exitCode = 1;
        return;
      }

      await getDb()
        .insert(llmModel)
        .values({
          providerId: provider.id,
          modelId,
          label: String(opts.label),
          supportsReasoning: Boolean(opts.reasoning),
          defaultEffort: effort,
          maxOutputTokens: Number(opts.maxTokens ?? 4096),
          inputCostPerMTok: opts.inCost ? Number(opts.inCost) : null,
          outputCostPerMTok: opts.outCost ? Number(opts.outCost) : null,
        })
        .onConflictDoNothing();
      console.log(`${c.green("\u2713")} modelo ${modelId}\n`);
    });
  });

program
  .command("analyze <id>")
  .description("Leitura qualitativa de uma vaga com LLM (BYOK — sua chave, seu custo)")
  .option("--yes", "não pedir confirmação antes de enviar")
  .option("--model <id>", "modelo específico (ver: jho llm list)")
  .action(async (id: string, opts: { yes?: boolean; model?: string }) => {
    await withDb(async () => {
      const { chooseModel, portFor } = await import("./core/llm/registry.ts");
      const { redactKey } = await import("./core/llm/port.ts");
      const { ENV_KEYS } = await import("./core/llm/port.ts");

      const choice = await chooseModel(typeof opts.model === "string" ? opts.model : undefined);
      if (!choice) {
        console.error(c.red("\n  Nenhum modelo disponível com chave configurada."));
        console.log(
          c.dim(
            `  Cadastre: jho llm seed · veja: jho llm list\n` +
            `  Defina ${Object.values(ENV_KEYS).join(" ou ")} no .env.\n` +
            "  A chave é sua: fica só no .env, nunca no banco nem em log.\n",
          ),
        );
        process.exitCode = 1;
        return;
      }

      const { buildDossier } = await import("./core/apply/dossier.ts");
      const { analyzeJob, payloadSize } = await import("./core/llm/analyze.ts");

      const candidateId = await syncCandidateFromProfile();
      const doc = await currentDocument(candidateId, "cv");
      const dossier = await buildDossier(candidateId, Number(id), doc?.content ?? null);
      if (!dossier) {
        console.error(c.red(`\n  Vaga ${id} não encontrada.\n`));
        process.exitCode = 1;
        return;
      }
      if (!dossier.hasDescription) {
        console.error(c.red("\n  Sem descrição capturada — nada para analisar."));
        console.log(c.dim("  Rode: jho scrape queue && jho scrape run\n"));
        process.exitCode = 1;
        return;
      }

      const { getDb } = await import("./core/db/client.ts");
      const { job, jobPage } = await import("./core/db/schema.ts");
      const { eq } = await import("drizzle-orm");
      const [page] = await getDb()
        .select({ text: jobPage.text, fallback: job.descriptionText })
        .from(job)
        .leftJoin(jobPage, eq(jobPage.jobId, job.id))
        .where(eq(job.id, Number(id)))
        .limit(1);
      const description = page?.text ?? page?.fallback ?? "";

      // Everything else here runs offline. This is the one command that sends
      // data somewhere, so it says so before doing it rather than after.
      const bytes = payloadSize(dossier, description);
      console.log(`\n${c.bold("Isto vai sair da sua máquina")}`);
      const effortLabel = choice.supportsReasoning ? ` · esforço ${choice.effort ?? "padrão"}` : "";
      console.log(
        c.dim(
          `  destino: ${choice.providerLabel} (${choice.modelLabel})${effortLabel}\n` +
          `  chave:   ${redactKey(process.env[choice.apiKeyEnv])} (de ${choice.apiKeyEnv})\n` +
          `  envia:   o anúncio da vaga, ~${bytes.toLocaleString("pt-BR")} caracteres\n` +
          `  NÃO envia: seu currículo, seu perfil, nem o funil`,
        ),
      );

      if (!opts.yes) {
        const answer = await ask(`\n  Enviar? [s/N] `);
        if (!/^s(im)?$/i.test(answer.trim())) {
          console.log(c.dim("  Cancelado.\n"));
          return;
        }
      }

      try {
        const analysis = await analyzeJob(portFor(choice), dossier, description, process.cwd(), {
          effort: choice.supportsReasoning ? (choice.effort ?? undefined) : undefined,
          maxTokens: choice.maxOutputTokens,
        });
        console.log(`\n${c.bold(dossier.job.title)} ${c.dim(`· ${dossier.job.companyName}`)}\n`);
        console.log(analysis.text);
        console.log(
          c.dim(
            `\n  ${analysis.model} · ${analysis.inputTokens ?? "?"} entrada / ` +
            `${analysis.outputTokens ?? "?"} saída tokens\n`,
          ),
        );
      } catch (error) {
        console.error(c.red(`\n  ${(error as Error).message}\n`));
        process.exitCode = 1;
      }
    });
  });

program
  .command("prep <id>")
  .description("Dossiê para se candidatar a uma vaga: bloqueios, rede, evidências e vocabulário")
  .action(async (id: string) => {
    await withDb(async () => {
      const { buildDossier } = await import("./core/apply/dossier.ts");
      const candidateId = await syncCandidateFromProfile();
      const doc = await currentDocument(candidateId, "cv");
      const d = await buildDossier(candidateId, Number(id), doc?.content ?? null);

      if (!d) {
        console.error(c.red(`\n  Vaga ${id} não encontrada.\n`));
        process.exitCode = 1;
        return;
      }

      console.log(`\n${c.bold(d.job.title)} ${c.dim(`· ${d.job.companyName}`)}`);
      console.log(
        c.dim(
          `  fit ${d.fit ?? "—"} · ${d.cluster ?? "sem cluster"}` +
          (d.job.ageDays === null ? "" : ` · ${d.job.ageDays}d`) +
          (d.job.locationRaw ? ` · ${d.job.locationRaw.slice(0, 50)}` : ""),
        ),
      );

      // Blockers first: the cheapest information here is "do not bother".
      if (d.blockers.length > 0) {
        console.log(`\n${c.red("Bloqueadores")}`);
        for (const b of d.blockers) console.log(c.red(`  ✗ ${b}`));
      }

      if (d.contacts.length > 0) {
        console.log(`\n${c.bold("Sua rede nesta empresa")} ${c.green("— peça indicação antes de aplicar")}`);
        for (const person of d.contacts) console.log(`  · ${person}`);
      }

      if (d.evidence.length > 0) {
        console.log(`\n${c.bold("Evidências que casam com este anúncio")}`);
        for (const e of d.evidence) {
          console.log(`  ${c.dim(`[${e.area}]`)} ${e.line.slice(0, 150)}${e.line.length > 150 ? "…" : ""}`);
          console.log(c.dim(`    em comum: ${e.matched.slice(0, 8).join(", ")}`));
        }
      }

      if (d.vocabularyGaps.length > 0) {
        console.log(`\n${c.bold("Trocar a palavra")} ${c.dim("— você tem, mas escreve diferente")}`);
        for (const g of d.vocabularyGaps) {
          console.log(`  ${c.green(g.term.padEnd(24))} ${c.dim(`CV escreve: ${g.cvSays.join(", ")}`)}`);
        }
      }

      if (d.missing.length > 0) {
        console.log(`\n${c.bold("Pedem e o CV não mostra")}`);
        console.log(c.dim(`  ${d.missing.slice(0, 12).join(" · ")}`));
      }

      if (d.requirements.length > 0) {
        console.log(`\n${c.bold("Requisitos do anúncio")}`);
        for (const r of d.requirements.slice(0, 10)) console.log(`  · ${r.slice(0, 130)}`);
      }

      for (const w of d.warnings) console.log(c.yellow(`\n  ! ${w}`));

      console.log(c.dim(`\n  ${d.job.applyUrl ?? d.job.url}`));
      console.log(
        c.dim(`  Depois de aplicar: jho track ${d.job.id} applied --channel ${d.contacts.length > 0 ? "referral" : "direct"}\n`),
      );
    });
  });

const scrape = program
  .command("scrape")
  .description("Robô que captura e trata as descrições de vaga (fila com status)");

scrape
  .command("queue")
  .description("Enfileirar vagas para captura")
  .option("--min-fit <n>", "só vagas acima deste fit", "45")
  .option("-n, --limit <n>", "teto", "500")
  .option("--refresh", "recapturar vagas que já têm página")
  .action(async (opts: { minFit: string; limit: string; refresh?: boolean }) => {
    await withDb(async () => {
      await runMigrations();
      const { enqueuePending } = await import("./core/scrape/queue.ts");
      const r = await enqueuePending({
        minFit: Number(opts.minFit),
        limit: Number(opts.limit),
        refresh: opts.refresh,
      });
      console.log(`${c.green("\u2713")} ${r.queued} na fila`);
      if (r.alreadyDescribed > 0) {
        console.log(
          c.dim(
            `  ${r.alreadyDescribed} vaga(s) puladas — a fonte já entregou a descrição.\n` +
            "  O robô preenche lacuna; buscar o que já temos só rende 403.",
          ),
        );
      }
      console.log(c.dim("  Capturar: pnpm jho scrape run\n"));
    });
  });

scrape
  .command("run")
  .description("Rodar as duas etapas: captura e tratamento")
  .option("-c, --concurrency <n>", "workers simultâneos", "4")
  .option("-n, --limit <n>", "teto de páginas nesta rodada")
  .option("--fetch-only", "só capturar")
  .option("--parse-only", "só tratar o que já foi capturado")
  .action(async (opts: { concurrency: string; limit?: string; fetchOnly?: boolean; parseOnly?: boolean }) => {
    await withDb(async () => {
      await runMigrations();
      const concurrency = Number(opts.concurrency);
      const limit = opts.limit ? Number(opts.limit) : undefined;

      if (!opts.parseOnly) {
        const { runFetchStage } = await import("./core/scrape/fetcher.ts");
        console.log(c.dim(`\n  Capturando com ${concurrency} worker(s)…`));
        const r = await runFetchStage({ concurrency, limit });
        console.log(
          `${c.green("\u2713")} captura · ${r.stored} guardada(s) · ` +
          c.dim(`${r.blocked} bloqueada(s) por robots.txt · ${r.failed} falha(s)`),
        );
      }

      if (!opts.fetchOnly) {
        const { runParseStage } = await import("./core/scrape/parser.ts");
        console.log(c.dim(`  Tratando…`));
        const r = await runParseStage({ concurrency, limit });
        console.log(
          `${c.green("\u2713")} tratamento · ${r.parsed} descrição(ões) · ` +
          c.dim(`${r.failed} sem texto utilizável`),
        );
        if (r.rescored > 0) {
          console.log(c.yellow(`  ! ${r.rescored} vaga(s) sem score — rode: jho jobs score`));
        }
      }
      console.log();
    });
  });

scrape
  .command("status")
  .description("Situação da fila")
  .action(async () => {
    await withDb(async () => {
      const { dbQueue } = await import("./core/scrape/queue.ts");
      const stats = await dbQueue.stats();
      const order = ["pending", "fetching", "fetched", "parsing", "done", "failed", "blocked"];
      console.log(`\n${c.bold("Fila de captura")}`);
      const total = Object.values(stats).reduce((a, b) => a + b, 0);
      if (total === 0) {
        console.log(c.dim("  vazia — jho scrape queue\n"));
        return;
      }
      for (const status of order) {
        const n = stats[status] ?? 0;
        if (n === 0) continue;
        const tone = status === "failed" ? c.red : status === "done" ? c.green : c.dim;
        console.log(`  ${tone(status.padEnd(10))} ${String(n).padStart(6)}`);
      }
      console.log();
    });
  });

scrape
  .command("retry")
  .description("Devolver as falhas para a fila (ex.: depois de melhorar o extrator)")
  .action(async () => {
    await withDb(async () => {
      const { retryFailed } = await import("./core/scrape/queue.ts");
      const n = await retryFailed();
      console.log(`${c.green("\u2713")} ${n} tarefa(s) de volta à fila\n`);
    });
  });

scrape
  .command("reparse")
  .description("Reprocessar toda página já capturada, sem baixar de novo")
  .action(async () => {
    await withDb(async () => {
      const { reparseAll } = await import("./core/scrape/parser.ts");
      const r = await reparseAll();
      console.log(
        `${c.green("\u2713")} ${r.parsed} reprocessada(s) · ${c.dim(`${r.failed} sem texto`)}\n`,
      );
    });
  });

program
  .command("security")
  .description("Verificações de segurança específicas deste sistema")
  .command("check", { isDefault: true })
  .description("Bind do servidor, dado pessoal versionado, segredos e permissões")
  .action(async () => {
    const { runSecurityCheck } = await import("./core/security.ts");
    const findings = await runSecurityCheck();

    const icon = { critical: c.red("\u2717"), warning: c.yellow("!"), ok: c.green("\u2713") };
    console.log();
    for (const f of findings) {
      console.log(`${icon[f.level]} ${c.bold(f.title)}`);
      console.log(c.dim(`  ${f.detail}`));
      if (f.fix) console.log(c.dim(`  → ${f.fix}`));
    }

    const critical = findings.filter((f) => f.level === "critical").length;
    const warnings = findings.filter((f) => f.level === "warning").length;
    console.log(
      `\n${critical > 0 ? c.red(`${critical} crítico(s)`) : c.green("nenhum crítico")} · ` +
      `${warnings} aviso(s)\n`,
    );
    console.log(c.dim("  Análise completa: docs/security.md\n"));
    if (critical > 0) process.exitCode = 1;
  });

program
  .command("stats")
  .description("Diagnóstico estatístico do scorer e do funil")
  .option("--json", "saída em JSON")
  .action(async (opts: { json?: boolean }) => {
    await withDb(async () => {
      const { scorerDiagnostics, funnelAnalysis } = await import("./core/analytics/index.ts");
      const candidateId = await activeCandidateId();
      const [scorer, funnel] = await Promise.all([
        scorerDiagnostics(candidateId),
        funnelAnalysis(candidateId),
      ]);

      if (opts.json) {
        console.log(JSON.stringify({ scorer, funnel }, null, 2));
        return;
      }

      const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

      console.log(`\n${c.bold("Scorer")} ${c.dim(`· ${scorer.jobs.toLocaleString("pt-BR")} vagas abertas pontuadas`)}`);
      console.log(
        c.dim(
          `  fit: média ${scorer.fit.mean} · desvio ${scorer.fit.stdDev} · ` +
          `p10 ${scorer.fit.p10} · mediana ${scorer.fit.median} · p90 ${scorer.fit.p90}`,
        ),
      );

      console.log(`\n  ${"componente".padEnd(16)}${"peso".padStart(5)}${"média".padStart(8)}${"infl.".padStart(7)}${"uso".padStart(6)}  situação`);
      for (const comp of scorer.components) {
        const tone =
          comp.verdict === "healthy" ? c.green : comp.verdict === "dead-weight" ? c.red : c.yellow;
        console.log(
          `  ${comp.label.padEnd(16)}${String(comp.weight).padStart(5)}` +
          `${comp.mean.toFixed(1).padStart(8)}${pct(comp.influence).padStart(7)}` +
          `${pct(comp.utilisation).padStart(6)}  ${tone(comp.verdict)}`,
        );
      }
      console.log(
        c.dim("\n  influência = fatia da dispersão total do fit. Peso é o que se pretendeu;"),
      );
      console.log(c.dim("  influência é o que aconteceu. Componente sem dispersão não reordena nada."));

      for (const comp of scorer.components.filter((x) => x.verdict !== "healthy")) {
        console.log(`\n  ${c.yellow("!")} ${c.bold(comp.label)}: ${comp.note}`);
      }

      if (scorer.redundant.length > 0) {
        console.log(`\n${c.bold("Redundância")}`);
        for (const pair of scorer.redundant) {
          console.log(`  ${pair.a} × ${pair.b} — ρ=${pair.rho}`);
        }
      }

      console.log(`\n${c.bold("Funil")}`);
      if (funnel.power) console.log(c.yellow(`  ! ${funnel.power}`));
      console.log(
        `  ${funnel.applied} candidatura(s) · ${funnel.replied} com retorno · ` +
        c.dim(`taxa ${pct(funnel.overall.point)} (IC95 ${pct(funnel.overall.low)}–${pct(funnel.overall.high)})`),
      );

      if (funnel.trustworthy) {
        for (const [title, rows] of [
          ["cluster", funnel.byCluster],
          ["fonte", funnel.bySource],
          ["canal", funnel.byChannel],
        ] as const) {
          if (rows.length === 0) continue;
          console.log(`\n  ${c.bold(`por ${title}`)}`);
          for (const r of rows) {
            console.log(
              `    ${r.group.padEnd(18)} ${String(r.replied).padStart(3)}/${String(r.applied).padEnd(4)} ` +
              c.dim(`${pct(r.rate.point)} (${pct(r.rate.low)}–${pct(r.rate.high)})`),
            );
          }
        }
        if (funnel.componentSignal.length > 0) {
          console.log(`\n  ${c.bold("componente × retorno")} ${c.dim("(correlação de posto)")}`);
          for (const sig of funnel.componentSignal) {
            console.log(`    ${sig.key.padEnd(18)} ${sig.rho === null ? c.dim("—") : sig.rho.toFixed(3)}`);
          }
        }
      }
      console.log();
    });
  });

sources
  .command("snippet [platform]")
  .description("Extrator para colar no console da plataforma logada (Revelo, BairesDev)")
  .option("--match <substring>", "trecho que o href da vaga contém")
  .action(async (platform = "generic", opts: { match?: string }) => {
    const { buildSnippet, knownPlatforms, snippetNote } = await import("./core/sources/snippet.ts");

    if (!knownPlatforms().includes(platform)) {
      console.log(c.dim(`\n  Plataformas conhecidas: ${knownPlatforms().join(", ")}`));
      console.log(c.dim(`  Usando o extrator genérico para "${platform}".`));
    }

    console.log(`\n${c.bold("1.")} ${snippetNote(platform)}`);
    console.log(`${c.bold("2.")} Abra o console do navegador e cole:\n`);
    console.log(buildSnippet(platform, { match: opts.match }));
    console.log(
      `\n${c.bold("3.")} Salve o JSON copiado e rode: ` +
      c.cyan(`jho jobs import vagas.json --source ${platform}`),
    );
    console.log(
      c.dim(
        "\n  O extrator só lê a página que você já está vendo e copia para a área de\n" +
        "  transferência. Não faz requisição nem envia nada. Confira o JSON antes de importar.\n",
      ),
    );
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
        candidateId,
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
      const status = opts.status === undefined ? undefined : parseSkillStatus(opts.status);
      const rows = await candidateSkills(candidateId, status);
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
      const candidateId = await syncCandidateFromProfile();
      await auditSkill(candidateId, Number(id), "confirmed", { level: opts.level });
      console.log(`${c.green("\u2713")} #${id} confirmada`);
    });
  });

skills
  .command("reject <id>")
  .description("Reject a false positive")
  .action(async (id: string) => {
    await withDb(async () => {
      const candidateId = await syncCandidateFromProfile();
      await auditSkill(candidateId, Number(id), "rejected");
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
      const category = opts.category === undefined ? undefined : parseSkillCategory(opts.category);
      const rows = await listCatalog(category);
      let cat = "";
      for (const r of rows) {
        if (r.category !== cat) {
          cat = r.category;
          console.log(c.bold(`\n  ${cat.toUpperCase()}`));
        }
        console.log(`    ${truncate(r.name, 26)} ${c.dim(r.aliases.slice(0, 4).join(", "))}`);
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
    const { missingProfileEnv } = await import("./core/profile/load.ts");
    if (missingProfileEnv.length > 0) {
      console.log(
        c.yellow(`! sem valor para ${missingProfileEnv.join(", ")} — defina em .env (ver .env.example)`),
      );
    }
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

/**
 * O programa montado, para quem quiser rodá-lo sem ser pelo terminal.
 *
 * Existe por uma razão só, e ela é de teste: sem isto o arquivo não exporta
 * nada e termina executando `parseAsync(process.argv)`, então importá-lo de um
 * teste executa a CLI com o argv do vitest. A bancada contornava com uma
 * subclasse do `Command` real, e a subclasse existia só para recuperar o
 * `program` que este `export` agora entrega.
 *
 * A CLI continua sendo a mesma: o `program` é o mesmo objeto que a guarda
 * abaixo executa.
 */
export function buildProgram(): typeof program {
  return program;
}

/**
 * Só executa quando ESTE arquivo é o ponto de entrada.
 *
 * `import.meta.url` comparado ao caminho do processo. Sem a guarda, qualquer
 * import dispara a CLI — e é o que impedia testá-la sem um subprocesso, que por
 * sua vez daria 0% de cobertura para sempre, porque a instrumentação do V8
 * acompanha o worker e não os filhos.
 */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  program.parseAsync(process.argv).catch((error: unknown) => {
    console.error(c.red(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}
