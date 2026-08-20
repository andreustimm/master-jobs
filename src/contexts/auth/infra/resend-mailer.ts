/**
 * Envio por Resend, com queda para o terminal.
 *
 * `RESEND_API_KEY` é do usuário e não pode ser gerada por ninguém além dele.
 * A ausência dela **não** é erro: sem chave, o link vai para o terminal, que é
 * exatamente como este projeto já entregava o link mágico. Falhar o cadastro de
 * conta porque não há provedor de e-mail configurado seria transformar um
 * detalhe de infraestrutura em bloqueio de produto.
 */
import type { Mailer, MailResult, OutgoingMail } from "../ports-mailer.ts";

const ENDPOINT = "https://api.resend.com/emails";

/**
 * O que aparece no terminal quando não há chave.
 *
 * Imprime o corpo inteiro, inclusive o link: é um ambiente de desenvolvimento
 * de um único operador, e esconder o link aqui só obrigaria a ir buscá-lo no
 * banco. Em produção o adapter nulo não deveria estar em uso — e é por isso que
 * ele diz, em toda mensagem, que não enviou nada.
 */
export const consoleMailer: Mailer = {
  name: "console",
  async send(mail: OutgoingMail): Promise<MailResult> {
    console.log(
      [
        "",
        "  ┌─ e-mail NÃO enviado (RESEND_API_KEY ausente)",
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
 * O mailer configurado, ou o de terminal.
 *
 * Lê o ambiente uma vez por chamada em vez de guardar em módulo: o teste troca
 * a variável entre casos, e um valor capturado na importação tornaria isso
 * impossível de exercitar.
 */
export function configuredMailer(env = process.env): Mailer {
  const key = env.RESEND_API_KEY?.trim();
  const from = env.RESEND_FROM?.trim();
  if (!key || !from) return consoleMailer;
  return resendMailer(key, from);
}
