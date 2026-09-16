## Executive Summary

Add a fail-closed environment gate at the core ingestion boundary and seed a
small fixture corpus for dev/staging. Keep scheduler checks as defense in depth,
but do not rely on them for safety. Local diagnostic ingestion remains an
explicit opt-in; recurring ingestion is production-only.

## System Architecture

### Component Overview

- **Environment policy** — pure allow/deny decision from normalized runtime context.
- **Ingestion entrypoints** — sync, scrape, recheck, probe, and Compozy sweep call the policy before I/O.
- **Fixture seed** — deterministic insert/reset for sample jobs, applications, events, and personas.
- **Schedulers/workflows** — cron and Actions enforce production allowlist and omit production secrets elsewhere.
- **E2E harness** — starts a disposable fixture environment and asserts no source network call.

## Implementation Design

### Core Interfaces

```ts
export type IngestionContext = {
  environment: "production" | "staging" | "dev" | "local" | "preview";
  explicitOptIn: boolean;
  /** Normalized by the deployment boundary; false when missing or malformed. */
  productionAllowlistSatisfied: boolean;
};

export function canRunIngestion(context: IngestionContext):
  | { allowed: true }
  | { allowed: false; reason: string };
```

The raw deployment configuration is normalized before this pure policy is
called. Missing or unknown environment values and a missing/malformed
production allowlist normalize to a denied context. The policy is fail-closed:
production is allowed only when `productionAllowlistSatisfied` is true, and the
entrypoint raises a typed operational error before constructing an HTTP adapter,
queue client, or probe worker.

### Data Models

Fixtures reuse the existing schema. Seed at least four workplace types, four
job lifecycle states, two candidates, two recruiters, and application events.
Keep descriptions short, synthetic, and stable. Do not introduce a production
dump table or a second raw-payload store.

### API Endpoints

No new public endpoint is required. Existing read pages operate on fixtures.
The CLI/worker entrypoints return a documented environment-block error and exit
without a partial ingestion mutation.

## Integration Points

- **GitHub Actions/Vercel Cron/Compozy** — production-only schedule and secrets.
- **Source adapters/HTTP** — never resolved in blocked contexts.
- **Supabase/Turso** — production credentials absent from preview/staging.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|---|---|---|---|
| `src/core/ingest/` | modified | guard before network and queue work | add policy call and error |
| `src/core/sources/` | modified | avoid adapter resolution when blocked | test no network |
| `src/core/db/seed*` | new/modified | bounded sample corpus | idempotent fixtures |
| `.github/workflows/` | modified | schedule allowlist | review environment contexts |
| `vercel.json`/cron routes | modified | no staging ingestion | gate and secret separation |
| `tests/` | new/modified | policy, seed, no-network coverage | assign all IDs |

## Testing Approach

Pure unit tests cover every policy branch and input failure. Integration tests
use a disposable database and spies at the HTTP boundary to prove blocked
contexts never resolve adapters or queues. E2E runs authenticated personas over
fixtures and checks list/history behavior without network. Static workflow/env
tests verify production secrets are not present in preview/staging contracts.

## Development Sequencing

### Build Order

1. Normalize environment policy and guard every ingestion entrypoint.
2. Add fixture seed/reset and bounded sample assertions.
3. Gate workflows/cron/secrets and run E2E/QA.

### Technical Dependencies

- Existing environment variable contract and deployment contexts.
- Disposable test database and HTTP fixture/spies.
- Existing auth/persona fixtures for candidate and recruiter isolation.

## Monitoring and Observability

Record aggregate blocked attempts by environment and routine name. Do not log
URLs, descriptions, headers, tokens, or PII. A block is expected in dev/staging;
alert only on unexpected production blocks or a staging workflow that schedules
ingestion.

## Technical Considerations

### Key Decisions

- **Guard in core plus scheduler:** defense in depth prevents both forgotten
  cron and direct CLI misuse.
- **Synthetic fixtures:** deterministic, cheap, and sufficient for product tests.
- **No remote dev/staging schemas in first Supabase project:** shared quota and
  compute make separate schemas less isolated than a local/ephemeral database.

### Known Risks

- A stale environment variable could block a legitimate local diagnostic run;
  show a clear opt-in message and keep the default safe.
- Production canary connectivity is no longer covered by staging; document a
  controlled production check after release.
- Fixture drift can hide a schema change; run migrations and seed in CI.

## Architecture Decision Records

- [ADR-001: Fixtures and fail-closed ingestion](adrs/adr-001.md)
- [ADR-0021: Non-production environments use synthetic data](../../../docs/adr/0021-ambientes-nao-produtivos-com-dados-sinteticos.md)
