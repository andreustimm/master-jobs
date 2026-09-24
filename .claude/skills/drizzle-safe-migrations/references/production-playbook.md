# Drizzle Production Migration Playbook — master-jobs (PostgreSQL)

Current database: PostgreSQL, schema `production`, migrations in
`drizzle/postgres/`. The top-level `drizzle/*.sql` and `drizzle/meta/` are
legacy SQLite history and are never part of this procedure.

## Decision Tree

- If no existing data can violate new constraints: use generated schema migration only.
- If existing data may violate new constraints: use custom backfill migration first, then generated schema migration.
- If a column or table is removed or renamed: split into expand → backfill →
  contract across releases; the contract step ships only after no deployed
  code reads the old shape.

## Command Sequence

```bash
# 1) Create custom backfill migration (empty SQL file + journal entry)
rtk pnpm db:generate --custom --name <backfill_name>

# 2) Edit only that custom file
#    drizzle/postgres/<NNNN>_<backfill_name>.sql

# 3) Generate schema migration
rtk pnpm db:generate

# 4) Nothing left to generate (CI repeats this and fails on a diff)
rtk pnpm db:generate

# 5) Apply to the local Docker database (loopback only, never production)
export DATABASE_MIGRATION_URL="postgresql://<user>:<password>@127.0.0.1:5432/<db>"
rtk pnpm jho db migrate
DATABASE_URL="$DATABASE_MIGRATION_URL" rtk pnpm jho db check

# `rtk pnpm check` provisions its own disposable PostgreSQL container for the
# schema, upgrade and permission suites.
```

## Example Backfill SQL

Schema-qualified, idempotent, restrictive `WHERE` — see
`drizzle/postgres/0005_backfill_primary_tracks.sql` for a real one.

```sql
UPDATE "production"."tasks"
SET "status" = 'pending'
WHERE "status" = 'saved';
```

## Migration Review Checklist

- Backfill migration is ordered before schema-tightening migration.
- `when` strictly increases in `drizzle/postgres/meta/_journal.json`, and new
  entries are newer than any migration already applied (the migrator skips
  older ones silently).
- Custom migration changes only the intended rows and is safe to rerun.
- Schema migration removes legacy values from constraints/enums; defaults reflect the new target value.
- Snapshots in `drizzle/postgres/meta/` are present for generated migrations.
- Every FK has `onDelete` written in `schema.ts` and the same action in
  `pg_constraint`: `tests/fk-delete-intent.test.ts` and `tests/cov-db-schema.test.ts`.
- Lock-heavy statements on large tables use `NOT VALID` + `VALIDATE` or are
  split; nothing requires running outside a transaction.
- Data migrations have a populated-upgrade test modeled on
  `tests/postgres-upgrade.test.ts` (previous tag → rows → head), asserting that
  `application` and `application_event` are unchanged.
- No DDL or grants for the runtime login: privileges come from
  `0001_production_access` and `tests/postgres-permissions.test.ts` proves them.

## Deployment Checklist

- The PR says it carries a migration and adds its verdict to the table in
  `tests/migration-review.test.ts`. An additive migration (per
  `src/core/db/migration-review.ts`) promotes without confirmation; anything
  else suspends automatic `dev` → `staging` promotion until a human reviews it.
- Confirm a Supabase backup/point-in-time recovery window exists.
- Production is migrated by `migrate.yml` from `main` (ADR 0028): on every push
  to `main` (no path filter) it runs `jho db migrate --additive-only`,
  which refuses before any DDL when the pending batch in the database is not
  additive; the manual dispatch, with the confirmed project ref, applies the
  whole batch after review. Both run `jho db check` with the privileged
  `DATABASE_MIGRATION_URL`. The Vercel deploy and the migration are not
  coordinated: when old code cannot run on the new schema (or the reverse),
  sequence them by hand as `docs/engineering/deploy.md` ("Migração que não é
  aditiva") describes.
- Record row counts before and after the backfill.
- Run app smoke checks after migration.

## Failure and Resume

- The migrator wraps all pending files in one transaction: a failure leaves
  the database at the previous version, with nothing half-applied.
- Fix the cause (data or conflicting object), then rerun the same command.
  `tests/postgres-upgrade.test.ts` proves both halves.
- Never edit `drizzle.__drizzle_migrations` or an applied migration file.

## Rollback Strategy

- Drizzle has no down migrations. Prefer forward-fix migrations instead of
  editing old migration files.
- If rollback is necessary, add a new migration that reintroduces valid
  compatibility states; data removed by a contract step is only recoverable
  from backup, which is why contraction ships last and separately.
