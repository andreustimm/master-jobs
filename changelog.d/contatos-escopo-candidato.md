## Técnico

### Segurança

- `target_account` ganha `candidate_id` (anulável), com FK `ON DELETE CASCADE` para `candidate` (G20) e índice `target_account_candidate_idx`, pela migration aditiva `0031_contatos_por_candidato`. `addContact`, `listContacts`, `companiesWithContacts`, `referralOpportunities`, `seedWorkHistory` e `coldTargets` recebem `candidateId` e filtram por ele; `/referrals` e o dossiê usam o candidato da sessão, e a CLI (`contacts`, `referrals`, `engage targets`) o candidato ativo. Antes, `/referrals` mostrava a qualquer conta a contagem de empresas e os nomes dos contatos da rede do dono (#379, G39/G40).
- Contatos gravados antes da 0031 ficam sem dono e **ocultos para todas as contas, inclusive o dono**, até o lote da #405 (backfill para o candidato `default`, URL única por candidato, drop do índice global e NOT NULL), que exige revisão humana da migration. Até lá, a URL do LinkedIn continua única no banco inteiro: a segunda conta que cadastra a mesma pessoa é recusada.

## pt-BR

### Corrigido

- Indicações agora mostram só a sua rede de contatos. Antes, uma conta nova via as empresas e os nomes dos contatos de outra pessoa. Os contatos cadastrados antes desta versão ficam ocultos até uma próxima atualização.

## en

### Fixed

- Referrals now show only your own network of contacts. A new account used to see another person's companies and contact names. Contacts added before this version stay hidden until an upcoming update.
