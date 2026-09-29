import { NextResponse, type NextRequest } from "next/server";
import { runQuotaWatchNow } from "../../../../src/contexts/operations/index.ts";
import { cronDenied } from "../authorize.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Uma checagem manual do vigia de cota (ADR 0030, Fase 3).
 *
 * **Não é o que agenda a checagem em produção.** O agendador de verdade é o
 * `pg_cron`/`pg_net` do Supabase chamando as APIs da Vercel e do GitHub
 * DIRETAMENTE (`supabase/cron/watchdog.sql`), de propósito fora deste app: se
 * a Vercel tiver uma indisponibilidade real, esta rota (hospedada nela) some
 * junto, e o vigia da Fase 3 existe exatamente para continuar respondendo
 * quando isso acontece (ADR 0030 decisão 6).
 *
 * Esta rota serve para testar a coleta e a decisão sem esperar pelo `pg_cron`
 * — `curl` manual, verificação operacional (F3-M02) — e para uma tela futura
 * ler o estado sem repetir a lógica. Mesma borda de toda `/api/cron/`:
 * `CRON_SECRET` em tempo constante, antes de qualquer efeito.
 */
export async function GET(request: NextRequest) {
  const denied = cronDenied(request);
  if (denied) return denied;

  const report = await runQuotaWatchNow();
  return NextResponse.json(report);
}
