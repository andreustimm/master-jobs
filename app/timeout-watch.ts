import {
  shouldLogTiming,
  timingLogLine,
  warnIfSlower,
  type TimingReport,
} from "../src/core/observability.ts";

/**
 * O aviso que sai antes de a Vercel matar a função.
 *
 * A decisão de o que sai daqui é pura, em `src/core/observability.ts`; este
 * arquivo só a liga ao SDK, que é o que a regra 4 chama de adapter burro.
 *
 * O limite é 22 segundos contra os 30 da plataforma. A folga existe porque o
 * aviso precisa de rede para sair, e um processo prestes a ser encerrado não é
 * o melhor momento para descobrir isso.
 */
const LIMITE_MS = 22_000;

/** Uma leitura de tela acima disto deixa a medida por estágio no log. */
const LENTA_MS = 1_000;

/**
 * Registra onde uma leitura de tela gastou o tempo, quando vale registrar.
 *
 * Sai no log da função (Vercel), não no Sentry: o Sentry roda sem tracing de
 * propósito, porque uma transação carrega a URL com o filtro da pessoa. A linha
 * é só número e nome de estágio. `JHO_PERF_LOG=1` faz sair sempre, para medir
 * uma tela em vez de esperar que ela piore.
 */
export function registrarTempo(relatorio: TimingReport): void {
  try {
    if (!shouldLogTiming(relatorio, { slowMs: LENTA_MS, always: process.env.JHO_PERF_LOG === "1" })) return;
    console.info(timingLogLine(relatorio, process.env.VERCEL_REGION));
  } catch {
    // Medir nunca pode ser o motivo de a tela falhar.
  }
}

/**
 * Roda a leitura da página e, se ela travar, deixa rastro.
 *
 * Não corrige nada nem interrompe nada. Existe porque o pior defeito deste
 * sistema é o único invisível: `FUNCTION_INVOCATION_TIMEOUT` encerra o
 * processo, o código não lança, e o Sentry fica limpo enquanto a tela está
 * quebrada. Um processo vivo aos 22 segundos ainda consegue falar.
 */
export function comVigia<T>(rota: string, trabalho: () => Promise<T>): Promise<T> {
  return warnIfSlower(rota, LIMITE_MS, trabalho, {
    report: ({ route, elapsedMs }) => {
      if (!process.env.SENTRY_DSN?.trim()) return;
      void import("@sentry/nextjs")
        .then((Sentry) => {
          Sentry.captureMessage(`rota perto do limite da função: ${route}`, {
            level: "warning",
            tags: { rota: route, motivo: "pre_timeout" },
            extra: { limiteMs: elapsedMs, limiteDaPlataformaMs: 30_000 },
          });
        })
        // Falhar ao avisar não pode virar um segundo defeito sobre o primeiro.
        .catch(() => {});
    },
  });
}
