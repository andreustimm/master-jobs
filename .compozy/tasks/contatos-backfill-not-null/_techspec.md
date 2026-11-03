# Techspec — #405: rede de contatos com dono obrigatório

Continuação do #379. A 0031 deu a `target_account.candidate_id` uma coluna
anulável; a rede gravada antes dela ficou sem dono e oculta para todos.

## Migration `0034_contatos_candidato_obrigatorio`

Uma transação (o migrador do drizzle roda o lote pendente inteiro numa só),
nesta ordem:

1. `DELETE` da órfã sem `linkedin_url` cuja gêmea — mesmo `name`, `category` e
   `company` (`IS NOT DISTINCT FROM`) — já é do candidato de slug `default`.
   Órfã com URL nunca é apagada.
2. `UPDATE` das órfãs restantes para o candidato de slug `default`.
3. `CREATE UNIQUE INDEX target_account_candidate_url_idx (candidate_id, linkedin_url)`.
4. `DROP INDEX target_account_url_idx`.
5. `ALTER COLUMN candidate_id SET NOT NULL`.

Sem `default` e com órfã, o passo 5 falha com 23502 e tudo volta. Não há
`DO $$ RAISE`: somaria o veredito `procedural` e a mensagem do 23502 já nomeia
a coluna.

Veredictos do classificador: `data-rewrite` ×2, `constraint-on-existing`,
`drop`, `set-not-null` — revisão humana obrigatória (ADR 0028).

## Código

- `schema.ts`: `.notNull()` e o índice único por candidato.
- `contacts.ts`: `addContact` casa pela URL só dentro do candidato; 23505 com
  URL (corrida na mesma conta) relê e atualiza. `ContactUrlTaken` sai, e com
  ele a recusa de `jho contacts add`: a única colisão possível agora é a corrida,
  que a releitura resolve.
- `select-production.ts`: `target_account` vira `exclude-unowned`.

## Fora do escopo

Aplicar em produção, promover `staging → main`, qualquer leitura ou escrita
no banco de produção.
