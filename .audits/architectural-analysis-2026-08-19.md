# Architectural analysis — 2026-08-19

## Executive summary

The project is a disciplined modular monolith, but it is not yet the fully
modular, candidate-scoped architecture its ADRs and agent instructions claim.
Its strongest properties are real: the dependency graph has no cycles, the
codebase has no production `any` or TypeScript suppressions, ingestion does not
write the application funnel, sources use adapters, the scorer is shared by
CLI/UI/compare, and Auth/Skills demonstrate viable hexagonal boundaries.

The highest risk is a mismatch between authorisation and persistence. Page and
action guards now derive candidate ownership from the session, but
`application` and `job_score` are still keyed globally by job. With two owner
accounts, the database cannot represent two independent funnels or scores.
The other critical risk is that a funnel transition and its append-only event
are separate writes with no state machine or transaction.

This audit produced 20 executable remediation tasks in
[`docs/engineering/architecture-remediation.md`](../docs/engineering/architecture-remediation.md).
The comparison feature follows the existing canonical scorer and Skills API;
its remaining architectural work is decomposition, not replacement.

Security defects found during the audit and fixed in the same workstream:

- private candidate actions no longer accept a global resource;
- only an owner can read/write their own candidate, even if an admin is linked
  to a candidate id;
- candidate pages/actions derive scope from the session;
- `/api/export` resolves and authorises the session inside the Route Handler;
- outbound job URL fetching rejects private/reserved networks and validates
  every redirect hop;
- synthetic `manual://` URLs are never fetched or rendered as external links.

## Scope and method

- Production inventory: 138 TypeScript/TSX files, approximately 23,960 LOC.
- Tests: 44 files, approximately 6,600 LOC at audit time.
- Persistence: 27 Drizzle/libSQL tables.
- Implemented bounded contexts: `auth`, `skills`.
- Internal dependency graph: approximately 321 edges, zero cycles.
- Reviewed: source, tests, schema, migrations, CLI, App Router UI, ADRs,
  architecture/data-model docs, imports, type escapes and dead exports.
- Excluded: `.git`, `.next`, `node_modules` and generated artefacts.
- Architecture fitness suite at audit time: 28/28 checks passed. Additional
  security fitness checks were added after the inventory.

## Statistics

| Category | Result |
|---|---:|
| Completely dead files | 0 |
| Confirmed dead exports | 6 |
| Dead internal bindings | 1 |
| Estimated removable LOC | 160–180 |
| Relevant duplication groups | 5 |
| Dependency cycles | 0 |
| God classes | 0 |
| Excessive inheritance | 0 |
| Commented-out code | 0 |
| Production `any` | 0 |
| `@ts-ignore` / `@ts-expect-error` | 0 |
| Type escape assertions | 15 |
| Main layer-violation groups | 3 |
| Empty legacy directories | 10 |

## Dead code analysis

### Completely dead files

None confirmed. Framework route files, shadcn components and configured
adapters were not treated as dead solely because static imports are indirect.

### Confirmed dead exports

| Export | Evidence |
|---|---|
| `detectSkills` | `src/core/skills.ts` |
| `syncDetectedSkills` | `src/core/skills.ts` |
| `tokensMatch` | `src/contexts/auth/infra/drizzle-store.ts` |
| `openTasks` | `src/core/db/repo.ts` |
| `engagementStats` | `src/core/positioning/engage.ts` |
| `extractRequirements` | `src/core/scrape/extract.ts` |

Removal must follow a fresh whole-repository consumer search; some exports may
be retained intentionally for an imminent CLI surface, but that decision must
be explicit rather than inferred.

### Dead internal binding

`src/contexts/auth/domain/password.ts` retains an unused
`promisify`/`scrypt` binding pair.

### Empty legacy directories

`src/contexts/skills/ports`, `src/core/linkedin`, `src/db`, `src/ingest`,
`src/lib`, `src/linkedin`, `src/positioning`, `src/report`, `src/scoring` and
`src/sources`. They make the migration state ambiguous and should be removed
after confirming no tooling relies on them.

## Duplicated functionality

### Exact or materially equivalent duplication

1. Raw-job persistence and company resolution exist independently in
   `src/core/ingest/run.ts` and `src/core/ingest/manual.ts`. The paths already
   differ in score invalidation and `applyUrl` fallback.
2. Skills detection exists in the legacy `src/core/skills.ts` and the newer
   `src/contexts/skills` context.
3. Text boundary/normalisation matching appears in scoring, candidate gap
   analysis, the Skills domain and the legacy Skills module.
4. Session duration/login details are repeated across Auth app/infra/UI.
5. Skill categories and types are represented both in the Drizzle schema and
   the Skills domain.

### Similar implementations that should converge

- reports and dossiers each mix query, DTO construction, rendering, path and
  filesystem writes;
- funnel-aware read models are repeated across board, detail, referrals,
  analytics and CLI SQL;
- candidate document replacement and application event recording both need a
  shared transaction policy, although they are different aggregates.

## Architectural anti-patterns

### Boundary and ownership violations

- `application` has no `candidateId`; it is unique only by `jobId`.
- `job_score` is identified only by `jobId`, despite candidate-specific profile
  inputs.
- Auth application modules import Drizzle/schema implementations directly, and
  login UI reaches into Auth infrastructure.
- `QueuePort` shares a file and persistent type with its Drizzle adapter and
  use cases, so the current filename-based fitness test misses the coupling.

### Consistency violations

- application state and `application_event` are written in separate operations;
- candidate current-document replacement is not transactional or constrained;
- accepting a mail suggestion and changing the funnel are separate operations;
- board status filtering happens after SQL pagination, while count/facets
  silently cap materialisation at 5,000 rows.

### Modular migration ambiguity

The ADR describes six contexts, but only Auth and Skills are explicit bounded
contexts. `MIGRATION.md`, `AGENTS.md` and the live tree disagree about whether
the migration is complete. This is more harmful than an acknowledged partial
migration because it removes the reliable map a contributor needs to choose a
module owner.

### Not classified as anti-patterns

- a modular monolith is appropriate here;
- table-backed queues are a documented KISS trade-off, not a missing broker;
- functional composition is preferable to a DI container;
- `score.ts` is long but cohesive and pure, so it is not a god module;
- a filesystem port is not warranted until a real alternative exists.

## Type issues

- Production `any`: none.
- TypeScript suppression comments: none.
- Type escapes: 12 `as never` assertions and 3 double casts.
- `src/core/mail/run.ts` widens status mappings to
  `Record<string, string>`, losing the domain unions.
- `hasRole(session, role: string)` accepts arbitrary strings and casts rather
  than taking the `Role` union.
- `app/compare/page.tsx` casts the score through `unknown` to feed `ScoreBar`;
  a typed `ComparisonDetail` should remove this.
- i18n keys are accepted as runtime strings; the dictionary shape validates
  locale completeness but does not make `t()` calls compile-time safe.

## Code smells

### Long orchestration surfaces

| Surface | Approximate size / concern |
|---|---|
| `src/cli.ts` | 2,601 lines, 96 commands, direct SQL in multiple commands |
| `src/core/db/schema.ts` | 937 lines, 27 tables across contexts |
| `src/core/db/repo.ts` | Board, Cockpit and Pursuit read/write models together |
| `src/core/candidate.ts` | 444-line transaction script module |
| `app/compare/page.tsx` | ~329-line auth/query/mapping/render surface |
| `app/candidate/page.tsx` | ~241-line page |
| `src/core/ingest/run.ts` | ~131-line main use case |
| `src/core/mail/run.ts` | ~126-line mixed IO/application flow |

No function was flagged based on line count alone. The smell is recorded when
length coincides with multiple reasons to change.

### Hidden or ineffective configuration

- freshness falls back to `Date.now()` inside the scoring rule and existing
  scores do not age automatically;
- structured work eligibility, sponsorship, contract models, regions,
  timezone and `project.min_total` are declared but not fully consumed;
- `ExtractionStrategy.weight` is configured but ignored;
- `SourceKind` includes kinds that the partial registry cannot execute;
- FX has two real providers and fallback policy but no provider port.

## Finding register

| ID | Priority | Finding | Primary evidence |
|---|---|---|---|
| F01 | P0 | Application and score persistence are not candidate-scoped | `schema.ts`, `repo.ts`, `contacts.ts` |
| F02 | P0 | Pursuit state/event is non-atomic and has no state machine | `repo.ts`, `repo.application.test.ts` |
| F03 | P1 | Mail suggestion acceptance can diverge from funnel state | `mail/run.ts`, `cli.ts` |
| F04 | P1 | Candidate document versioning is non-atomic/non-referential | `candidate.ts`, `schema.ts` |
| F05 | P1 | Board filters after pagination and truncates aggregates | `db/repo.ts` |
| F06 | P1 | Raw-job upsert logic is duplicated and divergent | `ingest/run.ts`, `ingest/manual.ts` |
| F07 | P1 | Scoring uses a hidden clock and freshness becomes stale | `freshness.ts`, `score.ts`, `apply.ts` |
| F08 | P1 | Structured candidate policy is not fully used by Matching | `profile/schema.ts`, `scoring/score.ts` |
| F09 | P1 | Auth app/UI leak infrastructure; session reads may write | `contexts/auth/app`, `app/login`, `app/auth.ts` |
| F10 | P1 | Declared modular migration remains partial | ADR 0007, `MIGRATION.md`, live tree |
| F11 | P1 | Architecture and data-model docs are materially stale | `architecture.md`, `data-model.md`, agent docs |
| F12 | P1 | Skills strangler keeps old and new models alive | `core/skills.ts`, `contexts/skills` |
| F13 | P2 | CLI/schema/repository centralise too many contexts | `cli.ts`, `schema.ts`, `repo.ts` |
| F14 | P2 | Queue port is coupled to concrete persistence | `scrape/queue.ts`, architecture test |
| F15 | P2 | Source kinds allow impossible runtime configurations | `sources/types.ts`, `registry.ts`, `config.ts` |
| F16 | P2 | FX provider variation is hardcoded | `core/fx.ts` |
| F17 | P2 | Compare UI builds its read model and use case | `app/compare/page.tsx`, `actions.ts` |
| F18 | P2 | i18n keys are weakly typed and domain persists prose | `i18n/index.ts`, scorer result strings |
| F19 | P3 | Report/Correspondence/Positioning remain transaction scripts | respective `src/core` modules |
| F20 | P3 | Dead exports, empty scaffolding and type escapes remain | inventory above |

## Positive findings

- Zero cycles in the internal dependency graph.
- Strict, erasable TypeScript; no decorators/enums/namespaces, no production
  `any`, and no suppression comments.
- Auth and Skills domains do not depend on network/filesystem.
- Source adapters are mostly thin and share `SourceAdapter`/HTTP boundaries.
- LLM BYOK is behind a port and the database stores environment-variable names,
  never keys.
- Ingestion never writes `application`; missing jobs are closed, never deleted.
- No LinkedIn scraping or autonomous application submission.
- The comparison screen uses `scoreOne` and `jobVocabularyComparison`, so it
  does not create a second scoring truth.
- URL verification shares a canonical probe and the outbound boundary validates
  DNS/address classes and redirect hops.
- Candidate authorisation denies by default and is session-scoped at the UI
  boundary.

## Impact assessment

### Security and privacy

The immediate route/policy defects are fixed. Full multi-owner isolation still
requires ARCH-001/002 because a guard cannot filter on a column that does not
exist. Until then the deployment model must remain one candidate owner per
database.

### Data integrity

ARCH-003/004/005 are the highest integrity work: a crash between current writes
can create a state with no matching event, an accepted suggestion with no
funnel change, or zero/multiple current CVs.

### Correctness and product decisions

ARCH-006/008/009 affect what the user sees and decides: board counts can be
wrong above 5,000 records, freshness can be stale, and declared eligibility
constraints may not change the score.

### Maintainability

ARCH-007/010/012 remove the most dangerous duplicate paths. ARCH-013 onward
should follow those corrections, not precede them with a cosmetic directory
shuffle.

### Recommended order

1. Candidate-scoped Pursuit and Matching, with safe migrations.
2. Atomic Pursuit transitions, then mail/document consistency.
3. Correct Board/scoring/policy behaviour.
4. Close Auth/Skills boundaries and rebaseline architecture docs.
5. Decompose CLI/schema/read models opportunistically.
6. Clean dead code and type escapes last.
