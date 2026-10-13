## Técnico

### Corrigido

- O nome do candidato nos e-mails do acesso de recrutador e na página pública `/signup/invite` (e na linha "Convidado por" de `/signup`) nunca cai no e-mail da conta (#465, G22): `candidateFacts` devolve vazio quando nem o candidato nem a conta têm nome, e `candidateDisplayName` troca o vazio pelo rótulo neutro do idioma de quem lê (`recruiter.unnamed`) nos quatro e-mails (`inviteEmail`, `accessGrantedEmail`, `endDateChangedEmail`, `accessEndedEmail`) e nas duas telas.
- `suggestion:create` nega sessão emprestada (admin assumindo recrutador), como `access:manage` e `suggestion:decide` já faziam (G24): a sugestão chega ao candidato com o nome do recrutador, e o admin não fala por ele. `candidate:discover` segue aberto a sessão emprestada, porque só lê.
- `drizzleUserDirectory.update` zera `emailVerifiedAt` quando o e-mail da conta muda (ADR-018): um convite pendente ao endereço novo não conclui sem prova da caixa. Repetir o mesmo endereço, ainda que em outra caixa de letras, ou mudar só o nome não a zera.

## pt-BR

### Corrigido

- Quem recebe um convite ou um aviso de acesso de uma pessoa que ainda não escolheu nome vê "Candidato", e não o e-mail dela.
- O administrador que assume a identidade de um recrutador não sugere mais vagas em nome dele.
- Trocar o e-mail de uma conta na administração passa a exigir nova confirmação do endereço antes de um convite pendente a ele valer.

## en

### Fixed

- Someone who gets an invite or an access notice from a person who has not chosen a name yet sees "Candidate", not their email address.
- An administrator who takes over a recruiter's identity can no longer suggest jobs on their behalf.
- Changing an account's email in administration now requires the new address to be confirmed again before a pending invite to it takes effect.
