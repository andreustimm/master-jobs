## Técnico

### Adicionado

- Área do recrutador com acesso concedido (#465, task_04): `/recruiter` lista os candidatos das concessões vigentes, 25 por página por nome e depois id, com "acesso desde", o fim no fuso escolhido e as sugestões pendentes dele; `/recruiter/[id]` traz o nome no título da aba (`generateMetadata` confere vínculo e política antes de ler), o funil só de leitura (20 por página, página fora do intervalo cai na primeira ou na última, consulta própria `recruiterFunnelRows` sem nota, canal nem fit) e as sugestões dele na concessão vigente; `/recruiter/[id]/cv` mostra só o documento corrente e `/cv/download` o devolve byte a byte como `text/markdown`, com o nome do candidato no arquivo. Abrir a página ou o currículo grava `recruiter_grant.last_accessed_at` no máximo uma vez por minuto, por UPDATE condicional. Id fora de `linkedCandidateIds`, malformado ou depois do fim responde o mesmo 404 nas quatro entradas.
- Sugestões de vaga (ADR-015): regras puras em `src/contexts/pursuit/domain/recruiter-suggestion.ts` (`validateNote`, `decideSuggest`, `decideAccept`, `digestDue`), store `drizzle-recruiter-suggestions.ts` e serviço `app/recruiter-suggestions.ts`. Criar ou juntar-se à pendente de outro recrutador roda sob `pg_advisory_xact_lock(hashtext('recruiter-access'), candidate_id)`, com a concessão vigente relida na transação, 20 por recrutador e candidato em 24 h, nota de até 500 caracteres e recusa de vaga fechada ou arquivada, repetida e já decidida; grava `suggestion_received` no histórico e nunca toca `application`. O aviso ao candidato sai na hora quando não houve outro desse recrutador na última hora; a reserva marca `notified_at` sob a mesma trava e é desfeita se o envio falhar (`auth_event(email_send_failed, "suggestions")`). O passo 3 do trabalho horário `manutencao:recruiter-access` manda os avisos agrupados que ficaram.
- `suggestJobAction` (`/recruiter/[id]/suggest`, busca de vagas abertas por título ou empresa) e `createRecruiterJobAction` com `suggestFor` (`/jobs/new?suggestFor=<id>`): o id do candidato é só seletor dentro de `session.linkedCandidateIds`, fora dela 404 antes de qualquer gravação, e `suggestion:create` decide. Exceção registrada em `SELECTOR_ID_BY_DESIGN` (`tests/support/entry-inventory.ts`), conferida por `tests/architecture.test.ts` e coberta por `tests/entry-denial.test.ts`.
- `/suggestions` e `acceptSuggestionAction`/`declineSuggestionAction` (`guardOwnCandidate("suggestion:decide")`, negado à sessão emprestada): aceitar trava a sugestão escopada ao candidato da sessão e, só quando a vaga não está no funil, cria a candidatura em Backlog com canal `recruiter` por `setApplicationStatusInTransaction`; a que existe fica intacta. Recusar não lê nem escreve o funil. `pipelineRows` ganha `suggestedByRecruiter`, e a navegação do candidato mostra a contagem das pendentes.

### Alterado

- O login por senha segue o `next` seguro (`safeNext`) que o proxy anexa, como o login social: o link do e-mail de acesso concedido aberto sem sessão volta à página do candidato depois de entrar.

## pt-BR

### Novidades

- O recrutador a quem você deu acesso agora vê o seu currículo atual, além do funil, e pode sugerir vagas para você. As sugestões chegam em "Sugestões", no menu, com a nota dele; só você decide: aceitar põe a vaga no seu funil, recusar deixa tudo como está.
- Para recrutadores: a lista de candidatos mostra desde quando você tem acesso e até quando, e a página de cada pessoa traz o currículo para ler ou baixar e a lista das vagas que você sugeriu, com a resposta dela.

## en

### New

- A recruiter you gave access to now sees your current CV as well as your pipeline, and can suggest jobs to you. Suggestions arrive under "Suggestions" in the menu, with the recruiter's note; only you decide: accepting adds the job to your pipeline, declining leaves everything as it is.
- For recruiters: the candidate list shows since when and until when you have access, and each person's page has their CV to read or download and the list of jobs you suggested, with their answer.
