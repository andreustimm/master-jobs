## Técnico

### Corrigido

- O nome do candidato nos e-mails do acesso de recrutador e na página pública `/signup/invite` (e na linha "Convidado por" de `/signup`) nunca cai no e-mail da conta (#465, G22): `candidateFacts` devolve vazio quando nem o candidato nem a conta têm nome, e `candidateDisplayName` troca o vazio pelo rótulo neutro do idioma de quem lê (`recruiter.unnamed`) nos quatro e-mails (`inviteEmail`, `accessGrantedEmail`, `endDateChangedEmail`, `accessEndedEmail`) e nas duas telas.

## pt-BR

### Corrigido

- Quem recebe um convite ou um aviso de acesso de uma pessoa que ainda não escolheu nome vê "Candidato", e não o e-mail dela.

## en

### Fixed

- Someone who gets an invite or an access notice from a person who has not chosen a name yet sees "Candidate", not their email address.
