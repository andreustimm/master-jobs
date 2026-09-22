-- Busca por termo indexada (#214): o índice trigrama da migration seguinte
-- depende de `pg_trgm`. Aditiva e idempotente: se a extensão já existe — o
-- caminho recomendado no Supabase é habilitá-la antes pelo painel, no schema
-- `extensions` —, isto não faz nada. `pg_trgm` é extensão confiável (trusted)
-- desde o PostgreSQL 13, então a role de migração não precisa ser superusuária.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
