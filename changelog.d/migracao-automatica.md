## Técnico

### Adicionado

- `migrate.yml` roda sozinho em todo push para `main` (sem filtro `paths`, que o GitHub só avalia nos primeiros 300 arquivos do diff), com `jho db migrate --additive-only`: o lote pendente no banco é classificado antes de qualquer DDL, e comando não aditivo para o job pedindo o dispatch manual, que continua existindo para aplicar o lote inteiro depois de revisão (ADR 0028, #289).
- Detector puro `src/core/db/migration-review.ts`: separa o SQL em comandos e classifica por lista de permissão (criar tabela, índice, coluna nula ou com default, enum, grant); `DROP`, `RENAME`, mudança de tipo, `SET NOT NULL`, restrição sobre dado existente, reescrita de dado, `REVOKE`, bloco procedural e forma desconhecida pedem revisão. Toda migração publicada tem veredito fixado em `tests/migration-review.test.ts`.

### Alterado

- A promoção `dev → staging` classifica `staging..alvo` com o mesmo detector: migração aditiva promove sem `confirmar-migracao`, inclusive no agendamento; não aditiva, `.sql` publicado alterado ou arquivo fora de `drizzle/postgres/` continuam exigindo a confirmação, e o erro lista arquivo, motivo e comando. `schema.ts` sai da guarda (o CI já prova a sincronia com o SQL).
- A PR `staging → main` aberta pelo robô passa a receber `qualidade` e `schema-e-migracao` na cabeça: a promoção dispara `ci.yml` por `workflow_dispatch` em `staging` (única forma de evento que o `GITHUB_TOKEN` dispara), e o dono não precisa mais fechar e reabrir a PR.
- `migrar.sh` exige `MIGRATION_MODE` (`aditiva` ou `revisada`); valor ausente ou desconhecido não migra nada.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
