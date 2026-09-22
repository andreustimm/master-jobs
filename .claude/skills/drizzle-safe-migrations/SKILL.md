---
name: drizzle-safe-migrations
description: Production-safe Drizzle migration workflow for schema changes that require data backfills or constraint tightening. Use when changing enums/check constraints/defaults, removing status values, or sequencing custom and generated migrations in Drizzle. Trigger on requests about Drizzle migration safety, deployment-safe backfills, migration ordering, and rollback planning. Don't use for ORMs other than Drizzle, app-layer query optimization, or greenfield schema design.
metadata:
  author: Pedro Nauck
  github: https://github.com/pedronauck
  repository: https://github.com/pedronauck/skills
---
# Drizzle Safe Migrations

## Project binding: master-jobs

This repository runs **PostgreSQL** (Supabase in production, Docker at
`127.0.0.1:5432` locally and in tests). The binding below overrides the generic
text of this skill wherever they differ.

- Config: `drizzle.postgres.config.ts` (`dialect: "postgresql"`,
  `schemaFilter: ["production"]`, `strict: true`). Migrations live in
  `drizzle/postgres/`; the journal is `drizzle/postgres/meta/_journal.json`.
- `drizzle/*.sql` and `drizzle/meta/` (top level) are the **legacy SQLite
  history**, kept only for the snapshot import in `scripts/migration/`. Never
  edit, generate into, or reason about the current database from them. No
  `pragma`, table rebuild or libSQL/Turso step applies to the current runtime.
- Prefix shell commands with `rtk` in Codex/OpenCode; use pnpm, never Bun.
- Apply locally with `rtk pnpm jho db migrate` (uses `DATABASE_MIGRATION_URL`,
  the privileged connection — the runtime role `master_jobs_runtime` has no
  DDL, by design and by `tests/postgres-permissions.test.ts`). Production is
  applied **only** by the manual `migrate.yml` workflow from `main`, which
  validates the project ref before connecting (`docs/engineering/deploy.md`).
  Never point a local command at production.
- Any diff in `drizzle/` or `src/core/db/schema.ts` suspends automatic
  `dev` → `staging` promotion for human migration review. Removing or renaming
  a column/table is never a single migration: expand, deploy, backfill, then
  contract in a later release.
- Every FK declares `onDelete` explicitly in `schema.ts`, including
  `"no action"` (`tests/fk-delete-intent.test.ts`), and the applied DDL must
  match it in `pg_constraint` (`tests/cov-db-schema.test.ts`).
- A backfill → constraint pair needs a populated-upgrade test, not only the
  empty-database run every other test does. Follow
  `tests/postgres-upgrade.test.ts`: migrate a disposable database to the
  previous tag, insert rows in that shape, migrate to head, assert the
  transformation, the untouched funnel (`application`, `application_event`) and
  the rejection of new inconsistent data.

## Overview

Use this skill to run database migrations in a way that is auditable, deployment-safe, and consistent with Drizzle's migration model.

## Core Rules

- Always generate schema migrations with the project script (`rtk pnpm db:generate`).
- Never hand-edit generated schema migration files.
- Generate data backfills as custom migrations (`rtk pnpm db:generate -- --custom --name <name>`) and edit only that custom SQL file.
- Apply data normalization before tightening constraints.
- Keep one-off data fixes in migration history, not as hidden runtime logic, unless an emergency hotfix requires temporary mitigation.

## Workflow

1. Classify the change:
   - `schema-only`: only column/table/index/default changes.
   - `data+schema`: old rows must be transformed before new constraints/defaults.
2. For `data+schema`, create custom migration first:
   - `rtk pnpm db:generate -- --custom --name <descriptive_name>`
   - Add idempotent backfill SQL.
3. Generate schema migration second:
   - `rtk pnpm db:generate`
4. Verify migration ordering in `drizzle/postgres/meta/_journal.json`:
   - backfill migration index must be lower than constraint-tightening migration index;
   - `when` must strictly increase down the journal, and your new entries must be
     newer than the last migration already applied anywhere. The Drizzle
     migrator only applies entries whose `when` is greater than the newest row
     in `drizzle.__drizzle_migrations` — an entry with an older `when` (typical
     after a rebase over someone else's migration) is **skipped silently**.
     Regenerate instead of hand-editing timestamps.
5. Verify generated SQL and snapshots:
   - backfill migration contains only intended data change.
   - schema migration contains constraint/default/type changes.
6. Run the repository verification gates:
   - `rtk pnpm db:generate` again must report "No schema changes" (CI repeats it);
   - `rtk pnpm check` (includes the FK, upgrade and permission suites against
     disposable PostgreSQL);
   - `rtk pnpm test:e2e` when the change is visible.
7. Document deployment notes:
   - expected data transformations,
   - lock-risk areas,
   - rollback strategy.

## Backfill Requirements

- Use restrictive `WHERE` clauses.
- Prefer idempotent updates (`UPDATE ... WHERE status = 'legacy_value'`).
- Do not mix unrelated DDL/DML in the same migration.
- Keep SQL explicit and minimal.

## Constraint Tightening Pattern

When removing allowed values (enum/check):

1. Backfill existing rows to valid target value.
2. Update default to new value.
3. Tighten check/enum constraint.

In PostgreSQL:

- All pending migrations run in **one transaction**. A failure rolls every
  pending file back; fix the cause and rerun the same command. Never insert
  into `drizzle.__drizzle_migrations` by hand. Consequence: statements that
  cannot run inside a transaction (`CREATE INDEX CONCURRENTLY`, `VACUUM`,
  `ALTER TYPE ... ADD VALUE` used in the same transaction) do not belong in a
  migration file.
- Lock cost matters because the whole batch holds its locks until commit:
  `ALTER TABLE` takes `ACCESS EXCLUSIVE`; `SET NOT NULL` and a plain
  `ADD CONSTRAINT ... CHECK/FOREIGN KEY` scan the table under that lock. For a
  large table prefer `ADD CONSTRAINT ... NOT VALID` followed by
  `VALIDATE CONSTRAINT` in a later migration. `ADD COLUMN` with a constant
  default is metadata-only.
- `ALTER TABLE ... ADD ... REFERENCES` without `ON DELETE` means `NO ACTION`.
  Declare the action in `schema.ts` and let `db:generate` write it; the two
  schema tests fail on either an undeclared intent or a mismatch.

## Anti-Patterns

- Hand-editing generated schema migration files.
- Tightening constraints before backfilling existing data.
- Hiding one-time migration logic in app startup code without migration artifacts.
- Running migrations without validating order and `when` in the Drizzle journal.
- Proving a data migration only on an empty database.
- Following SQLite-era instructions (`pragma`, table rebuild, `drizzle/meta/`)
  for the current PostgreSQL database.

## Reference

- See `references/production-playbook.md` for command templates and review checklists.
