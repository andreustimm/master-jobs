import Link from "next/link";
import { notFound } from "next/navigation";
import { getJobDetail } from "../../../src/core/db/repo.ts";
import { APPLICATION_STATUSES } from "../../../src/core/db/schema.ts";
import { trackAction } from "../../actions";
import { Chip, Fit, Legend, ScoreBar } from "../../ui";

export const dynamic = "force-dynamic";

export default async function JobDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getJobDetail(Number(id));
  if (!detail) notFound();

  const { job, score, application, source } = detail;
  const blockers = (score?.blockers as string[]) ?? [];
  const matched = (score?.matchedKeywords as string[]) ?? [];
  const missing = (score?.missingKeywords as string[]) ?? [];
  const reasons = (score?.reasons as string[]) ?? [];

  return (
    <main style={{ paddingTop: 36, paddingBottom: 60 }}>
      <Link href="/jobs" style={{ fontSize: 13, color: "var(--accent)" }}>
        ← vagas
      </Link>

      <header style={{ margin: "18px 0 24px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-.02em", margin: 0 }}>
            {job.title}
          </h1>
          {application && <Chip>{application.status}</Chip>}
          {job.closedAt && <Chip tone="alert">fechada</Chip>}
        </div>
        <p style={{ color: "var(--text-2)", margin: "8px 0 0" }}>
          <strong style={{ color: "var(--text)" }}>{job.companyName}</strong>
          {job.locationRaw ? ` · ${job.locationRaw}` : ""}
        </p>
        <p className="mono" style={{ color: "var(--text-3)", fontSize: 11.5, margin: "6px 0 0" }}>
          {source?.label ?? job.sourceId} · visto em {job.firstSeenAt.slice(0, 10)}
        </p>
        <a
          href={job.applyUrl ?? job.url}
          target="_blank"
          rel="noopener"
          style={{ display: "inline-block", marginTop: 14, color: "var(--accent)", fontSize: 14 }}
        >
          {job.applyUrl ?? job.url}
        </a>
      </header>

      {score && (
        <section
          style={{
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: 20,
            marginBottom: 24,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
            <Fit value={score.fit} />
            <span style={{ color: "var(--text-2)", fontSize: 14 }}>
              de 100 · cluster <span className="mono">{score.cluster}</span>
            </span>
          </div>

          <ScoreBar parts={score as unknown as Record<string, number | null>} />
          <div style={{ marginTop: 12 }}>
            <Legend />
          </div>

          <ul style={{ margin: "16px 0 0", paddingLeft: 18, color: "var(--text-2)", fontSize: 13.5 }}>
            {reasons.map((r, i) => (
              <li key={i} style={{ marginBottom: 3 }}>
                {r}
              </li>
            ))}
          </ul>

          {blockers.length > 0 && (
            <p style={{ color: "var(--color-alert)", fontSize: 13.5, marginTop: 14, marginBottom: 0 }}>
              ⚠ {blockers.join("; ")}
            </p>
          )}

          {matched.length > 0 && (
            <p className="mono" style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 14, marginBottom: 0 }}>
              casadas: {matched.join(", ")}
            </p>
          )}
          {missing.length > 0 && (
            <p className="mono" style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 6, marginBottom: 0 }}>
              ausentes: {missing.join(", ")}
            </p>
          )}
        </section>
      )}

      <form
        action={trackAction}
        style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 28 }}
      >
        <input type="hidden" name="jobId" value={job.id} />
        <label className="mono" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--text-3)" }}>
          mover para
        </label>
        <select
          name="status"
          defaultValue={application?.status ?? "shortlisted"}
          style={{
            background: "var(--surface)",
            color: "var(--text)",
            border: "1px solid var(--line)",
            borderRadius: 6,
            padding: "6px 10px",
            fontSize: 14,
          }}
        >
          {APPLICATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          name="note"
          placeholder="nota (opcional)"
          style={{
            background: "var(--surface)",
            color: "var(--text)",
            border: "1px solid var(--line)",
            borderRadius: 6,
            padding: "6px 10px",
            fontSize: 14,
            minWidth: 220,
          }}
        />
        <button
          type="submit"
          style={{
            background: "var(--accent)",
            color: "#fff",
            border: 0,
            borderRadius: 6,
            padding: "7px 16px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Salvar
        </button>
      </form>

      {job.descriptionText && (
        <section>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 10px" }}>Descrição</h2>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              fontFamily: "inherit",
              fontSize: 14,
              lineHeight: 1.6,
              color: "var(--text-2)",
              background: "var(--sunk)",
              padding: 18,
              borderRadius: 10,
              maxHeight: 520,
              overflow: "auto",
              margin: 0,
            }}
          >
            {job.descriptionText}
          </pre>
        </section>
      )}
    </main>
  );
}
