import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { TranslationKey, Translator } from "../../../src/core/i18n/index.ts";
import { jobAnalysisPanel } from "../../../src/core/llm/job-analysis.ts";
import {
  RETRYABLE_ANALYSIS,
  STRUCTURE_FIELDS,
  type AnalysisStatus,
  type AnalyzedField,
  type FailureCause,
  type JobStructure,
  type Provenance,
  type StructureField,
} from "../../../src/core/llm/job-structure.ts";
import { retryJobAnalysisAction } from "../../admin/analysis-actions";
import { requestJobAnalysisAction } from "./analysis-actions";

// Constantes guardam CHAVE, nunca texto (regra 9).
const STATUS_KEY: Record<AnalysisStatus, TranslationKey> = {
  queued: "jobAnalysis.statusQueued",
  running: "jobAnalysis.statusRunning",
  succeeded: "jobAnalysis.statusSucceeded",
  partial: "jobAnalysis.statusPartial",
  failed: "jobAnalysis.statusFailed",
  paused_quota: "jobAnalysis.statusPausedQuota",
  interrupted: "jobAnalysis.statusInterrupted",
};
const FIELD_KEY: Record<StructureField, TranslationKey> = {
  seniority: "jobAnalysis.fieldSeniority",
  employmentType: "jobAnalysis.fieldEmploymentType",
  workModel: "jobAnalysis.fieldWorkModel",
  locationRestriction: "jobAnalysis.fieldLocationRestriction",
  timezone: "jobAnalysis.fieldTimezone",
  compensation: "jobAnalysis.fieldCompensation",
  requiredSkills: "jobAnalysis.fieldRequiredSkills",
};
const PROVENANCE_KEY: Record<Provenance, TranslationKey> = {
  explicit: "jobAnalysis.provenanceExplicit",
  normalized: "jobAnalysis.provenanceNormalized",
  unknown: "jobAnalysis.provenanceUnknown",
  conflict: "jobAnalysis.provenanceConflict",
};
// Por que o provedor falhou (#438), no que o admin pode fazer a respeito.
const CAUSE_KEY: Record<FailureCause, TranslationKey> = {
  model_unavailable: "jobAnalysis.causeModelUnavailable",
  unauthorized: "jobAnalysis.causeUnauthorized",
  unstable: "jobAnalysis.causeUnstable",
  rejected: "jobAnalysis.causeRejected",
  unknown: "jobAnalysis.causeUnknown",
};
/** Repetir com o mesmo modelo e a mesma chave falha de novo. */
const PERMANENT_CAUSES: readonly FailureCause[] = ["model_unavailable", "unauthorized"];

type Props = { jobId: number; admin: boolean; t: Translator["t"] };

/**
 * A análise estruturada da vaga. Mostra a tentativa mais recente; o que o
 * anúncio não sustenta aparece como desconhecido, e cada fato leva o trecho
 * que o prova. Custo, modelo e tentativas só para admin — o objeto que chega
 * para os outros papéis nem carrega esses campos.
 */
export async function JobAnalysisSection({ jobId, admin, t }: Props) {
  const panel = await jobAnalysisPanel(jobId, { admin });
  const latest = panel.latest;
  const pending = latest?.status === "queued" || latest?.status === "running";
  const done = latest?.status === "succeeded" || latest?.status === "partial";

  return (
    <section className="mb-7" data-testid="job-analysis">
      <h2 className="type-display-xs mb-1">{t("jobAnalysis.title")}</h2>
      <p className="mb-3 type-caption-md text-muted-foreground">{t("jobAnalysis.lead")}</p>
      <Card>
        <CardContent className="grid gap-4 pt-0">
          {latest === null ? (
            <p data-testid="job-analysis-none">{t("jobAnalysis.none")}</p>
          ) : (
            <>
              {pending && (
                <p data-testid="job-analysis-pending" data-status={latest.status}>
                  {t("jobAnalysis.pending")}
                </p>
              )}
              {!pending && !done && (
                <p data-testid="job-analysis-unfinished" data-status={latest.status} className="text-destructive">
                  {t("jobAnalysis.unfinished", { status: t(STATUS_KEY[latest.status]) })}
                </p>
              )}
              {latest.outdated && (
                <p data-testid="job-analysis-outdated" className="type-caption-sm text-destructive">
                  {t("jobAnalysis.outdated")}
                </p>
              )}
              {done && latest.result && <Fields structure={latest.result} t={t} />}
              <p className="font-mono type-meta text-muted-foreground" data-testid="job-analysis-version">
                {t(STATUS_KEY[latest.status])} ·{" "}
                {t("jobAnalysis.version", { prompt: latest.promptVersion, schema: latest.schemaVersion })}
              </p>
            </>
          )}
          {panel.exhausted && (
            <p data-testid="job-analysis-exhausted" className="type-caption-sm text-muted-foreground">
              {t("jobAnalysis.exhausted")}
            </p>
          )}
          {!pending && !panel.exhausted && (
            <form action={requestJobAnalysisAction}>
              <input type="hidden" name="analysisJobId" value={jobId} />
              <Button type="submit" variant="outline" data-testid="job-analysis-request">
                {latest === null ? t("jobAnalysis.request") : t("jobAnalysis.requestAgain")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
      {panel.admin && panel.attempts.length > 0 && (
        <Card className="mt-3" data-testid="job-analysis-admin">
          <CardContent className="pt-0">
            <h3 className="type-body-emphasis mb-2">{t("jobAnalysis.adminTitle")}</h3>
            <ul className="divide-y divide-[var(--hairline)]">
              {panel.attempts.map((attempt, index) => (
                <li key={attempt.id} className="grid gap-1 py-2" data-testid={`job-analysis-attempt-${attempt.id}`}>
                  <p className="type-caption-sm">
                    #{attempt.id} · {t(STATUS_KEY[attempt.status])}
                    {attempt.retryOf !== null && <> · {t("jobAnalysis.adminRetryOf", { id: attempt.retryOf })}</>}
                  </p>
                  <p className="font-mono type-meta break-all text-muted-foreground">
                    {attempt.modelId !== null &&
                      t("jobAnalysis.adminModel", { provider: attempt.providerSlug ?? "?", model: attempt.modelId })}
                    {attempt.inputTokens !== null && (
                      <>
                        {" · "}
                        {t("jobAnalysis.adminTokens", { input: attempt.inputTokens, output: attempt.outputTokens ?? "?" })}
                      </>
                    )}
                    {attempt.costEstimate !== null && (
                      <span data-testid={`job-analysis-cost-${attempt.id}`}>
                        {" · "}
                        {t("jobAnalysis.adminCost", { cost: attempt.costEstimate.toFixed(4) })}
                      </span>
                    )}
                    {attempt.errorCode !== null && (
                      <>
                        {" · "}
                        {attempt.providerStatus === null
                          ? t("jobAnalysis.adminError", { code: attempt.errorCode })
                          : t("jobAnalysis.adminErrorStatus", { code: attempt.errorCode, status: attempt.providerStatus })}
                      </>
                    )}
                  </p>
                  {attempt.cause !== null && (
                    <p
                      className="type-caption-sm break-words"
                      data-testid={`job-analysis-cause-${attempt.id}`}
                      data-cause={attempt.cause}
                    >
                      {t(CAUSE_KEY[attempt.cause])}
                    </p>
                  )}
                  {/* Só a mais recente: tentar de novo uma antiga duplicaria a cadeia. */}
                  {index === 0 && RETRYABLE_ANALYSIS.includes(attempt.status) && (
                    <form action={retryJobAnalysisAction}>
                      <input type="hidden" name="analysisId" value={attempt.id} />
                      <Button type="submit" size="sm" variant="outline" data-testid="job-analysis-retry">
                        {/* Falha que se repete com o mesmo modelo ou chave: o botão diz o que fazer antes. */}
                        {attempt.cause !== null && PERMANENT_CAUSES.includes(attempt.cause)
                          ? t("jobAnalysis.adminRetryAfterFix")
                          : t("jobAnalysis.adminRetry")}
                      </Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function Fields({ structure, t }: { structure: JobStructure; t: Translator["t"] }) {
  return (
    <dl className="grid gap-3" data-testid="job-analysis-fields">
      {STRUCTURE_FIELDS.map((name) => (
        <Field key={name} name={name} field={structure[name]} t={t} />
      ))}
    </dl>
  );
}

function Field({ name, field, t }: { name: StructureField; field: AnalyzedField<string | string[]>; t: Translator["t"] }) {
  const value = Array.isArray(field.value) ? field.value.join(", ") : field.value;
  return (
    <div className="grid gap-1" data-testid={`job-analysis-field-${name}`} data-provenance={field.provenance}>
      <dt className="type-caption-sm text-muted-foreground">{t(FIELD_KEY[name])}</dt>
      <dd className="grid gap-1">
        {field.provenance === "unknown" ? (
          <span className="text-muted-foreground">{t("jobAnalysis.unknown")}</span>
        ) : field.provenance === "conflict" ? (
          <Badge variant="secondary">{t("jobAnalysis.conflict")}</Badge>
        ) : (
          <span className="break-words" data-user-content>
            {value}
          </span>
        )}
        {field.provenance !== "unknown" && (
          <span className="type-caption-sm text-muted-foreground">{t(PROVENANCE_KEY[field.provenance])}</span>
        )}
        {field.evidence.map((quote, index) => (
          <blockquote
            key={index}
            className="border-l-2 border-[var(--border)] pl-3 type-caption-sm break-words text-muted-foreground"
            data-user-content
          >
            {quote}
          </blockquote>
        ))}
      </dd>
    </div>
  );
}
