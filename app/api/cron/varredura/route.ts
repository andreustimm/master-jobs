import { NextResponse, type NextRequest } from "next/server";
import {
  SLICE_TOUCHES_THIRD_PARTIES,
  parseSweepSlice,
  runSweep,
  type SliceReport,
} from "../../../../src/contexts/operations/index.ts";
import { comVigia } from "../../../timeout-watch.ts";
import { cronDenied, ingestionDenied } from "../authorize.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Uma fatia da varredura por chamada: `?fatia=sync|termos|captura|reconferencia|pontuar`.
 *
 * Quem chama é o `pg_cron` do Supabase, via `pg_net` (ADR 0025; SQL em
 * `supabase/cron/varredura.sql`). Nem Vercel Cron, que no plano Hobby roda uma
 * vez por dia, nem GitHub Actions, que processa do outro lado do continente.
 *
 * A ordem das recusas é a ordem do custo: segredo antes de tudo, nome da fatia
 * antes de qualquer leitura, política de ingestão antes de rede de terceiro.
 */
export async function GET(request: NextRequest) {
  const denied = cronDenied(request);
  if (denied) return denied;

  const parsed = parseSweepSlice(request.nextUrl.searchParams.get("fatia"));
  if (!parsed.ok) return NextResponse.json({ error: "fatia desconhecida" }, { status: 400 });

  if (SLICE_TOUCHES_THIRD_PARTIES[parsed.slice]) {
    const blocked = ingestionDenied();
    if (blocked) return blocked;
  }

  const report = await comVigia(`/api/cron/varredura?fatia=${parsed.slice}`, () =>
    runSweep(parsed.slice, { alarm: raiseAlarm }),
  );
  logReport(report);
  return NextResponse.json(report);
}

/**
 * Uma linha por chamada no log da função: só números e nomes de fonte.
 * É o que a Vercel guarda sem amostragem, e o que se lê primeiro quando a
 * cadência parece ter parado.
 */
function logReport(report: SliceReport): void {
  console.info(
    JSON.stringify({
      varredura: report.slice,
      duracaoMs: report.durationMs,
      itens: report.items,
      erros: report.errors,
      unidades: report.units.length,
      semSync: report.staleSources.length,
    }),
  );
}

/**
 * Fonte há mais de duas horas sem sync: vai para o Sentry quando há DSN, e
 * sempre para o log. O domínio já limitou a uma vez por hora.
 */
async function raiseAlarm(alarm: { kind: "fonte_sem_sync"; sources: string[] }): Promise<void> {
  console.warn(JSON.stringify({ alarme: alarm.kind, fontes: alarm.sources }));
  if (!process.env.SENTRY_DSN?.trim()) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureMessage(`varredura: ${alarm.sources.length} fonte(s) há mais de 2 h sem sync`, {
      level: "warning",
      tags: { alarme: alarm.kind },
      extra: { fontes: alarm.sources },
    });
  } catch {
    // Falhar ao avisar não pode derrubar a fatia que já fez o trabalho.
  }
}
