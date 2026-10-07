## Técnico

### Adicionado

- Fundação do acesso de recrutador concedido pelo candidato (#465): migração aditiva `0036_recrutador_acesso` cria `recruiter_grant` (concessão com estado, prazo e fuso; único parcial por par ativo; `CHECK` de que concessão ativa tem recrutador), `recruiter_invite` (token só em hash, um pendente por candidato e e-mail), `recruiter_access_event` (histórico só de acréscimo), `recruiter_suggestion`, `recruiter_suggestion_by` e `recruiter_directory_query`, com `ON DELETE` declarado no schema e no DDL. A mesma migração copia cada vínculo de `recruiter_candidate` para uma concessão ativa sem fim, com evento `grant_created` do sistema; `recruiter_candidate` fica congelada.
- Regras puras em `src/contexts/auth/domain/recruiter-access.ts`: normalização de e-mail, data de fim no fuso do navegador, conceder ou convidar, limite em janela móvel, conclusão de convite, marca da concessão e máscara de e-mail.
- Ações `access:manage`, `suggestion:create`, `suggestion:decide` e `candidate:discover` em `can()`; as duas primeiras de candidato negam sessão emprestada.
- Construtores localizados dos e-mails do recrutador (`app/recruiter-emails.ts`, chaves `email.recruiter*`): convite, acesso concedido, prazo alterado, acesso encerrado por causa e sugestões agrupadas, sem currículo, funil, notas nem dado de perfil.

### Alterado

- O acesso do recrutador passa a vir só de concessões `active` com prazo nulo ou futuro (`linkedCandidatesFor`, e as leituras do admin pelo mesmo predicado): revogação, prazo e conta removida cortam na próxima requisição.
- Revogar pela administração deixa de apagar o vínculo: a concessão fica `revoked`, com o nome do administrador no histórico do candidato. Apagar a conta de um recrutador encerra antes as concessões ativas como `ended_account_removed`.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
