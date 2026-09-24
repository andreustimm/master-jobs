import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { catalogSources } from "../../../src/contexts/sourcing/index.ts";
import { FETCHABLE_SOURCE_KINDS } from "../../../src/core/sources/types.ts";
import { requirePage } from "../../auth";
import { getTranslator } from "../../i18n";
import { MutationFeedbackForm } from "../../mutation-feedback";
import { TransitionLink } from "../../transition-link";
import { registerSourceAction } from "./actions";
import { catalogErrorMessages, sourceStateLabel } from "./source-view";

export const dynamic = "force-dynamic";

/**
 * O catálogo de fontes (#223, tarefa 03): listar, cadastrar e abrir uma fonte
 * para sondar, habilitar, aposentar ou buscar. Só admin, e sessão emprestada
 * não entra (`admin:access` nega em bloco).
 */
export default async function AdminPlatformsPage() {
  const { t, locale } = await getTranslator();
  await requirePage("admin:access");
  const sources = await catalogSources();
  const stamp = (value: string | null) => (value ? new Date(value).toLocaleString(locale) : t("platforms.never"));

  return (
    <main className="page-content-top" data-testid="route-admin-platforms">
      <header className="pb-4">
        <TransitionLink href="/admin/operacoes" className="inline-flex items-center py-1.5 text-sm text-[var(--primary-text)] hover:underline">
          {t("operations.title")}
        </TransitionLink>
        <h1 className="type-display-md chevron mt-2 mb-4">{t("platforms.title")}</h1>
        <p className="type-body-md max-w-[62ch] text-muted-foreground">{t("platforms.lead")}</p>
      </header>

      {sources.length === 0 ? (
        <p className="mb-4 type-body-md text-muted-foreground" data-testid="platforms-empty">{t("platforms.empty")}</p>
      ) : (
        <ul className="mb-4 grid gap-3" data-testid="platforms-list">
          {sources.map((source) => (
            <li key={source.id}>
              <Card>
                <CardContent className="grid gap-2 pt-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="type-micro">{source.kind}</Badge>
                    <TransitionLink
                      href={`/admin/plataformas/${encodeURIComponent(source.id)}`}
                      className="type-body-emphasis min-w-0 break-words text-[var(--primary-text)] hover:underline"
                      data-testid={`platform-link-${source.id}`}
                      data-user-content
                    >
                      {source.label}
                    </TransitionLink>
                    <Badge variant={source.enabled && !source.retiredAt ? "default" : "outline"} data-testid={`platform-state-${source.id}`}>
                      {t(sourceStateLabel(source))}
                    </Badge>
                  </div>
                  <p className="type-caption-md min-w-0 break-all font-mono text-muted-foreground" data-user-content>
                    {source.handle}
                  </p>
                  <p className="type-caption-md text-muted-foreground">
                    {t("platforms.lastSync")}: {stamp(source.lastSyncedAt)}
                    {source.lastJobCount !== null ? ` · ${source.lastJobCount} ${t("platforms.jobs")}` : ""}
                  </p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="type-display-xs">{t("platforms.registerTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <MutationFeedbackForm
            action={registerSourceAction}
            successMessage={t("platforms.registered")}
            errorMessage={t("feedback.error")}
            resultMessages={catalogErrorMessages(t)}
            dismissLabel={t("feedback.dismiss")}
            keepFields
            className="grid gap-3"
            data-testid="platforms-register-form"
          >
            <label className="grid gap-1">
              <span className="type-caption-md">{t("platforms.kind")}</span>
              <select
                name="kind"
                className="h-11 rounded-md border border-input bg-background px-2 type-body-md text-foreground"
                data-testid="platforms-register-kind"
              >
                {FETCHABLE_SOURCE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="type-caption-md">{t("platforms.handle")}</span>
              <Input name="handle" required maxLength={300} data-testid="platforms-register-handle" />
            </label>
            <label className="grid gap-1">
              <span className="type-caption-md">{t("platforms.label")}</span>
              <Input name="label" required maxLength={120} data-testid="platforms-register-label" />
            </label>
            <label className="grid gap-1">
              <span className="type-caption-md">{t("platforms.secretRef")}</span>
              <Input name="secretRef" maxLength={64} autoComplete="off" data-testid="platforms-register-secret" />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="enabled" className="size-5" data-testid="platforms-register-enabled" />
              <span className="type-body-md">{t("platforms.enableNow")}</span>
            </label>
            <Button type="submit" className="h-auto min-h-11 w-full sm:w-auto" data-testid="platforms-register-submit">
              {t("platforms.register")}
            </Button>
          </MutationFeedbackForm>
        </CardContent>
      </Card>
    </main>
  );
}
