import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { captureHealth } from "../../../src/contexts/sourcing/index.ts";
import type { CaptureStatus } from "../../../src/contexts/sourcing/index.ts";
import { requirePage } from "../../auth";
import { getTranslator } from "../../i18n";

export const dynamic = "force-dynamic";

const STATUSES: CaptureStatus[] = ["queued", "running", "succeeded", "waiting_quota", "failed", "skipped"];

/**
 * A saúde das capturas por termo, por plataforma.
 *
 * Só agregados (ADR-006): o administrador vê se a integração funciona, e não
 * quem busca o quê. Numa sessão emprestada a política nega `admin:access` —
 * quem assumiu um candidato não administra.
 */
export default async function AdminCapturesPage() {
  const { t, locale } = await getTranslator();
  await requirePage("admin:access");
  const health = await captureHealth(new Date());
  const number = (value: number) => value.toLocaleString(locale);

  return (
    <main className="page-content-top" data-testid="route-admin-captures">
      <header className="pb-4">
        <h1 className="type-display-md chevron mb-4">{t("captures.title")}</h1>
        <p className="type-body-md max-w-[62ch] text-muted-foreground">{t("captures.lead")}</p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {health.map((platform) => (
          <Card key={platform.platform} data-testid={`capture-health-${platform.platform}`} data-red={platform.red ? "true" : "false"}>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="font-mono type-body-emphasis" role="heading" aria-level={2}>
                {platform.platform}
              </CardTitle>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant={platform.red ? "destructive" : "outline"}>
                  {platform.red ? t("captures.red") : t("captures.ok")}
                </Badge>
                <Badge variant="outline">{platform.validated ? t("captures.validated") : t("captures.notValidated")}</Badge>
                <Badge variant="outline">{platform.enabled ? t("captures.enabled") : t("captures.disabled")}</Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-1 pt-0 type-body-md">
              <p>
                {t("captures.dayQuota")}:{" "}
                {platform.quota.exhausted
                  ? t("captures.exhausted")
                  : platform.quota.dayLimit === null
                    ? `${number(platform.quota.dayUsed ?? 0)} · ${t("captures.unlimited")}`
                    : `${number(platform.quota.dayUsed ?? 0)} / ${number(platform.quota.dayLimit)}`}
              </p>
              <p>
                {t("captures.minuteQuota")}:{" "}
                {platform.quota.minuteLimit === null
                  ? t("captures.unlimited")
                  : `${number(platform.quota.minuteUsed)} / ${number(platform.quota.minuteLimit)}`}
              </p>
              <p data-testid={`capture-health-24h-${platform.platform}`}>
                {t("captures.last24h")}:{" "}
                {STATUSES.map((status) => `${t(`captureState.${status}`)} ${number(platform.last24h[status])}`).join(" · ")}
              </p>
              <p>
                {t("captures.lastError")}: <span className="font-mono">{platform.lastErrorCode ?? t("captures.none")}</span>
              </p>
              <p>{t("captures.failedDays")}: {number(platform.consecutiveFailedDays)}</p>
              <p>{t("captures.activeTerms")}: {number(platform.activeTerms)}</p>
              {platform.dailyRepeatPaused && <p className="text-muted-foreground">{t("captures.dailyRepeatPaused")}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
