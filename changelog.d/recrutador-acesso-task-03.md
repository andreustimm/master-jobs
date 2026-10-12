## Técnico

### Adicionado

- Convite de recrutador do link até o acesso (#465, task_03, ADR-018). `GET /signup/invite?token=…` procura o convite pelo hash e mostra a mesma página neutra para token vencido, usado, substituído, cancelado, desconhecido ou de candidato desabilitado; com link válido, sem sessão, nomeia quem convidou e o endereço esperado mascarado. `startInvitedSignup` (em `UNGUARDED_BY_DESIGN`) grava o token cru só no cookie `httpOnly` `jho_invite` (`SameSite=Lax`, validade ≤ a do link) e leva a `/signup?role=recruiter`, que marca Recrutador e mostra "Convidado por". `acceptInviteAction` (`guard("account:read")`, papel de recrutador, sessão própria) conclui num clique e prova a caixa com o token, gravando `email_verified_at` quando falta.
- `completeInvitesForAccount` roda no fim do cadastro de recrutador (social e manual, depois do commit) e depois de todo login de conta com o papel (senha, link mágico e OIDC): uma transação sob a trava de cada candidato envolvido queima cada convite pendente ao e-mail normalizado da conta antes de gravar a concessão, copia `access_expires_at`/`expiry_tz`, grava `invite_accepted` e `grant_created` e manda o e-mail de acesso concedido depois do commit. Prazo de acesso vencido expira o convite sem concessão. O destino é `/recruiter/<id>` quando o convite do cookie concluiu e `/recruiter?invite=mismatch|not_recruiter|period_over|invalid` nos outros casos; o descompasso grava `auth_event(invite_mismatch)` sem dado do candidato.
- O login por senha segue o `next` seguro (`landingForSession`), como o login social; o "Já tenho conta" do convite volta ao link.

### Removido

- O portão provisório do convite (`recruiterInvitesEnabled`, `JHO_RECRUITER_INVITES`, `invites_unavailable` e a dica `recruiterAccess.emailHintNoInvite`): com a página no ar, convidar quem não tem conta de recrutador vale em todos os ambientes.

## pt-BR

### Adicionado

- O recrutador que você convidar por e-mail agora consegue aceitar: o link do convite abre o cadastro já como Recrutador, e quem se cadastra com o endereço que você digitou cai direto no seu perfil. Outro e-mail não ganha acesso.

## en

### Added

- A recruiter you invite by email can now accept: the invitation link opens sign-up as a Recruiter, and whoever signs up with the address you typed lands right on your profile. Any other email gets no access.
