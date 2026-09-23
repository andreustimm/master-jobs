-- Origem das linhas de `source` que já existiam (#223). Idempotente.
--
-- Toda linha de sync existente nasceu do YAML (`ensureSources`). As demais —
-- `manual`, `recruiter` e `<kind>:~terms` — ficam com o padrão `system`.
-- Nenhuma linha vira gerida aqui: isso só acontece por
-- `jho sources import --apply` ou por edição do admin, para que ambiente vazio
-- e fixture continuem nascendo do arquivo.
UPDATE "production"."source"
SET "origin" = 'yaml'
WHERE "origin" = 'system'
  AND "kind" IN ('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'recruitee', 'himalayas', 'remotive', 'arbeitnow', 'remoteok', 'adzuna', 'braintrust', 'careers', 'jobicy', 'workable', 'hackernews')
  AND "handle" NOT LIKE '~%';
