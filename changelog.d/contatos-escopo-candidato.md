## Técnico

### Segurança

- `target_account` ganha `candidate_id` obrigatório, com FK `ON DELETE CASCADE` para `candidate` (G20), e a URL do LinkedIn passa a ser única por candidato (`target_account_candidate_url_idx`). `addContact`, `listContacts`, `companiesWithContacts`, `referralOpportunities`, `seedWorkHistory` e `coldTargets` recebem `candidateId` e filtram por ele; `/referrals` e o dossiê usam o candidato da sessão, e a CLI (`contacts`, `referrals`, `engage targets`) o candidato ativo. Antes, `/referrals` mostrava a qualquer conta a contagem de empresas e os nomes dos contatos da rede do dono (#379, G39/G40).
- Migrations `0031_contatos_por_candidato` (coluna anulável, FK e índice), `0032_backfill_contatos_do_dono` (atribui as linhas existentes ao candidato de slug `default`) e `0033_contatos_candidato_obrigatorio` (`SET NOT NULL`). Lote não aditivo: suspende a promoção automática até revisão humana. Sem candidato `default`, a 0033 falha e o lote inteiro volta atrás, sem apagar nem reatribuir contato.
- A importação do snapshot legado deixa de transferir `target_account` (`exclude-unowned`): o snapshot não diz de quem é cada contato.

## pt-BR

### Corrigido

- Indicações agora mostram só a sua rede de contatos. Antes, uma conta nova via as empresas e os nomes dos contatos de outra pessoa.

## en

### Fixed

- Referrals now show only your own network of contacts. A new account used to see another person's companies and contact names.
