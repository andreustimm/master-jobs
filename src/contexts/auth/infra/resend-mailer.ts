/**
 * Envio por Resend, com queda para o terminal.
 *
 * `RESEND_API_KEY` é do usuário e não pode ser gerada por ninguém além dele.
 * A ausência dela **não** é erro: sem chave, localmente, o link vai para o
 * terminal, que é exatamente como este projeto já entregava o link mágico. Em
 * deployment hospedado a ausência também não bloqueia, mas o link não é
 * impresso — ver `withheldMailer`. Falhar o cadastro de
 * conta porque não há provedor de e-mail configurado seria transformar um
 * detalhe de infraestrutura em bloqueio de produto.
 */
import { isLocalProcess } from "../domain/open-mode.ts";
import type { Mailer, MailResult, OutgoingMail } from "../ports-mailer.ts";

const ENDPOINT = "https://api.resend.com/emails";

/**
 * O que aparece no terminal quando não há chave.
 *
 * Imprime o corpo inteiro, inclusive o link: é um ambiente de desenvolvimento
 * de um único operador, e esconder o link aqui só obrigaria a ir buscá-lo no
 * banco. Num deployment hospedado ele NUNCA é escolhido — lá o log é lido por
 * outras pessoas, e `configuredMailer` usa `withheldMailer`, que não imprime o
 * corpo.
 */
export const consoleMailer: Mailer = {
  name: "console",
  async send(mail: OutgoingMail): Promise<MailResult> {
    console.log(
      [
        "",
        "  ┌─ e-mail NÃO enviado (configure RESEND_API_KEY e RESEND_FROM)",
        `  │  para: ${mail.to}`,
        `  │  assunto: ${mail.subject}`,
        "  │",
        ...mail.text.split("\n").map((line) => `  │  ${line}`),
        "  └─",
        "",
      ].join("\n"),
    );
    return { ok: true, id: null };
  },
};

export function resendMailer(apiKey: string, from: string, fetchImpl = fetch): Mailer {
  return {
    name: "resend",
    async send(mail: OutgoingMail): Promise<MailResult> {
      try {
        const response = await fetchImpl(ENDPOINT, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text }),
        });

        if (!response.ok) {
          // O corpo do erro pode citar o destinatário; o STATUS não. Só o
          // status sobe, porque esta string vai para log e log de autenticação
          // não é lugar de endereço de e-mail.
          return { ok: false, error: `resend respondeu ${response.status}` };
        }

        const body = (await response.json().catch(() => null)) as { id?: string } | null;
        return { ok: true, id: body?.id ?? null };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "falha de rede ao enviar",
        };
      }
    },
  };
}

/**
 * O que roda quando o e-mail não pode sair e o corpo não pode ir para o log.
 *
 * O corpo de um e-mail de recuperação É a credencial: quem lê o link troca a
 * senha. Num deployment da Vercel o `console.log` vai para o log das funções,
 * que é lido por quem tem acesso ao painel, retido e exportado — imprimir o
 * link ali entrega a conta de qualquer pessoa que pedir recuperação a quem
 * estiver lendo o log. Por isso este adapter avisa, alto e sem ambiguidade,
 * mas não imprime destinatário, assunto nem corpo.
 *
 * Devolve falha, e não sucesso: nada foi entregue, e o `auth_event` precisa
 * registrar `reset_send_failed` para o operador ver pelo histórico que a
 * recuperação está muda. A resposta da tela não muda — ela nunca muda.
 */
export const withheldMailer: Mailer = {
  name: "withheld",
  async send(): Promise<MailResult> {
    console.warn(
      "[auth] ALERTA: e-mail transacional NÃO enviado — RESEND_API_KEY e RESEND_FROM " +
        "precisam estar configurados neste ambiente. O conteúdo foi omitido do log " +
        "porque carrega um link de acesso.",
    );
    return { ok: false, error: "e-mail não configurado (RESEND_API_KEY/RESEND_FROM)" };
  },
};

/**
 * O mailer configurado; sem configuração, o de terminal ou o que omite.
 *
 * O terminal só é aceitável onde o log é a tela de quem opera: sem chave
 * nenhuma, num processo local. Chave presente com remetente faltando
 * é intenção de enviar pela metade — imprimir o link ali seria justamente o
 * vazamento que a chave veio evitar.
 *
 * Lê o ambiente uma vez por chamada em vez de guardar em módulo: o teste troca
 * a variável entre casos, e um valor capturado na importação tornaria isso
 * impossível de exercitar.
 */
export function configuredMailer(env = process.env): Mailer {
  const key = env.RESEND_API_KEY?.trim();
  const from = env.RESEND_FROM?.trim();
  if (key && from) return resendMailer(key, from);
  // Lista de permissão: o terminal só vale onde o processo se declara local
  // ou não se declara deployment nenhum (`isLocalProcess`, a mesma regra do
  // modo aberto). Produção, preview, `JHO_ENV` desconhecido ou `VERCEL=1`
  // omitem o corpo — valor inventado depois cai no lado seguro.
  if (key || !isLocalProcess(env)) return withheldMailer;
  return consoleMailer;
}
