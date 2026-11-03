# Contrato de testes — #405

Upgrade populado (`tests/postgres-upgrade-contatos.test.ts`, banco parado na
migration anterior à 0034):

- A rede vai para o candidato de slug `default` (id 10); o convidado 11 com
  `is_default = true` é ignorado; só `candidate_id` muda.
- Contato sem dono é recusado com 23502.
- A mesma URL entra em outra conta e é recusada na mesma (23505); dois
  contatos sem URL convivem.
- Órfã com gêmea do `default` é apagada e a gêmea fica; empresa nula de um lado
  só, categoria diferente, gêmea de outro candidato e órfã com URL não são
  apagadas.
- Sem candidato `default`: o migrate rejeita (23502), a contagem em
  `drizzle.__drizzle_migrations` não muda, as órfãs continuam e o índice global
  continua existindo.
- O caso da 0031 (aditiva) continua provado, agora parando na 0031.

Domínio (`tests/cov-core-contacts.test.ts`):

- A mesma URL em outra conta cria linha nova e não altera a do dono.
- Na mesma conta, `addContact` atualiza (`created: false`).
- Quatro gravações simultâneas da mesma URL na mesma conta terminam numa linha
  só, com uma única criação (reprova sem a releitura no 23505).
- O banco recusa contato sem dono (23502).

CLI (`tests/cov-cli-posicionamento.test.ts`): URL já usada por outra conta não
impede `jho contacts add` na rede ativa.

Classificador: `tests/fixtures/migration-verdicts/0034_*.json` com os vereditos
reais. Importação: `tests/postgres-schema.test.ts` aceita a coluna NOT NULL
porque a tabela é excluída. E2E: área `roles` (conta nova não vê a rede em
`/referrals`).
