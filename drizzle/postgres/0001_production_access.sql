-- Group role only: login/password provisioning is an operator step, never a migration secret.
DO $$
BEGIN
  BEGIN
    CREATE ROLE master_jobs_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  EXCEPTION WHEN duplicate_object OR unique_violation THEN
    NULL; -- Independent databases in a local test cluster share this group role.
  END;
  IF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'master_jobs_runtime'
      AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) OR EXISTS (
    SELECT 1 FROM pg_auth_members WHERE member = 'master_jobs_runtime'::regrole
  ) THEN
    RAISE EXCEPTION 'master_jobs_runtime has unexpected administrative capabilities';
  END IF;
END $$;
--> statement-breakpoint
REVOKE ALL ON SCHEMA production FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA production FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA production FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA production FROM PUBLIC;
--> statement-breakpoint
-- Data API roles must have no schema access even if table defaults change.
DO $$
DECLARE principal text;
BEGIN
  FOREACH principal IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = principal) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA production FROM %I', principal);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA production FROM %I', principal);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA production FROM %I', principal);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA production FROM %I', principal);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA production TO master_jobs_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA production TO master_jobs_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA production TO master_jobs_runtime;
--> statement-breakpoint
-- Defaults belong to the migration executor. Keep that role stable across releases.
ALTER DEFAULT PRIVILEGES IN SCHEMA production
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO master_jobs_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA production
  GRANT USAGE, SELECT ON SEQUENCES TO master_jobs_runtime;
