import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { sourceHealthSummary } from "../../../src/core/ingest/health.ts";
import {
  ROUTINES,
  ROUTINE_LABEL_KEYS,
  routineRequestConfigured,
} from "../../../src/contexts/operations/index.ts";
import type { TranslationKey } from "../../../src/core/i18n/index.ts";
import { requirePage } from "../../auth";
import { getTranslator } from "../../i18n";
import { MutationFeedbackForm } from "../../mutation-feedback";
import { requestRoutineAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Onde o administrador pede manutenção do acervo.
 *
 * A tela **pede**; quem executa é o GitHub Actions. Não é preferência de
 * arquitetura: a função web morre em 30 segundos e o sync levou de 18 a 27
 * minutos na última medição, então rodar aqui dentro seria prometer o que a
 * plataforma não entrega. Sem credencial de disparo, o botão explica o que
 * falta e a execução diária automática continua de pé.
 *
 * O estado não vem da API do GitHub: vem das tabelas que as rotinas escrevem.
 * Assim a tela não depende de token para dizer a verdade sobre o acervo.
 */
export default async function AdminOperationsPage() {
  const { t, locale } = await getTranslator();
  await requirePage("admin:access");

  // Em série: a leitura do estado é uma consulta, e o pool tem três conexões
  // (ver `src/core/db/client.ts`).
  const sources = await sourceHealthSummary();
  const configured = routineRequestConfigured();
  const stamp = (value: string | null) =>
    value ? new Date(value).toLocaleString(locale) : t("operations.never");

  return (
    <main className="page-content-top" data-testid="route-admin-operations">
      <header className="pb-4">
        <h1 className="type-display-md chevron mb-4">{t("operations.title")}</h1>
        <p className="type-body-md max-w-[62ch] text-muted-foreground">{t("operations.lead")}</p>
      </header>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="type-display-xs">{t("operations.sourcesTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2">
          <p className="type-body-md">
            {t("operations.sourcesSummary", { ok: sources.ok, total: sources.total })}
            {sources.error > 0 ? ` · ${t("operations.sourcesBroken", { count: sources.error })}` : ""}
          </p>
          <p className="type-caption-md text-muted-foreground" data-testid="operations-last-sync">
            {t("operations.lastSync")}: {stamp(sources.lastSyncedAt)}
          </p>
        </CardContent>
      </Card>

      {sources.broken.length > 0 && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="type-display-xs">{t("operations.brokenTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-2">
            {sources.broken.map((entry) => (
              <div key={entry.id} className="grid min-w-0 grid-cols-1 gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant="destructive" className="type-micro">{entry.kind}</Badge>
                  <span data-user-content className="min-w-0 break-words font-semibold">{entry.label}</span>
                </span>
                {entry.lastError && (
                  <span data-user-content className="type-caption-md wrap-anywhere text-muted-foreground">
                    {entry.lastError}
                  </span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="mb-4">
        <CardContent className="grid grid-cols-1 gap-3 pt-6">
          {!configured && (
            <p className="type-body-md text-[var(--warn)]" role="status" data-testid="operations-not-configured">
              {t("operations.notConfigured")}
            </p>
          )}
          {ROUTINES.map((routine) => (
            <MutationFeedbackForm
              key={routine}
              action={requestRoutineAction}
              successMessage={t("operations.requested")}
              errorMessage={t("feedback.error")}
              resultMessages={{
                notConfigured: t("operations.notConfigured"),
                unknownRoutine: t("operations.unknownRoutine"),
              }}
              dismissLabel={t("feedback.dismiss")}
              className="grid gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-between"
              data-testid={`operations-form-${routine}`}
            >
              <input type="hidden" name="routine" value={routine} />
              <span className="type-body-md">{t(ROUTINE_LABEL_KEYS[routine] as TranslationKey)}</span>
              <Button
                type="submit"
                variant={routine === "tudo" ? "default" : "outline"}
                className="h-auto min-h-11 w-full sm:w-auto xl:h-8 xl:min-h-0"
                data-testid={`operations-request-${routine}`}
              >
                {t("operations.request")}
              </Button>
            </MutationFeedbackForm>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="type-display-xs">{t("operations.howItRuns")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="type-body-md max-w-[62ch] text-muted-foreground">{t("operations.howItRunsBody")}</p>
        </CardContent>
      </Card>
    </main>
  );
}
