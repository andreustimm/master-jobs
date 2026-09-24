import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { sourceRuns } from "../../../../src/contexts/operations/index.ts";
import { capabilitiesFor, catalogSource } from "../../../../src/contexts/sourcing/index.ts";
import { requirePage } from "../../../auth";
import { getTranslator } from "../../../i18n";
import { MutationFeedbackForm } from "../../../mutation-feedback";
import { TransitionLink } from "../../../transition-link";
import { RunStatusBadge, scopeLabel } from "../../execucoes/run-view";
import {
  probeSourceAction,
  requestSourceRunAction,
  retireSourceAction,
  setSourceEnabledAction,
} from "../actions";
import { catalogErrorMessages, sourceStateLabel } from "../source-view";

export const dynamic = "force-dynamic";

const SNAPSHOT_LABEL = {
  complete: "platforms.snapshotComplete",
  partial: "platforms.snapshotPartial",
  unknown: "platforms.snapshotUnknown",
} as const;

/**
 * Uma fonte do catálogo: configuração, capacidades derivadas do adapter e as
 * operações — sondar sem gravar, habilitar, desabilitar, aposentar, "Buscar
 * agora" e "Atualizar status". Operação que o adapter não suporta não aparece
 * como botão: a capacidade aparece como texto, com o motivo.
 */
export default async function AdminPlatformPage({ params }: { params: Promise<{ id: string }> }) {
  const { t, locale } = await getTranslator();
  await requirePage("admin:access");
  // O id é `kind:handle`, e o link o codifica. Decodificar de novo o que o
  // framework já decodificou quebraria handle de `careers` com `%` na URL.
  const raw = (await params).id;
  const id = raw.includes(":") ? raw : decodeURIComponent(raw);
  const source = await catalogSource(id);
  if (!source) notFound();
  const capabilities = capabilitiesFor(source.kind);
  const { rows: runs } = await sourceRuns({ limit: 10, offset: 0, sourceId: source.id });
  const active = source.enabled && !source.retiredAt;
  const stamp = (value: string | null) => (value ? new Date(value).toLocaleString(locale) : t("platforms.never"));
  const feedback = {
    errorMessage: t("feedback.error"),
    dismissLabel: t("feedback.dismiss"),
    resultMessages: catalogErrorMessages(t),
  };

  return (
    <main className="page-content-top" data-testid="route-admin-platform">
      <TransitionLink href="/admin/plataformas" className="inline-flex items-center py-1.5 text-sm text-[var(--primary-text)] hover:underline">
        {t("platforms.back")}
      </TransitionLink>
      <header className="mt-2 pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="type-display-md min-w-0 break-words" data-user-content>{source.label}</h1>
          <Badge variant={active ? "default" : "outline"} data-testid="platform-state">
            {t(sourceStateLabel(source))}
          </Badge>
          <Badge variant="secondary">{t(source.managedAt ? "platforms.managed" : "platforms.mirrors")}</Badge>
        </div>
        <p className="mt-2 font-mono type-meta break-all text-muted-foreground" data-user-content>
          {source.id}
        </p>
        <p className="mt-1 type-caption-md text-muted-foreground">
          {t("platforms.lastSync")}: {stamp(source.lastSyncedAt)}
          {source.lastJobCount !== null ? ` · ${source.lastJobCount} ${t("platforms.jobs")}` : ""}
        </p>
      </header>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="type-display-xs">{t("platforms.capabilities")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-1 type-body-md" data-testid="platform-capabilities">
            <li>{t(SNAPSHOT_LABEL[capabilities.snapshot])}</li>
            <li>{t(capabilities.termSearch ? "platforms.termSearchYes" : "platforms.termSearchNo")}</li>
            {capabilities.verify && <li>{t("platforms.verifyYes")}</li>}
            <li className="text-muted-foreground">{t("platforms.statusReasonNo")}</li>
          </ul>
        </CardContent>
      </Card>

      {!source.retiredAt && (
        <Card className="mb-4">
          <CardContent className="grid gap-4 pt-6">
            <div className="grid gap-3 sm:flex sm:flex-wrap">
              <MutationFeedbackForm action={requestSourceRunAction} successMessage={t("runs.requested")} {...feedback} data-testid="platform-capture-form">
                <input type="hidden" name="id" value={source.id} />
                <input type="hidden" name="scope" value="source" />
                <Button type="submit" disabled={!active} className="h-auto min-h-11 w-full sm:w-auto" data-testid="platform-capture">
                  {t("platforms.captureNow")}
                </Button>
              </MutationFeedbackForm>
              {capabilities.verify && (
                <MutationFeedbackForm action={requestSourceRunAction} successMessage={t("runs.requested")} {...feedback} data-testid="platform-verify-form">
                  <input type="hidden" name="id" value={source.id} />
                  <input type="hidden" name="scope" value="verify" />
                  <Button type="submit" variant="outline" disabled={!active} className="h-auto min-h-11 w-full sm:w-auto" data-testid="platform-verify">
                    {t("platforms.verifyNow")}
                  </Button>
                </MutationFeedbackForm>
              )}
              <MutationFeedbackForm action={setSourceEnabledAction} successMessage={t(active ? "platforms.disabledSaved" : "platforms.enabledSaved")} {...feedback} data-testid="platform-toggle-form">
                <input type="hidden" name="id" value={source.id} />
                <input type="hidden" name="enabled" value={active ? "false" : "true"} />
                <Button type="submit" variant="outline" className="h-auto min-h-11 w-full sm:w-auto" data-testid="platform-toggle">
                  {t(active ? "platforms.disable" : "platforms.enable")}
                </Button>
              </MutationFeedbackForm>
            </div>

            <MutationFeedbackForm action={probeSourceAction} successMessage={t("platforms.probeReachable")} {...feedback} className="grid gap-2" data-testid="platform-probe-form">
              <input type="hidden" name="id" value={source.id} />
              <p className="type-caption-md text-muted-foreground">{t("platforms.probeHint")}</p>
              <Button type="submit" variant="outline" className="h-auto min-h-11 w-full sm:w-auto" data-testid="platform-probe">
                {t("platforms.probe")}
              </Button>
            </MutationFeedbackForm>

            <MutationFeedbackForm action={retireSourceAction} successMessage={t("platforms.retiredSaved")} {...feedback} className="grid gap-2" data-testid="platform-retire-form">
              <input type="hidden" name="id" value={source.id} />
              <label className="flex items-start gap-2">
                <input type="checkbox" name="confirm" className="mt-1 size-5" data-testid="platform-retire-confirm" />
                <span className="type-body-md">{t("platforms.retireConfirm")}</span>
              </label>
              <Button type="submit" variant="destructive" className="h-auto min-h-11 w-full sm:w-auto" data-testid="platform-retire">
                {t("platforms.retire")}
              </Button>
            </MutationFeedbackForm>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="type-display-xs">{t("platforms.runsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="type-body-md text-muted-foreground">{t("runs.empty")}</p>
          ) : (
            <ul className="divide-y divide-[var(--hairline)]" data-testid="platform-runs">
              {runs.map((run) => (
                <li key={run.id} className="flex flex-wrap items-center gap-2 py-2">
                  <TransitionLink href={`/admin/execucoes/${run.id}`} className="text-[var(--primary-text)] hover:underline">
                    #{run.id} · {scopeLabel(run, t)}
                  </TransitionLink>
                  <RunStatusBadge run={run} t={t} />
                  <span className="type-caption-md text-muted-foreground">{stamp(run.queuedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
