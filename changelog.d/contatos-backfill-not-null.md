## Técnico

### Corrigido

- Migration `0034_contatos_candidato_obrigatorio` (#405, continuação do #379), numa transação só: apaga a linha de `target_account` sem dono e sem URL que tem gêmea (mesmo `name`, `category` e `company`, nulo casando com nulo) já atribuída ao candidato de slug `default`; atribui o resto a esse candidato; cria `target_account_candidate_url_idx`, único em `(candidate_id, linkedin_url)`; remove o índice global `target_account_url_idx`; e torna `candidate_id` NOT NULL. Sem candidato `default` e com linha sem dono, o `SET NOT NULL` falha (23502) e o lote inteiro volta atrás. **Migração não aditiva** (`data-rewrite` ×2, `constraint-on-existing`, `drop`, `set-not-null`): suspende a promoção automática até revisão humana (ADR 0028).
- `addContact` casa pela URL do LinkedIn só dentro da rede do candidato, e a mesma URL entra em outra conta sem tocar no contato da primeira. A colisão de duas gravações simultâneas da mesma URL na mesma conta relê a linha e atualiza, em vez de devolver 23505. Sai `ContactUrlTaken` e a recusa "fora da sua rede" de `jho contacts add`.
- A importação do snapshot legado deixa de transferir `target_account` (`exclude-unowned`): o snapshot não diz de quem é cada contato, e a coluna passou a ser obrigatória.

## pt-BR

### Corrigido

- Sua rede de contatos antiga volta a aparecer em Indicações. Ela tinha sumido quando separamos a rede de cada conta.
- Duas contas podem cadastrar a mesma pessoa pelo endereço do LinkedIn, cada uma na própria rede.

## en

### Fixed

- Your earlier network of contacts shows up again in Referrals. It had disappeared when each account got its own network.
- Two accounts can add the same person by LinkedIn address, each in its own network.
