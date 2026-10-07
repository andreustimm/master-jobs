## Técnico

### Adicionado

- Seção "Acesso de recrutadores" em `/account` (#465): o candidato concede por e-mail a recrutador com conta de e-mail confirmado ou convida quem não tem (link de 7 dias, só o hash do token gravado), põe, move ou tira a data de fim no fuso do navegador, revoga com confirmação, reenvia, cancela e dispensa convites, e lê o histórico paginado. As actions de `app/account/recruiter-access-actions.ts` passam por `guardOwnCandidate("access:manage")`, que nega sessão emprestada; o id que o formulário manda é procurado só dentro do candidato da sessão.
- Caso de uso `src/contexts/auth/app/recruiter-access.ts` sobre o store `drizzleRecruiterAccess`: conceder, convidar e reenviar tomam `pg_advisory_xact_lock(hashtext('recruiter-access'), candidate_id)` e contam no histórico (10 ações do candidato em 24 h móveis, 20 convites pendentes no prazo); encerrar é UPDATE condicional com histórico na mesma transação, e só o vencedor da corrida manda e-mail. Os e-mails saem depois do commit; falha grava `auth_event(email_send_failed)` com o tipo da mensagem e, no convite, `delivery_failed_at`.
- Trabalho horário `manutencao:recruiter-access` na varredura (`SweepDeps.recruiterAccess`): expira concessões e convites vencidos, com evento do sistema e aviso de fim ao recrutador; as contagens entram no `detail` da fatia.
- `runDatabaseCleanup` apaga convites `expired`/`cancelled`/`superseded` decididos há mais de 30 dias e buscas do diretório com mais de um dia (`purgedInvites`, `purgedDirectoryQueries`, `deadInvites`).

### Alterado

- `/admin/users` mostra, por candidato, as concessões ativas e os convites pendentes, com revogar e cancelar sob confirmação (`adminRevokeGrantAction`, `adminCancelInviteAction`, `user:manage`); a action `unlinkAction` e o bloco "Acompanha" do recrutador saíram. Não há caminho de admin nem verbo de CLI para conceder ou convidar.

## pt-BR

### Novidades

- Em Minha conta, a seção "Acesso de recrutadores" deixa você dar a um recrutador acesso de leitura ao seu funil e ao currículo atual, com data de fim opcional. Quem ainda não tem conta recebe um convite por e-mail. Você vê quem tem acesso, revoga quando quiser e acompanha o histórico de tudo o que foi compartilhado.

## en

### New

- In My account, the "Recruiter access" section lets you give a recruiter read access to your funnel and current CV, with an optional end date. People without an account get an email invitation. You see who has access, revoke it whenever you want and follow the history of everything you shared.
