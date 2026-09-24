# ADR 0028 — Migração de produção automática, só quando aditiva

**Status:** aceita · 2026-09-23 · issue #289

## Contexto

Até aqui `migrate.yml` só rodava por `workflow_dispatch`, com o ref do projeto
Supabase digitado. Toda release com migração dependia de alguém lembrar de
disparar, e a Vercel publica `main` no mesmo push: entre o deploy e o disparo
manual, o código novo servia contra o schema velho.

O fluxo já registrava a regra que decide o resto: **migração aditiva sobrevive
à corrida entre deploy e migração; a que remove, renomeia ou aperta, não**
(G51). Até esta decisão, quem separava uma da outra era sempre uma pessoa, e a
promoção `dev → staging` parava em qualquer diferença em `drizzle/` ou em
`schema.ts` — inclusive numa tabela nova.

## Decisão

1. **Um detector puro decide o que é aditivo.**
   `src/core/db/migration-review.ts` separa o SQL em comandos (sem comentário,
   com literal e corpo `$$` mascarados) e classifica cada um por **lista de
   permissão**: criar schema, tabela, índice não único, sequência, enum e
   extensão; acrescentar coluna nula ou com default; acrescentar valor de enum;
   afrouxar `NOT NULL`; trocar default (`SET DEFAULT`, que só vale para linha
   nova); `GRANT`; `COMMENT`; `INSERT` sem `DO UPDATE`. Restrição
   (FK, único) só passa sobre tabela criada no mesmo lote ou sobre coluna nova
   sem default — o código no ar nunca escreve nelas. Todo o resto — `DROP`,
   `RENAME`, mudança de tipo, `SET NOT NULL`, restrição sobre dado existente,
   `UPDATE`/`DELETE`/`TRUNCATE`, `REVOKE`, bloco `DO`, função e **qualquer
   forma não prevista** — pede revisão humana.
2. **O push em `main` migra sozinho, se o lote pendente for aditivo.**
   `migrate.yml` dispara em **todo** `push` para `main` e roda
   `jho db migrate --additive-only`; sem pendência, não aplica nada. Não há
   filtro `paths`: o GitHub avalia só os primeiros 300 arquivos do diff, e
   uma promoção grande pularia a migração em silêncio. O lote classificado é
   o que o **banco** tem pendente (o critério do migrador do drizzle: a
   última aplicada pela ordem de `created_at`), não o diff do push: uma
   destrutiva barrada continua pendente, e a aditiva do push seguinte não a
   leva junto. Não aditiva interrompe o job, vermelho, **antes de qualquer
   DDL**. Uma tabela só conta como nova quando o lote a cria sem
   `IF NOT EXISTS` e com o mesmo nome qualificado; `IF NOT EXISTS` pode ser
   no-op sobre uma tabela viva.
3. **O dispatch manual continua, para o que não é aditivo.** Com o ref do
   projeto digitado, aplica o lote inteiro depois de revisão humana. Mesmo
   segredo, mesmo ambiente `production`, mesma fila de concorrência
   (`migrate-supabase-production`, sem cancelar o que está em curso).
4. **A promoção usa o mesmo detector sobre `staging..alvo`.** Migração nova e
   aditiva promove sem `confirmar-migracao`, inclusive no agendamento.
   Destrutiva, `.sql` publicado alterado ou removido, ou arquivo fora de
   `drizzle/postgres/` continuam exigindo o dispatch com
   `confirmar-migracao=true`. `schema.ts` sai da guarda: o SQL é o que chega ao
   banco, e o job `schema-e-migracao` do CI prova que os dois andam juntos.
5. **Ordem com o deploy: aceitar a corrida só para aditiva.** O push para
   `main` dispara o build da Vercel e `migrate.yml` ao mesmo tempo. O build
   leva minutos; o job, cerca de um. Para migração aditiva, os dois lados da
   corrida funcionam: o código antigo ignora tabela e coluna novas, e o código
   novo só erra se chegar antes do fim do job. Para a não aditiva, nenhuma
   ordem automática é segura, e quem escolhe a ordem é uma pessoa: contrair o
   que o código novo já não usa vai **depois** do deploy (dispatch); mudar o
   que o código antigo ainda usa vai **antes** do merge, pela CLI, como na
   1.15.0 ([deploy.md](../engineering/deploy.md#migração-que-não-é-aditiva)).

## Consequências

- A release comum (tabela, coluna, índice) chega a produção sem passo manual,
  e a promoção deixa de parar nela.
- Uma migração aditiva que falhe deixa o código novo servindo sobre o schema
  velho até a correção. O job fica vermelho e o erro traz a causa do servidor
  (`withDatabaseCause`). A migração que falhou continua pendente e roda
  primeiro em qualquer lote seguinte, então a correção é no próprio `.sql`
  (nunca aplicado), e a promoção pede `confirmar-migracao` por ele ter mudado.
- Banco vazio nunca é criado pelo push: `0001` revoga privilégio e `0002` muda
  tipo, então `--additive-only` recusa o histórico inteiro. Provisionar é
  sempre manual.
- Falso positivo custa um dispatch; falso negativo derruba produção. Por isso
  a lista é de permissão e toda migração publicada tem veredito fixado em
  `tests/migration-review.test.ts` — migração nova entra naquela tabela no
  mesmo commit.
- `vercel-ignore-build.sh` não muda: `drizzle/` constrói, como todo arquivo
  fora da lista de exclusão.

## Alternativas rejeitadas

- **`ignoreCommand` da Vercel esperando o check da migração:** o comando só
  decide pular ou construir; pular não reagenda. Esperar dentro dele prende o
  build num laço de consulta à API do GitHub, com token no ambiente de build.
- **Migrar no build da Vercel:** poria `DATABASE_MIGRATION_URL` — DDL em
  produção — no ambiente de build, lido por toda prévia e todo redeploy, e
  desfaria a separação entre credencial de runtime e de migração.
- **Migrar na PR `staging → main`, antes do merge:** rodaria DDL de produção
  num evento de PR, com código ainda não aprovado; se a PR não fosse mesclada,
  produção ficaria à frente de `main`.
- **Classificar só o diff do push:** deixa passar a destrutiva barrada junto
  com a aditiva seguinte, porque o migrador aplica tudo o que está pendente.
