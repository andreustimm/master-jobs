## Técnico

### Corrigido

- Convite de recrutador desligado até `/signup/invite` existir (#465): o e-mail levava a uma rota que responde 404. `recruiterInvitesEnabled` só liga com `JHO_RECRUITER_INVITES=on` num processo `local` ou `e2e` fora da Vercel; desligado, `grantOrInvite` devolve `invites_unavailable` antes de gravar convite, histórico ou e-mail (não conta no limite) e `resendInvite` recusa antes do banco. Conceder a recrutador com conta confirmada segue igual. A dica do formulário deixa de prometer convite (`recruiterAccess.emailHintNoInvite`).
- O histórico de `/account` e a lista de `/admin/users` mostram a data de fim no fuso em que o candidato a escolheu, e não no fuso do servidor (um dia a mais em São Paulo na Vercel). O `detail` de `end_date_changed` grava instante e fuso (`endDateEventDetail`/`readEndDateEventDetail`; linha antiga sem fuso cai em UTC), e `formatDate` aceita um `timeZone` opcional.

## pt-BR

### Corrigido

- Em Minha conta, o histórico de acesso mostra a data de fim no dia que você escolheu, e não um dia depois.

## en

### Fixed

- In My account, the access history shows the end date on the day you chose, not one day later.
