## Técnico

### Adicionado

- Migração `0028_candidate_public_facts` (aditiva, veredito `[]`): sete fatos em `candidate` — `work_model text[]`, `experience_level`, `availability`, `start_timeframe`, `open_to_relocation`, `area`, `languages`, todos anuláveis — e um opt-in por fato (`public_*`, `boolean default false`, anulável pelo contrato da importação do snapshot; nulo é desligado). Sem FK. `postSnapshotColumns` declara nulo/`false` para a importação legada (#327, parte A).
- `src/core/candidate-public-facts.ts` (puro): listas controladas, `parsePublicFactsForm()` (recusa com código valor fora da lista, texto longo, contato — inclusive os e-mails cadastrados e telefone sem marca — e pretensão salarial ou valor com cara de dinheiro) e `publicFactsFrom()` (só publica com opt-in `=== true`, valor reconhecido e texto livre dentro do teto, sem contato nem valor).
- `src/core/public-cv.ts`: `containsPay()`, a régua de pretensão do CV em campo curto, sobre espaço colapsado (linear). Área e idiomas usam ainda `containsShortFieldContact()` e `containsShortFieldPay()` (`candidate-public-facts.ts`): telefone sem marca e uma régua de valor própria dos campos curtos, separada do `MONEY_LIKE` do currículo, com limite declarado (ano sem moeda nem rótulo, número por extenso e `k` de um dígito passam).
- `PublicProfile.facts` na lista de permissão de `publicProfile()`, coluna a coluna.
- `setPublicFactsAction` (`guardOwnCandidate` antes de ler o formulário, candidato da sessão) e o cartão "Dados do perfil público" em `/candidate` (`app/candidate/public-facts.tsx`), com o "Mostrar no perfil público" ao lado de cada campo.
- `/p/[slug]`: faixa de fatos com modelo de trabalho, nível e disponibilidade; cartão "Em resumo" na lateral com área, idiomas, prazo e aceita mudar. Rótulos em `publicFacts.*` (pt-BR e en).
- E2E: `checkPublicFacts` (ligado aparece, desligado ausente do HTML, 375px) sobre duas fixtures, e a área `public-facts` (edição, persistência, recusa de contato). O teste de duas colunas passa a medir a lateral inteira contra a coluna principal.

## pt-BR

### Adicionado

- Na Área do candidato há um cartão novo, "Dados do perfil público", para informar modelo de trabalho, nível de experiência, disponibilidade, prazo para começar, se aceita mudar de cidade ou país, área e idiomas. Cada dado só aparece no perfil público quando você marca "Mostrar no perfil público" — todos começam desmarcados. Pretensão salarial não é um desses campos e nunca aparece.
- O perfil público mostra os dados escolhidos: modelo de trabalho, nível e disponibilidade no topo, e o restante num cartão "Em resumo".

## en

### Added

- The candidate area has a new "Public profile details" card to fill in work model, experience level, availability, start date, openness to relocation, field and languages. Each detail only appears on the public profile when you tick "Show on public profile" — all start unticked. Salary expectation is not one of these fields and is never shown.
- The public profile shows the chosen details: work model, level and availability at the top, and the rest in an "At a glance" card.
