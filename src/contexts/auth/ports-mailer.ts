/**
 * Envio de e-mail transacional.
 *
 * Porta, e não uma chamada direta ao Resend, por dois motivos que não são
 * cerimônia:
 *
 *  1. **O teste não pode mandar e-mail.** Um dublê aqui é a diferença entre
 *     exercitar a recuperação de senha e não exercitá-la — e recuperação de
 *     senha é justamente o caminho que ninguém percorre até precisar.
 *  2. **A chave é do usuário.** Sem `RESEND_API_KEY` o sistema precisa
 *     continuar funcionando, e continua: o adapter nulo imprime o link no
 *     terminal, que é como este projeto já entregava o link mágico.
 *
 * A porta é estreita de propósito. Não há template, anexo nem lista: um e-mail
 * transacional tem destinatário, assunto e corpo, e tudo além disso seria
 * inventar requisito.
 */

export type OutgoingMail = {
  to: string;
  subject: string;
  /** Texto puro. HTML entraria como campo separado no dia em que fizer falta. */
  text: string;
};

export type MailResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string };

export type Mailer = {
  /** Nome do adapter, para o log dizer por onde a mensagem saiu — ou não saiu. */
  readonly name: string;
  send(mail: OutgoingMail): Promise<MailResult>;
};
