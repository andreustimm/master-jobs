\set ON_ERROR_STOP on

-- These are available in the Supabase Postgres distribution. Keep the
-- extensions in their default schemas so local SQL matches Supabase SQL.
-- The image's extension hooks grant helper functions to this role. The
-- standalone image may not create it when POSTGRES_USER is overridden.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    CREATE ROLE postgres LOGIN SUPERUSER CREATEDB CREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    CREATE ROLE supabase_admin SUPERUSER CREATEDB CREATEROLE NOLOGIN;
  END IF;
  IF current_user <> 'supabase_admin' THEN
    GRANT supabase_admin TO CURRENT_USER;
  END IF;
END
$$;

SET ROLE supabase_admin;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgmq;
RESET ROLE;
