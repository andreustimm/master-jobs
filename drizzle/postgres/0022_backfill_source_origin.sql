-- Origem das linhas de `source` que já existiam (#223). Idempotente.
--
-- Toda linha de sync existente nasceu do YAML (`ensureSources`), que até aqui
-- forçava `enabled = true`. As demais ficam com o padrão `system`: `manual`,
-- `recruiter`, `<kind>:~terms` e a fonte de ATS criada por `jho jobs add`
-- (`ensureImportSource`), que nasce com `enabled = false` — é isso que a separa
-- de uma linha do arquivo com o mesmo kind.
-- Nenhuma linha vira gerida aqui: isso só acontece por
-- `jho sources import --apply` ou por edição do admin, para que ambiente vazio
-- e fixture continuem nascendo do arquivo.
UPDATE "production"."source"
SET "origin" = 'yaml'
WHERE "origin" = 'system'
  AND "kind" IN ('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'recruitee', 'himalayas', 'remotive', 'arbeitnow', 'remoteok', 'adzuna', 'braintrust', 'careers', 'jobicy', 'workable', 'hackernews')
  AND "handle" NOT LIKE '~%'
  AND "enabled" = true;