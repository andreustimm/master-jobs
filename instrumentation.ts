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
import { redactSecrets, safeRequest } from "./src/core/observability.ts";

/** Nome do ambiente para o Sentry, com o mais restrito como padrão. */
function environment(): string {
  return process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";
}

export async function register(): Promise<void> {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;

  const Sentry = await import("@sentry/nextjs");
  Sentry.init({
    dsn,
    environment: environment(),
    // O SHA do commit é o que liga a exceção ao código que a produziu.
    release: process.env.VERCEL_GIT_COMMIT_SHA,

    // Nunca anexar IP, cookie, cabeçalho de sessão nem corpo de requisição.
    // É o padrão do SDK; está escrito porque a linha existe para não mudar
    // por acidente numa atualização.
    sendDefaultPii: false,

    // Sem tracing. Transação carrega URL completa com query string, que é o
    // que a pessoa digitou na busca; e o valor aqui é saber que quebrou, não
    // quanto demorou. Ligar isso é uma decisão separada, com outra análise.
    tracesSampleRate: 0,

    /**
     * Última peneira, depois de tudo que o SDK montou.
     *
     * A pilha atravessa driver e biblioteca de terceiro, e nenhum deles
     * prometeu não carregar valor na mensagem — o driver do PostgreSQL traz a
     * URL de conexão inteira, com senha, no texto da exceção.
     */
    beforeSend(event) {
      if (event.message) event.message = redactSecrets(event.message);
      for (const entry of event.exception?.values ?? []) {
        if (entry.value) entry.value = redactSecrets(entry.value);
      }
      // Cookie e IP não passam nem por engano de configuração.
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
      }
      delete event.user;
      return event;
    },
  });
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
  if (!process.env.SENTRY_DSN?.trim()) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(error, safeRequest(request), context);
};
