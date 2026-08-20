/**
 * The email ingestion pipeline (ADR 0008).
 *
 *   .eml file -> parse -> classify -> { job alerts -> jobs, ATS mail -> suggestions }
 *
 * The hard boundary, restated because it is the whole point: this never writes
 * to `application`. Funnel changes land in `mail_suggestion` for the user to
 * accept or dismiss. ADR 0005 says user decisions are the one thing the system
 * cannot regenerate; a rejection parser that is wrong once, and silently closes
 * a live process, would violate that in the most expensive way available.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { application, job, mailMessage, mailSuggestion } from "../db/schema.ts";
import { setApplicationStatusInTransaction } from "../db/repo.ts";
import { parseApplicationStatus } from "../../contexts/pursuit/domain/application.ts";
import { ensureImportSource } from "../ingest/manual.ts";
import { observeRawJob } from "../ingest/observe.ts";
import { htmlToText } from "../sources/http.ts";
import { classify } from "./classify.ts";
import { parseEml } from "./eml.ts";
import { extractAlertJobs, toRawJobs } from "./job-alert.ts";

const ALERT_SOURCE = "manual:linkedin-alert";

/** Statuses an email kind implies, when we can match it to an application. */
const KIND_TO_STATUS: Record<string, string> = {
  ats_received: "applied",
  ats_screening: "screening",
  ats_interview: "interviewing",
  ats_offer: "offer",
  ats_rejection: "rejected",
};

export type MailImportResult = {
  files: number;
  parsed: number;
  duplicates: number;
  byKind: Record<string, number>;
  jobsCreated: number;
  jobsUnchanged: number;
  jobsChanged: number;
  jobsReopened: number;
  suggestions: number;
  unmatched: number;
  warnings: string[];
};

async function collectFiles(path: string): Promise<string[]> {
  const info = await stat(path);
  if (info.isFile()) return [path];
  const entries = await readdir(path);
  return entries
    .filter((e) => [".eml", ".txt", ".html"].includes(extname(e).toLowerCase()))
    .map((e) => join(path, e))
    .sort();
}

/**
 * Find the application an ATS email refers to.
 *
 * Matching is by company name, which is imperfect — so the result is a
 * suggestion with a rationale, never an automatic move. We only consider
 * applications that are still live: a rejection email cannot re-reject
 * something already closed, and matching against closed rows would produce
 * noise on every re-import.
 */
async function matchApplication(
  candidateId: number,
  candidates: string[],
): Promise<{ applicationId: number; jobId: number; company: string; via: string } | null> {
  if (candidates.length === 0) return null;
  const db = getDb();

  const live = await db
    .select({
      applicationId: application.id,
      jobId: job.id,
      company: job.companyName,
      status: application.status,
    })
    .from(application)
    .innerJoin(job, eq(job.id, application.jobId))
    .where(
      and(
        eq(application.candidateId, candidateId),
        ne(application.status, "rejected"),
        ne(application.status, "withdrawn"),
        ne(application.status, "archived"),
      ),
    );

  for (const candidate of candidates) {
    const needle = candidate.toLowerCase();
    if (needle.length < 3) continue;
    const hit = live.find((row) => {
      const company = row.company.toLowerCase();
      return company.includes(needle) || needle.includes(company);
    });
    if (hit) {
      return {
        applicationId: hit.applicationId,
        jobId: hit.jobId,
        company: hit.company,
        via: candidate,
      };
    }
  }
  return null;
}

const FREE_MAIL = new Set(["gmail", "outlook", "hotmail", "yahoo", "icloud", "proton", "me"]);

/**
 * Candidate company names, best signal first.
 *
 * Order matters. An ATS domain identifies the *tool*, not the employer, so
 * greenhouse.io tells us nothing — but the display name almost always does:
 * ATS templates send as "Acme Corp" or "Recruiting at Acme" or "Acme via
 * Greenhouse". The subject line is the last resort because it is the noisiest.
 */
function companyCandidates(
  fromAddress: string | null,
  fromName: string | null,
  subject: string | null,
  provider: string | null,
): string[] {
  const out: string[] = [];

  if (fromName) {
    const cleaned = fromName
      .replace(/\s+via\s+\w+$/i, "")           // "Acme via Greenhouse"
      .replace(/^(recruiting|talent|careers|jobs|hr|people)\s+(at|@|de)\s+/i, "")
      .replace(/\s+(recruiting|talent|careers|hiring)\s*(team)?$/i, "")
      .replace(/\s*\(.*\)\s*$/, "")
      .trim();
    if (cleaned.length > 1 && !/^(no-?reply|do-?not-?reply)$/i.test(cleaned)) out.push(cleaned);
  }

  // Only useful when the employer runs its own mail domain.
  if (fromAddress && !provider) {
    const domain = fromAddress.split("@")[1];
    const root = domain?.split(".").slice(-2)[0];
    if (root && !FREE_MAIL.has(root)) {
      out.push(root.charAt(0).toUpperCase() + root.slice(1));
    }
  }

  // "Your application to Acme", "Update from Acme", "Acme - Software Architect"
  if (subject) {
    const m =
      /(?:application (?:to|at|for)|update from|regarding|position at)\s+([A-Z][\w&.\- ]{2,40})/i.exec(subject) ??
      /^([A-Z][\w&.\- ]{2,40})\s*[-–|:]/.exec(subject);
    if (m?.[1]) out.push(m[1].trim());
  }

  return [...new Set(out)];
}

export async function importMail(
  path: string,
  opts: { candidateId: number; dryRun?: boolean },
): Promise<MailImportResult> {
  const db = getDb();
  const files = await collectFiles(path);

  const result: MailImportResult = {
    files: files.length,
    parsed: 0,
    duplicates: 0,
    byKind: {},
    jobsCreated: 0,
    jobsUnchanged: 0,
    jobsChanged: 0,
    jobsReopened: 0,
    suggestions: 0,
    unmatched: 0,
    warnings: [],
  };

  if (files.length === 0) {
    result.warnings.push(`Nenhum arquivo .eml/.txt/.html em ${path}`);
    return result;
  }

  let alertSourceReady = false;

  for (const file of files) {
    const raw = await readFile(file, "utf8");
    const mail = parseEml(raw);
    const bodyText = mail.text ?? htmlToText(mail.html) ?? "";

    // Message-ID is the natural key; without one, fall back to the file so a
    // hand-saved export still dedupes on re-import.
    const messageId = mail.messageId ?? `file:${file}`;

    const existing = await db
      .select({ id: mailMessage.id })
      .from(mailMessage)
      .where(eq(mailMessage.messageId, messageId))
      .limit(1);

    if (existing.length > 0) {
      result.duplicates++;
      continue;
    }

    const classification = classify(mail, bodyText);
    result.parsed++;
    result.byKind[classification.kind] = (result.byKind[classification.kind] ?? 0) + 1;

    const candidates = companyCandidates(
      mail.from.address,
      mail.from.name,
      mail.subject,
      classification.provider,
    );
    const companyGuess = candidates[0] ?? null;

    /* ---- job alerts become jobs ------------------------------------- */
    let extractedJobs = 0;
    if (classification.kind === "job_alert") {
      const extraction = extractAlertJobs(mail.html, mail.text);
      result.warnings.push(...extraction.warnings.map((w) => `${file}: ${w}`));

      if (!opts.dryRun && extraction.jobs.length > 0) {
        if (!alertSourceReady) {
          await ensureImportSource(
            ALERT_SOURCE,
            "manual",
            "linkedin-alert",
            "LinkedIn job alerts (e-mail)",
          );
          alertSourceReady = true;
        }
        for (const rawJob of toRawJobs(extraction, mail.date)) {
          const observation = await observeRawJob(rawJob, ALERT_SOURCE);
          if (observation.outcome === "inserted") result.jobsCreated++;
          if (observation.outcome === "unchanged") result.jobsUnchanged++;
          if (observation.outcome === "changed") result.jobsChanged++;
          if (observation.outcome === "reopened") result.jobsReopened++;
        }
      }
      extractedJobs = extraction.jobs.length;
    }

    if (opts.dryRun) continue;

    const inserted = await db
      .insert(mailMessage)
      .values({
        messageId,
        fromAddress: mail.from.address,
        fromName: mail.from.name,
        subject: mail.subject,
        receivedAt: mail.date,
        kind: classification.kind,
        provider: classification.provider,
        companyGuess,
        bodyText: bodyText.slice(0, 20_000),
        extractedJobs,
      })
      .returning({ id: mailMessage.id });

    const mailRow = inserted[0];
    if (!mailRow) continue;

    /* ---- ATS mail becomes a suggestion, never a mutation ------------- */
    const suggestedStatus = KIND_TO_STATUS[classification.kind];
    if (suggestedStatus) {
      const match = await matchApplication(opts.candidateId, candidates);
      if (!match) result.unmatched++;

      await db.insert(mailSuggestion).values({
        mailId: mailRow.id,
        applicationId: match?.applicationId ?? null,
        jobId: match?.jobId ?? null,
        suggestedStatus,
        rationale: match
          ? `${classification.signal} — casado com "${match.company}" via "${match.via}"`
          : `${classification.signal} — nenhuma candidatura ativa correspondente${
              candidates.length > 0 ? ` (tentei: ${candidates.join(", ")})` : ""
            }`,
        confidence: match ? classification.confidence : classification.confidence * 0.5,
      });
      result.suggestions++;
    }
  }

  return result;
}

/* ------------------------------------------------------------ decisions -- */

export async function listSuggestions() {
  const db = getDb();
  return db
    .select({
      id: mailSuggestion.id,
      status: mailSuggestion.status,
      suggestedStatus: mailSuggestion.suggestedStatus,
      rationale: mailSuggestion.rationale,
      confidence: mailSuggestion.confidence,
      applicationId: mailSuggestion.applicationId,
      jobId: mailSuggestion.jobId,
      subject: mailMessage.subject,
      fromAddress: mailMessage.fromAddress,
      receivedAt: mailMessage.receivedAt,
      kind: mailMessage.kind,
    })
    .from(mailSuggestion)
    .innerJoin(mailMessage, eq(mailMessage.id, mailSuggestion.mailId))
    .where(eq(mailSuggestion.status, "pending"))
    .orderBy(sql`${mailMessage.receivedAt} desc`);
}

export async function decideSuggestion(
  candidateId: number,
  id: number,
  decision: "accepted" | "dismissed",
): Promise<{ jobId: number | null; status: string | null }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [suggestion] = await tx
      .select()
      .from(mailSuggestion)
      .where(eq(mailSuggestion.id, id))
      .limit(1);

    if (!suggestion) throw new Error(`Sugestão ${id} não existe`);
    if (suggestion.status === decision) {
      return decision === "accepted"
        ? { jobId: suggestion.jobId, status: suggestion.suggestedStatus }
        : { jobId: null, status: null };
    }
    if (suggestion.status !== "pending") {
      throw new Error(`Sugestão ${id} já foi decidida como ${suggestion.status}`);
    }

    const stamp = new Date().toISOString();
    if (decision === "dismissed") {
      await tx
        .update(mailSuggestion)
        .set({ status: decision, decidedAt: stamp })
        .where(and(eq(mailSuggestion.id, id), eq(mailSuggestion.status, "pending")));
      return { jobId: null, status: null };
    }

    if (
      suggestion.applicationId === null ||
      suggestion.jobId === null ||
      suggestion.suggestedStatus === null
    ) {
      throw new Error(`Sugestão ${id} não possui candidatura correspondente`);
    }

    const [owned] = await tx
      .select({ id: application.id })
      .from(application)
      .where(
        and(
          eq(application.id, suggestion.applicationId),
          eq(application.candidateId, candidateId),
          eq(application.jobId, suggestion.jobId),
        ),
      )
      .limit(1);
    if (!owned) throw new Error(`Sugestão ${id} pertence a outro candidato`);

    const status = parseApplicationStatus(suggestion.suggestedStatus);
    await setApplicationStatusInTransaction(
      tx,
      candidateId,
      suggestion.jobId,
      status,
      `via e-mail (sugestão #${id})`,
      stamp,
    );
    const updated = await tx
      .update(mailSuggestion)
      .set({ status: decision, decidedAt: stamp })
      .where(and(eq(mailSuggestion.id, id), eq(mailSuggestion.status, "pending")))
      .returning({ id: mailSuggestion.id });
    if (updated.length !== 1) throw new Error(`Sugestão ${id} mudou concorrentemente`);

    return { jobId: suggestion.jobId, status };
  });
}
