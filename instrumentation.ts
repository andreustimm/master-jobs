/**
 * Relato de erro do servidor.
 *
 * Existe por um caso concreto: o corte de produção da 1.13.1 devolveu 500 em
 * toda página que toca o banco por 28 minutos, e quem descobriu foi uma pessoa
 * abrindo o site. Nenhuma linha deste sistema avisou. Erro de servidor que
 * ninguém vê dura o tempo que levar até alguém tentar usar o produto.
 *
 * **Sem `SENTRY_DSN`, nada acontece.** Ausência de provedor não bloqueia
 * produto — a mesma regra do `RESEND_API_KEY` na recuperação de senha. O
 * desenvolvimento local segue sem conta, sem rede e sem ruído.
 *
 * **Só servidor e edge. Não há SDK de browser aqui**, e a razão é a CSP em
 * `next.config.ts`: ela declara `connect-src 'self'`, então o SDK de browser
 * seria bloqueado ao enviar — silenciosamente, como já aconteceu com a fonte
 * do Google. Habilitá-lo exigiria abrir a CSP para um terceiro e passar a
 * mandar JS de cliente que estas páginas hoje não mandam. O erro que motivou
 * isto era do servidor; é o servidor que passa a ser visto.
 */

import type { Instrumentation } from "next";
import { safeRequest, sentryServerOptions } from "./src/core/observability.ts";

/** Nome do ambiente para o Sentry, com o mais restrito como padrão. */
function environment(): string {
  return process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";
}

/**
 * Instrumentação nunca derruba o que ela observa.
 *
 * `register` roda ANTES de o servidor atender a primeira requisição, e o Next
 * espera que ela conclua. Uma exceção aqui — DSN rotacionado para um valor
 * inválido, bug numa atualização do SDK, módulo que não carrega — não degrada
 * o relato de erro: ela impede o servidor de subir. Trocaríamos "não sei que
 * quebrou" por "quebrou tudo", que é pior que não ter relato nenhum.
 *
 * É a mesma guarda que `instrumentation-client.ts` já tem na navegação, pelo
 * mesmo motivo. E é literalmente o modo de falha do corte da 1.13.1: uma
 * verificação correta, em posição de bloquear o processo inteiro.
 */
export async function register(): Promise<void> {
  try {
    await iniciarRelato();
  } catch {
    // Sem console.error: o erro que interessa é o da aplicação, e ruído no log
    // de inicialização a cada requisição fria esconde exatamente isso.
  }
}

async function iniciarRelato(): Promise<void> {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;

  const Sentry = await import("@sentry/nextjs");
  /**
   * A configuração inteira — peneiras, amostragem, `sendDefaultPii: false`,
   * nenhuma propagação de trace — mora em `src/core/observability.ts`, pura,
   * porque aqui dentro nenhum teste a alcançava. É ela que carrega a promessa
   * de privacidade: a pilha atravessa driver e biblioteca de terceiro, o
   * driver do PostgreSQL traz a URL de conexão com senha no texto da exceção,
   * e uma transação traz a URL com o filtro da pessoa.
   *
   * Tracing amostrado por `SENTRY_TRACES_SAMPLE_RATE` (padrão 10%; `0`
   * desliga). O SHA do commit é o release: é o que liga a exceção e o trace ao
   * código que os produziu.
   */
  Sentry.init(
    sentryServerOptions({
      dsn,
      environment: environment(),
      release: process.env.VERCEL_GIT_COMMIT_SHA,
      tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE,
    }),
  );
}

/**
 * Erro capturado pelo servidor do Next.
 *
 * A requisição é reduzida ANTES de entrar no SDK. O `request` que o Next
 * entrega traz todos os cabeçalhos, `cookie` inclusive, e encaminhá-lo como
 * veio é o modo padrão de integrar — é por isso que ele está errado aqui.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  try {
    if (!process.env.SENTRY_DSN?.trim()) return;
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureRequestError(error, safeRequest(request), context);
  } catch {
    // Falhar ao RELATAR um erro não pode virar um segundo erro por cima do
    // primeiro. O que a pessoa vê continua sendo a falha original.
  }
};
