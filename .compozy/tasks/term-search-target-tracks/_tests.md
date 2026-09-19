# Test Specification: Saved Term Searches and Target Tracks

Canonical test contract for saved term searches, target tracks and the Jobs
screen filters. Companion to `_techspec.md`. Derived from `_user_stories.md`
(behavior) and `_techspec.md` (components).

## Strategy

- Frameworks and harnesses: Vitest (`tests/**/*.test.ts`, node environment)
  with the Docker PostgreSQL 17 global setup; integration suites call
  `useTestDb()` for a freshly migrated database. HTTP is faked only at
  `HttpPort` through `fixtureHttp`; platform fixtures under
  `tests/fixtures/term-search/` are captured from real `jho sources probe
  --term` responses. The clock is injected through `clock()`. Server Actions
  are exercised with the existing session fixtures and an `after()` spy
  (`vi.mock("next/server")`) that records callbacks instead of scheduling them.
- Execution: `rtk pnpm check` runs unit and integration suites with coverage
  (global thresholds 95/90/95/95); `rtk pnpm test:e2e` runs the isolated build
  with real authentication, where ingestion is not permitted, so E2E exercises
  the "captures off" path and seeded capture data, never live platforms.
- Conventions: file names `tests/term-kernel.test.ts`,
  `tests/target-tracks.test.ts`, `tests/track-scoring.test.ts`,
  `tests/term-capture.test.ts`, `tests/platform-quota.test.ts`,
  `tests/saved-terms.test.ts`, `tests/board-tracks-terms-pay.test.ts`,
  `tests/migration-target-tracks.test.ts`, coverage suites
  `tests/cov-<area>-<module>.test.ts`; table-driven cases with `it.each`;
  no timing assertion except IT-113.

## Coverage Matrix

| Source | Behavior | Unit | Integration | E2E |
|---|---|---|---|---|
| US-001 | Own matching profile becomes the primary track | UT-042 | IT-001, IT-018 | E2E-002 |
| US-001.EC-1 | No own profile → pending primary, no scoring, saving disabled | — | IT-001, IT-020, IT-025, IT-039, IT-080 | — |
| US-001.EC-2 | Inherited titles/compensation marked "not reviewed" | UT-042 | IT-003 | — |
| US-001.EC-3 | Migration twice → one primary | — | IT-002 | — |
| US-001.EC-4 | Admin who is also a candidate gets own primary | — | IT-001 | — |
| US-001.EC-5 | Interrupted migration → all or nothing | — | IT-005 | — |
| US-001.EC-6 | Many candidates → each only their own track | — | IT-001 | — |
| US-002 | Create accepted track, suggested then confirmed | UT-033, UT-034 | IT-006 | E2E-001, E2E-002 |
| US-002.EC-1 | Name empty / spaces / >40 → rejected | UT-027 | — | — |
| US-002.EC-2 | Duplicate name ignoring case → rejected | — | IT-007 | — |
| US-002.EC-3 | Unknown term → term keyword + generic title, thin | UT-036 | — | — |
| US-002.EC-4 | Six active tracks → refused | — | IT-008 | — |
| US-002.EC-5 | Zero titles or zero keywords → rejected | UT-021, UT-022 | — | — |
| US-002.EC-6 | Double submit → one track | — | IT-009 | — |
| US-002.EC-7 | Session expires before confirming → login, nothing saved | — | — | E2E-016 |
| US-002.EC-8 | Recruiter/unauthenticated cannot reach the form | — | IT-122 | E2E-011 |
| US-002.EC-9 | Hostile name/term shown as text | — | — | E2E-018 |
| US-002.EC-10 | Keyword weight outside scale → rejected | UT-026 | — | — |
| US-002.EC-11 | Empty skills catalog → thin suggestion | UT-035 | — | — |
| US-003 | Edit a track; only that track recalculates | UT-072, UT-073 | IT-024, IT-027 | E2E-002 |
| US-003.EC-1 | Invalid range amount or order → rejected | UT-023, UT-025 | — | — |
| US-003.EC-2 | Duplicate (currency, period) range → rejected | UT-024 | — | — |
| US-003.EC-3 | Removing last title/keyword → rejected | UT-021, UT-022 | — | — |
| US-003.EC-4 | Two tabs → later wins, earlier told stale | — | IT-010 | — |
| US-003.EC-5 | Edit during recalculation → newest edit wins | — | IT-027 | — |
| US-003.EC-6 | Edit archived track → allowed, no recalculation | — | IT-021, IT-028 | — |
| US-003.EC-7 | Reload during recalculation keeps previous fits + notice | — | IT-030 | E2E-002 |
| US-004 | Choose primary track | — | IT-011 | E2E-004 |
| US-004.EC-1 | Archived track cannot become primary | — | IT-013 | — |
| US-004.EC-2 | Concurrent promotions → one primary | — | IT-012 | — |
| US-004.EC-3 | Explicit track in URL wins over primary | — | IT-032 | E2E-003 |
| US-004.EC-4 | Foreign track in URL → own primary + notice | — | IT-019 | — |
| US-005 | Archive and restore | — | IT-015, IT-016 | E2E-005 |
| US-005.EC-1 | Archive primary → refused | — | IT-014 | — |
| US-005.EC-2 | Archive the only accepted track → allowed | — | IT-015 | — |
| US-005.EC-3 | Restore at six active → refused | — | IT-016 | — |
| US-005.EC-4 | Archive while a term runs → run finishes, no new run | — | IT-073 | — |
| US-005.EC-5 | Application on a job whose best fit was the archived track | — | IT-015 | — |
| US-005.EC-6 | Archive twice → no-op | — | IT-017 | — |
| US-006 | Evidence marker on tracks | UT-037, UT-039, UT-044 | IT-022 | E2E-002 |
| US-006.EC-1 | No evidence at all → all gaps | UT-041 | — | — |
| US-006.EC-2 | Evidence edited → markers update on next view | — | IT-022 | — |
| US-006.EC-3 | Growth-only keyword → gap | UT-038 | — | — |
| US-006.EC-4 | Inherited evidence never supports | UT-040 | — | — |
| US-007 | Save a term linked to a track; first run within 1 minute | UT-043 | IT-074, IT-083 | E2E-001 |
| US-007.EC-1 | No track → refused | — | IT-075 | — |
| US-007.EC-2 | 20 active terms → refused | — | IT-076 | — |
| US-007.EC-3 | Duplicate normalized term → refused with link | — | IT-077 | E2E-017 |
| US-007.EC-4 | Double submit → one term, one run | — | IT-078 | — |
| US-007.EC-5 | Failure mid-save → term and captures both or neither | — | IT-079 | — |
| US-007.EC-6 | Pending primary → saving disabled | — | IT-080 | — |
| US-007.EC-7 | Captures off in environment | — | IT-082 | E2E-001 |
| US-007.EC-8 | Impersonated save → no run, waiting for sweep | — | IT-081 | E2E-019 |
| US-008 | Per-platform progress | UT-047 | IT-058, IT-083, IT-099 | E2E-001 |
| US-008.EC-1 | One platform fails, others continue | UT-053 | IT-060 | — |
| US-008.EC-2 | Quota hit → waiting with next window | UT-052 | IT-059 | — |
| US-008.EC-3 | More than 100 results → 100 newest, "100 of about N" | UT-055 | IT-062 | — |
| US-008.EC-4 | Zero results → succeeded 0 | — | IT-063 | — |
| US-008.EC-5 | Restart mid-run → lease reclaim, completed kept | — | IT-064 | — |
| US-008.EC-6 | All platforms skipped | UT-047 | IT-070 | — |
| US-009 | Daily repeat | — | IT-058, IT-090, IT-097, IT-098 | — |
| US-009.EC-1 | Missed sweep → no stacking | — | IT-098 | — |
| US-009.EC-2 | 14 days of zero → label, still active | UT-048 | IT-100 | — |
| US-009.EC-3 | Manual run earlier today → daily run reuses result | — | IT-085 | — |
| US-009.EC-4 | Many terms → spread within quotas, rest wait | — | IT-055 | — |
| US-009.EC-5 | Sweep off → "daily repeat paused" | UT-049 | IT-101 | — |
| US-010 | Manual re-run with 24-hour cooldown | UT-045 | IT-084 | — |
| US-010.EC-1 | Re-run while running → ignored | — | IT-084 | — |
| US-010.EC-2 | Failed platform re-run inside cooldown | — | IT-086 | — |
| US-010.EC-3 | Double click → one run | — | IT-087 | — |
| US-010.EC-4 | Impersonated re-run → no run | — | IT-088 | — |
| US-011 | Pause, resume, move, delete | — | IT-090, IT-091, IT-093 | E2E-006 |
| US-011.EC-1 | Delete while running → run finishes, unattributed | — | IT-093 | — |
| US-011.EC-2 | Move to archived track → refused | — | IT-092 | — |
| US-011.EC-3 | Delete twice → no-op | — | IT-093 | — |
| US-011.EC-4 | Application on a job the deleted term brought | — | IT-093 | — |
| US-012 | Term validation and equivalence | UT-001, UT-002, UT-007, UT-008, UT-011 | IT-116 | E2E-017 |
| US-012.EC-1 | Length limits | UT-003, UT-004 | — | — |
| US-012.EC-2 | Invalid character named | UT-005 | — | — |
| US-012.EC-3 | Punctuation only | UT-006 | — | — |
| US-012.EC-4 | Trim before compare | UT-001 | — | — |
| US-012.EC-5 | `Tech Lead` vs `techlead` duplicate | UT-002 | IT-077 | — |
| US-013 | Coverage of reached vs non-searchable platforms | UT-056 | IT-056, IT-099 | E2E-001 |
| US-013.EC-1 | Platform disabled after save → skipped | — | IT-070 | — |
| US-013.EC-2 | Term parameter stops working → failed, admin sees | — | IT-061 | — |
| US-013.EC-3 | Unvalidated platform never queried | UT-056 | IT-072 | — |
| US-014 | System-wide quotas | UT-050, UT-052 | IT-048, IT-049, IT-050, IT-051 | — |
| US-014.EC-1 | Same-minute burst serialized | — | IT-050 | — |
| US-014.EC-2 | Window boundary during a run | UT-051 | IT-053 | — |
| US-014.EC-3 | No published limit → conservative default | — | IT-054 | — |
| US-014.EC-4 | Remotive budget shared with sync | — | IT-055 | — |
| US-015 | One call per term/platform/day shared | — | IT-056, IT-096 | — |
| US-015.EC-1 | Two candidates at once → one call | — | IT-096 | — |
| US-015.EC-2 | Reused result stated as reused | — | IT-085 | — |
| US-016 | Never hides, closes or reassigns | UT-054 | IT-067, IT-068, IT-069 | — |
| US-016.EC-1 | Closed/archived job reopens, archive cleared | — | IT-044 | — |
| US-016.EC-2 | Same posting in several countries → separate jobs | — | IT-047 | — |
| US-016.EC-3 | Term run and sync on the same job → one job | — | IT-046 | — |
| US-016.EC-4 | No description → attributed via title/company/tags only | UT-054 | IT-069 | — |
| US-017 | Captures off where ingestion is not permitted | — | IT-057, IT-082, IT-105 | E2E-001 |
| US-017.EC-1 | Ingestion permitted later → next sweep runs | — | IT-102 | — |
| US-017.EC-2 | Re-run in blocked environment → captures off | — | IT-089 | — |
| US-017.EC-3 | Every entry point refuses | — | IT-127 | — |
| US-018 | Fit per track with relevance gate | UT-071 | IT-023, IT-040 | E2E-010 |
| US-018.EC-1 | Same blocker under every track | UT-071 | — | — |
| US-018.EC-2 | Scorer version change → all tracks rescored | UT-076 | IT-026 | — |
| US-018.EC-3 | Six tracks, 10,000 jobs | — | IT-029 | — |
| US-018.EC-4 | No description → primary scored; accepted by title only | — | IT-031 | — |
| US-018.EC-5 | Keyword change adds/removes accepted rows | — | IT-024 | — |
| US-019 | Track ranges and seniority shape its fit | UT-072, UT-074 | — | — |
| US-019.EC-1 | Undisclosed pay neutral on every track | UT-075 | — | — |
| US-019.EC-2 | New track starts with primary ranges; no-range save refused | UT-028, UT-033 | — | — |
| US-020 | Track selector opens on primary; all tracks | — | IT-032, IT-033 | E2E-003 |
| US-020.EC-1 | Archived/unknown track in URL → primary + notice | — | IT-019 | E2E-015 |
| US-020.EC-2 | Single track → "all" equals primary | — | IT-041 | — |
| US-020.EC-3 | Tie in "all" → primary label, then first listed | — | IT-032 | — |
| US-020.EC-4 | 375px selector fits | — | — | E2E-013 |
| US-020.EC-5 | Foreign cluster in URL dropped with notice | — | IT-033 | — |
| US-021 | Whole-word term filter over descriptions | UT-008, UT-067 | IT-105, IT-107 | E2E-001 |
| US-021.EC-1 | `Lara`/`Laravel`, `java`/`JavaScript` do not match | UT-009 | IT-105 | — |
| US-021.EC-2 | `C#`, `Node.js` literal | UT-010 | IT-105 | — |
| US-021.EC-3 | Empty term → filter off | UT-068 | — | — |
| US-021.EC-4 | Hostile input escaped | — | IT-115 | E2E-015 |
| US-021.EC-5 | No description → title and company only | — | IT-106 | — |
| US-021.EC-6 | Zero matches → empty state with save offer | — | — | E2E-020 |
| US-022 | "Brought by my term" filter | — | IT-108 | E2E-009 |
| US-022.EC-1 | Deleted term link → unfiltered + notice | — | IT-108 | — |
| US-022.EC-2 | Term with no results → empty state with status | — | IT-109 | — |
| US-022.EC-3 | Another candidate's term → ignored + notice | — | IT-108 | — |
| US-023 | Minimum pay filter | UT-014, UT-069 | IT-110, IT-111, IT-117 | E2E-007 |
| US-023.EC-1 | Invalid amount → ignored + notice | UT-066 | — | — |
| US-023.EC-2 | Currency without rate not offered | — | IT-118 | — |
| US-023.EC-3 | Hourly pay → 2,080 hours a year | UT-015 | — | — |
| US-023.EC-4 | Lower bound only → top of range | UT-016 | — | — |
| US-023.EC-5 | Project pay with duration annualized | UT-019 | — | — |
| US-024 | Undisclosed and non-comparable stay visible | UT-017 | IT-110 | E2E-007 |
| US-024.EC-1 | All undisclosed → all listed, marked | — | IT-119 | — |
| US-024.EC-2 | Toggle on, none qualifies → empty state | — | IT-120 | — |
| US-025 | Normalized sort by pay | — | IT-112 | E2E-008 |
| US-025.EC-1 | Ties by fit then stable id | — | IT-112 | — |
| US-026 | New-job counts and markers, in-app only | UT-046 | IT-094, IT-095, IT-104, IT-114 | E2E-009 |
| US-026.EC-1 | Never visited → counts everything | — | IT-094 | — |
| US-026.EC-2 | Closed job leaves the count | — | IT-094 | — |
| US-026.EC-3 | Job from two terms → counted under each, marked once | — | IT-103 | — |
| US-026.EC-4 | Two tabs → cleared after reload | — | IT-095 | — |
| US-027 | Recruiter sees no tracks, terms or ranges | — | IT-036, IT-121, IT-122, IT-125, IT-126, IT-128 | E2E-011 |
| US-027.EC-1 | Crafted URL → denied or ignored | — | IT-122, IT-128 | E2E-011 |
| US-027.EC-2 | Recruiter Jobs screen without track UI | — | — | E2E-011 |
| US-027.EC-3 | Expired session → login | — | — | E2E-016 |
| US-028 | Admin aggregate health | — | IT-071, IT-123, IT-124, IT-131 | E2E-012 |
| US-028.EC-1 | Single candidate → still no term text | — | IT-124 | — |
| US-028.EC-2 | Impersonated session → view unavailable | — | IT-123 | E2E-012 |
| US-029 | Impersonation edits, never runs | — | IT-129, IT-130 | E2E-019 |
| US-029.EC-1 | Impersonating an admin-candidate | — | IT-129 | — |
| US-029.EC-2 | Save/re-run under impersonation | — | IT-081, IT-088 | E2E-019 |
| US-030 | Single-fit readers use the primary track | — | IT-034, IT-040 | E2E-010 |
| US-030.EC-1 | Primary changed → readers follow | — | IT-038 | — |
| US-030.EC-2 | Pending primary → readers show no fit | — | IT-039 | — |
| Term kernel (`src/core/term.ts`) | Validation, key, pattern, SQL string | UT-001–UT-012 | IT-116 | — |
| Pay normalization (`src/core/money.ts`) | Factor SQL, normalizer | UT-013–UT-019 | IT-111 | — |
| Track domain | Validate, merge, relevance, suggestion, evidence | UT-020–UT-044 | IT-006, IT-022 | — |
| Track app and scope | CRUD, primary, archive, `trackScope` | — | IT-006–IT-022 | — |
| Saved-term domain | Cooldown, new, status aggregation | UT-045–UT-049 | IT-094, IT-099 | — |
| Sourcing domain | Windows, failure classes, attribution, cap, reachability | UT-050–UT-056 | IT-048, IT-056 | — |
| Term-search adapters | Remotive, RemoteOK, Himalayas | UT-057–UT-062 | IT-058 | — |
| `sources.yaml` handle refinement | `~` prefix rejected | UT-063 | — | — |
| `readFilters` / `href` | New `/jobs` params and notices | UT-064–UT-069 | IT-110 | E2E-015 |
| Action code → dictionary mapping | Every failure code translated | UT-070 | IT-121 | — |
| Dictionary (`pt-BR.ts`, `en.ts`) and user content marking | New screens fully translated; names and terms marked | UT-070 | — | E2E-014 |
| Per-track scoring | Effective profile, gate, version | UT-071–UT-076 | IT-023–IT-031 | — |
| `job_score` readers | Track scope everywhere | — | IT-032–IT-041 | — |
| Ingestion changes | `keepExistingSource`, archive on reopen, `~terms` | — | IT-042–IT-047 | — |
| Quota ledger | Atomic reservation | UT-050–UT-052 | IT-048–IT-055 | — |
| Capture runner | Claim, reserve, search, observe, attribute | UT-053–UT-055 | IT-056–IT-073 | — |
| Migrations 0004–0006 | Expand, backfill, contract | — | IT-001–IT-005 | — |
| `createTrackAction` | Success and failures | UT-021–UT-028 | IT-006–IT-009 | E2E-002 |
| `updateTrackAction` | Success, stale, archived | — | IT-010, IT-021 | E2E-002 |
| `setPrimaryTrackAction` | Success, archived, concurrency | — | IT-011–IT-013 | E2E-004 |
| `archiveTrackAction` / `restoreTrackAction` | Success, primary, limit, repeat | — | IT-014–IT-017 | E2E-005 |
| `saveTermAction` | Success and every `SaveTermResult` code | UT-070 | IT-074–IT-083 | E2E-001, E2E-017 |
| `rerunTermAction` | Started, cooldown, running, impersonated, blocked | — | IT-084–IT-089 | — |
| `pauseTermAction` / `resumeTermAction` | Status and sweep inclusion | — | IT-090 | E2E-006 |
| `moveTermAction` | Success, archived target | — | IT-091, IT-092 | E2E-006 |
| `deleteTermAction` | Idempotent delete | — | IT-093 | E2E-006 |
| Page `/searches` | Overview, guard | — | IT-099, IT-122 | E2E-002 |
| Page `/searches/tracks/new` | Suggestion form | UT-033 | IT-122 | E2E-001 |
| Page `/searches/tracks/[id]` | Editor, foreign id 404 | — | IT-122 | E2E-002 |
| Page `/admin/captures` | Admin only, aggregate | — | IT-123, IT-124 | E2E-012 |
| Page `/jobs` (new params) | Filters, notices | UT-064–UT-068 | IT-105–IT-120 | E2E-003, E2E-007, E2E-015 |
| Page `/jobs/[id]` | Per-track fits, on demand | — | IT-040 | E2E-010 |
| CLI `jho terms run` | Aggregates, guard exit | — | IT-098, IT-131 | — |
| CLI `jho terms status`, `jho tracks list` | Output | — | IT-132 | — |
| CLI `jho sources probe --term` | No write, guarded | — | IT-133 | — |
| Sweep step in `varredura.yml` | Runs `jho terms run` after `jobs sync` | — | IT-098 (command contract) | — (workflow file reviewed; no runner in tests) |

## Unit Tests

### Term kernel (TechSpec: Core Interfaces — term kernel)

- **UT-001** (happy): `validateTerm("  Laravel ")` — returns `{ ok: true, value: { term: "Laravel", key: "laravel" } }`.
- **UT-002** (happy): `termKey` — `termKey("Tech Lead")`, `termKey("tech-lead")` and `termKey("Techlead")` all return `"techlead"`.
- **UT-003** (boundary): `validateTerm` — `""` and `"a"` return `term_too_short`; `"go"` returns ok.
- **UT-004** (boundary): `validateTerm` — a 60-character term returns ok; a 61-character term returns `term_too_long`.
- **UT-005** (error): `validateTerm("php<script>")` — returns `{ ok: false, code: "term_invalid_char", char: "<" }`.
- **UT-006** (error): `validateTerm("++")` — returns `term_no_alnum`.
- **UT-007** (happy): `validateTerm` — `"C++"`, `"C#"`, `".NET"`, `"Node.js"`, `"CI/CD"` and `"Programação"` return ok.
- **UT-008** (happy): `matchesTerm("techlead", text)` — true for `"Senior Tech Lead (Remote)"`, `"tech-lead"` and `"TechLead"`.
- **UT-009** (boundary): `matchesTerm` — `("Lara", "Laravel developer")` and `("java", "JavaScript engineer")` return false.
- **UT-010** (happy): `matchesTerm` — `("C#", "Senior C# developer")`, `("Node.js", "node.js backend")` and `("node", "Node.js developer")` return true; `("C#", "C developer")` returns false.
- **UT-011** (happy): `matchesTerm("Technical Lead", "Tech Lead wanted")` — returns false (no synonym expansion).
- **UT-012** (happy): `termRegexSql` — `"C++"` returns exactly `(^|[^a-z0-9+#])c\+\+([^a-z0-9+#]|$)` (no separator next to a non-alphanumeric), and `"Go"` returns exactly `(^|[^a-z0-9+#])g[ -]?o([^a-z0-9+#]|$)`.

### Pay normalization (TechSpec: ADR-013, Data Models)

- **UT-013** (happy): `annualFactorSql()` — the `CASE` maps `hour` → 2080, `day` → 260, `week` → 52, `month` → 12, `year` → 1 and any other value (including `project`) → NULL.
- **UT-014** (happy): `normalizePayTop` — `{ compMin: 100000, compMax: 120000, currency: "USD", period: "year" }` to USD per month returns `10000`.
- **UT-015** (boundary): `normalizePayTop` — `{ compMax: 50, currency: "USD", period: "hour" }` to USD per month returns `8666.67` (2 decimals).
- **UT-016** (happy): `normalizePayTop` — `{ compMin: 7000, compMax: null, currency: "USD", period: "month" }` returns `7000`.
- **UT-017** (error): `normalizePayTop` — currency `"ARS"` absent from the FX table returns `{ kind: "not_comparable" }`; period `project` without duration returns `not_comparable`; `compMin` and `compMax` null or 0 return `{ kind: "undisclosed" }`.
- **UT-018** (happy): `normalizePayTop` — 50,000 BRL per month with FX base USD and `BRL = 5.0` to USD per month returns `10000`.
- **UT-019** (happy): `money.annualize` — 30,000 USD per `project` with `durationMonths: 6` returns 60,000 per year, which normalizes to 5,000 per month.

### Track domain (TechSpec: Core Interfaces — track model)

- **UT-020** (happy): `effectiveProfile(person, target)` — result's `targets`, `keywords`, `seniority.min_years_expected`, `seniority.reject_below_years`, `compensation.ranges` and `reference_currency` come from `target`; `constraints`, `blockers`, `compensation.project`, `compensation.benefits`, `seniority.years_experience` and `evidence` come from `person`; `ProfileSchema.parse` succeeds.
- **UT-021** (error): `validateTrackTarget` — `targets.clusters` with no title returns `track_titles_required`.
- **UT-022** (error): `validateTrackTarget` — empty `critical`, `strong` and `stack` returns `track_keywords_required`.
- **UT-023** (error): `validateTrackTarget` — a range with `floor: 9000, target: 8000` returns `range_invalid`.
- **UT-024** (error): `validateTrackTarget` — two ranges `USD/month` return `range_duplicate`.
- **UT-025** (boundary): `validateTrackTarget` — `ideal: 10000000` is valid; `ideal: 10000001` and `floor: 0` return `range_invalid`.
- **UT-026** (error): `validateTrackTarget` — positive weight `11` or `0`, and negative weight `-11`, return `keyword_weight_invalid`; weights `10` and `-3` are valid.
- **UT-027** (error): `validateTrackName` — `""`, `"   "` and a 41-character name return `track_name_invalid`; a 40-character name is valid.
- **UT-028** (error): `validateTrackTarget` — `ranges: []` returns `range_required`; a range in a currency without a stored rate returns `range_currency_unknown`.
- **UT-029** (happy): `isRelevant(phpTarget, { title: "Senior Laravel Developer", description: "" })` — returns true.
- **UT-030** (happy): `isRelevant(phpTarget, { title: "Backend Engineer", description: "We use PHP 8 and MySQL" })` — returns true.
- **UT-031** (boundary): `isRelevant(phpTarget, { title: "Engineer", description: "Backend services" })` for a job whose company is "Laravel Partners" — returns false (company is not considered).
- **UT-032** (boundary): `isRelevant` — a job matching only a negative keyword (`wordpress`) returns false.
- **UT-033** (happy): `suggestTrack({ term: "Laravel", catalog, evidence, primary })` with the catalog skill `laravel` — returns titles `["Laravel Developer", "Senior Laravel Developer", "Laravel Engineer", "Backend Engineer (Laravel)"]`, keyword `laravel` in `critical` with weight 10, `thin: false`, and `compensation` and `seniority` deep-equal to `primary`'s.
- **UT-034** (idempotency): `suggestTrack` — two calls with the same input return deep-equal results.
- **UT-035** (boundary): `suggestTrack` with `catalog: []` and term `"Elixir"` — returns keyword `elixir` weight 10, title `"Elixir Developer"`, `thin: true`.
- **UT-036** (boundary): `suggestTrack` with a non-empty catalog lacking the term `"Zig"` — returns keyword `zig`, title `"Zig Developer"`, `thin: true`.
- **UT-037** (happy): `evidenceSupport` — keyword `laravel` with own evidence line "MPC — … on Laravel 12 + Jetstream" returns `supported: ["laravel"]`; keyword `vue` returns `gaps: ["vue"]`.
- **UT-038** (happy): `evidenceSupport` — keyword present only in `growth` returns it in `gaps`.
- **UT-039** (happy): `evidenceSupport` — keyword matching a `candidate_skill` with status `confirmed` returns it in `supported`.
- **UT-040** (error): `evidenceSupport` — evidence flagged `inherited: true` does not support any keyword.
- **UT-041** (boundary): `evidenceSupport` — empty evidence and no confirmed skills return every keyword in `gaps` without error.
- **UT-042** (happy): `inheritedFields(candidateProfile, defaultProfile, { isOwner: false })` — returns `["targets", "compensation"]` when both are deep-equal to the default; `{ isOwner: true }` returns `[]`.
- **UT-043** (happy): `preselectTrack("Laravel", tracks)` — returns the track whose keywords contain `laravel`; returns null when none does.
- **UT-044** (happy): `scoreJob` — two effective profiles that differ only in `evidence` return identical `ScoreResult` for the same job.

### Saved-term domain (TechSpec: Core Interfaces — saved terms)

- **UT-045** (boundary): `cooldownState(lastRunRequestedAt, now)` — 23h59m after the anchor returns `{ allowed: false, availableAt: anchor + 24h }`; exactly 24h returns `{ allowed: true }`; null anchor returns allowed.
- **UT-046** (happy): `isNew(firstSeenAt, lastVisitAt)` — `lastVisitAt` null returns true; `firstSeenAt` after it returns true; equal or earlier returns false.
- **UT-047** (happy): `termStatus(platformStates)` — `[succeeded, failed]` → `partial`; any `queued`/`running` → `running`; all `succeeded` → `succeeded`; all `skipped:ingestion_blocked` → `captures_off`; all `skipped:platform_disabled` → `no_platform`; `[succeeded, waiting_quota]` → `waiting_quota`.
- **UT-048** (boundary): `zeroStreak(captures)` — 14 consecutive daily `succeeded` captures with `fetched = 0` return `no_results_14d`; 13 return null.
- **UT-049** (boundary): `dailyRepeatPaused(lastSweepCaptureAt, now)` — null or 36h + 1s ago returns true; 35h59m ago returns false.

### Sourcing domain (TechSpec: Core Interfaces — sourcing ports; ADR-010)

- **UT-050** (happy): `windowStarts(new Date("2026-09-18T14:03:27Z"))` — returns `{ day: "2026-09-18", minute: "2026-09-18T14:03" }`.
- **UT-051** (boundary): `windowStarts` — `23:59:59.999Z` on 2026-09-18 returns day `2026-09-18`; `00:00:00.000Z` on 2026-09-19 returns day `2026-09-19`.
- **UT-052** (happy): `nextWindowAt("day", "2026-09-18")` — returns `2026-09-19T00:00:00.000Z`; `nextWindowAt("minute", "2026-09-18T14:03")` returns `2026-09-18T14:04:00.000Z`.
- **UT-053** (happy): `classifyCaptureFailure` — `HttpError(429)` → `{ status: "waiting_quota", exhaustDay: true }`; `HttpError(503)` → `failed/http_error/retryable`; `HttpError(404)` and `HttpError(410)` → `failed/endpoint_gone/not retryable`; `TypeError("fetch failed")` → `failed/network/retryable`; `SyntaxError` → `failed/parse/retryable`.
- **UT-054** (happy): `isAttributable("laravel", raw)` — raw with title "Backend Engineer", no description and `tags: ["laravel", "php"]` returns true; the same raw with `tags: ["php"]` returns false.
- **UT-055** (happy): `capNewest(raws, 100)` — 130 raws return the 100 with the latest `postedAt`, undated last, and `totalHint: 130`.
- **UT-056** (happy): `reachablePlatforms(adapters, config)` — returns only kinds whose adapter has `termSearch.validatedOn !== null` and whose config entry is enabled; an adapter with `validatedOn: null` is excluded.

### Term-search adapters (TechSpec: Integration Points)

- **UT-057** (happy): Remotive `termSearch.search("Laravel", { limit: 100, reserve })` — performs one request to `https://remotive.com/api/remote-jobs?search=Laravel&limit=100`, calls `reserve` once before it, and maps fixture `tags` to `RawJob.tags`.
- **UT-058** (error): Remotive `search` with `reserve` returning false — performs no HTTP call and returns `stoppedByQuota: true`, `jobs: []`.
- **UT-059** (happy): RemoteOK `search("Tech Lead")` — requests `https://remoteok.com/api?tag=tech-lead` and drops the leading legal-notice item.
- **UT-060** (happy): Himalayas `search("laravel")` — requests the search endpoint up to 5 pages of 20 following the fixture cursor, calls `reserve` before each request, and stops when the cursor ends.
- **UT-061** (boundary): Himalayas `search` with `reserve` returning false on the third call — returns 40 jobs and `stoppedByQuota: true`.
- **UT-062** (error): any adapter `search` receiving HTTP 429 — rethrows `HttpError` with status 429 and `fixtureHttp.calls` has exactly one entry (`retries: 0`).

### Source configuration (TechSpec: ADR-011)

- **UT-063** (error): `loadSources` with an entry `{ kind: remotive, handle: "~terms" }` — throws a Zod error whose path is `handle`.

### Jobs screen filters (TechSpec: API Endpoints — `/jobs` parameters)

- **UT-064** (happy): `readFilters({ track: "12", q: "laravel", by: "5", pay: "6000", cur: "USD", per: "month", disclosed: "1", sort: "comp" })` — returns the matching state with `pay.min = 6000` and `disclosedOnly = true`.
- **UT-065** (error): `readFilters({ q: "<b>" })` — returns no term and notice `term_invalid_char`.
- **UT-066** (error): `readFilters` — `pay` of `"0"`, `"abc"` and `"10000001"` returns no pay filter and notice `pay_invalid`.
- **UT-067** (happy): `href(base, state)` — round-trips `track`, `q`, `by`, `pay`, `cur`, `per`, `disclosed`, `sort` so `readFilters(parse(href(...)))` equals the input state.
- **UT-068** (boundary): `readFilters({ q: "" })` and `{ q: "   " }` — return no term filter and no notice.
- **UT-069** (happy): `defaultPay(primaryTarget)` — primary ranges `[BRL/month, USD/year]` return `{ currency: "BRL", period: "month" }`; a null target returns `{ currency: "USD", period: "month" }`.
- **UT-070** (happy): action feedback mapping — every code in `SaveTermResult`, `TrackError`, the re-run result and the filter notices maps to a key present in both `pt-BR.ts` and `en.ts`.

### Per-track scoring (TechSpec: ADR-009)

- **UT-071** (happy): `scoreJob` for "Senior Laravel Developer", remote LATAM, description citing PHP and Laravel — the PHP track's effective profile yields a higher `fit` than the AI primary's, and both results have the same `blockers` array.
- **UT-072** (happy): `scoreJob` — two effective profiles differing only in `compensation.ranges` (floor 7,500 vs 4,000 USD/month) for a job paying 5,000 USD/month give different `comp` scores and equal other components.
- **UT-073** (happy): `scoreJob` — `wordpress` as a negative keyword only in the primary target penalizes only the primary effective profile's `keyword` score and `penalty`.
- **UT-074** (happy): `scoreJob` — targets differing only in `min_years_expected` (7 vs 3) for a job asking "5+ years" differ only in the `seniority` component.
- **UT-075** (happy): `scoreJob` — a job without pay returns `comp = 4` under every track's effective profile.
- **UT-076** (happy): `score.ts` — `SCORER_VERSION` equals `"1.4.0"`, and `containsTerm` built on `TERM_BOUNDARY` matches `"c#"` in `"C# developer"` and not `"c"` in `"C# developer"`.

## Integration Tests

### Migrations 0004–0006 (TechSpec: Data Models — migrations)

- **IT-001**: migrations on a database seeded at 0003 with the owner (admin + candidate) and a second candidate with profiles, a third candidate without a profile, and `job_score` rows for all three — after migrating, each profiled candidate has exactly one `target_track` with `is_primary = true` whose `target_json` equals its profile's target keys, every remaining `job_score` row carries that track id, the third candidate's rows are gone, and the primary key is `(candidate_id, track_id, job_id)`.
- **IT-002**: running the 0005 backfill statement a second time — leaves exactly one primary track per candidate and the same row counts.
- **IT-003**: backfill for a non-owner candidate whose `targets` and `compensation` equal the default profile's — `unreviewed_json` is `["targets","compensation"]`; for the owner it is `[]`.
- **IT-004**: `tests/cov-db-schema.test.ts` against the migrated database — the declared and applied `ON DELETE` actions match for `target_track`, `saved_term`, `term_attribution` and `job_score.track_id`.
- **IT-005**: backfill with an injected failure after the first track insert — the transaction rolls back and no `target_track` row exists.

### Tracks (TechSpec: Components — Tracks, Track scope)

- **IT-006**: `createTrack` with a valid PHP target for a candidate with one primary — creates an accepted track with `position = 2` and enqueues one `score_task` for the candidate.
- **IT-007**: `createTrack` named `"dev php"` when `"Dev PHP"` exists — returns `track_name_duplicate`.
- **IT-008**: `createTrack` when six tracks are active — returns `track_limit`.
- **IT-009**: two concurrent `createTrack` calls with the same name — exactly one row exists; the other call returns `track_name_duplicate`.
- **IT-010**: `updateTrack` with an `updatedAt` older than the stored value — returns `stale` with the current values and leaves the row unchanged.
- **IT-011**: `setPrimaryTrack(accepted)` — the accepted track becomes primary, the former primary becomes accepted, and `count(*) WHERE is_primary` is 1.
- **IT-012**: two concurrent `setPrimaryTrack` calls for tracks A and B — exactly one primary exists afterwards.
- **IT-013**: `setPrimaryTrack(archived)` — returns `track_archived`.
- **IT-014**: `archiveTrack(primary)` — returns `primary_cannot_archive`.
- **IT-015**: `archiveTrack` on the only accepted track with an active term and an application on a job it scored — track status `archived`, the term `paused` with `paused_reason = "track_archived"`, jobs and the application unchanged, and `trackScope({ kind: "all" })` no longer includes the track.
- **IT-016**: `restoreTrack` when six tracks are active — returns `track_limit`; otherwise it restores, resumes only terms with `paused_reason = "track_archived"`, keeps manually paused terms paused, and enqueues scoring.
- **IT-017**: `archiveTrack` twice — the second call succeeds without changes.
- **IT-018**: `ensureMatchingProfile` for a new candidate with a current CV — writes the person profile and a primary track derived from the CV with `unreviewed_json = ["targets","compensation"]`.
- **IT-019**: `trackScope(candidateA, { kind: "track", trackId: trackOfCandidateB })` and an archived own track — both return the primary scope with `notice: "track_unknown"`.
- **IT-020**: `trackScope` for a candidate whose primary track has `target_json = null` — returns null.
- **IT-021**: `updateTrack` on an archived track — succeeds and enqueues no `score_task`.
- **IT-022**: `trackOverview` after the candidate's evidence gains "Vue 3" — the next call lists `vue` as supported.

### Per-track scoring (TechSpec: Components — Per-track scoring)

- **IT-023**: `scoreAll(candidate)` over 20 open jobs (6 mention PHP or Laravel) with primary and PHP tracks — 20 primary rows and exactly 6 PHP rows.
- **IT-024**: after removing `laravel` from the PHP track and adding `symfony` — the next `scoreAll` deletes the rows of jobs that no longer match, adds rows for newly matching jobs, and leaves primary rows with the same `profile_hash`.
- **IT-025**: `scoreAll`, `scoreOne` and `runScoreQueue` for a candidate with a pending primary — write no `job_score` row.
- **IT-026**: rows written with `scorer_version = "1.3.0"` — `scoreAll` rescores every track's rows to `1.4.0`.
- **IT-027**: `updateTrack` while a `score_task` for the candidate is `scoring` — after the queue finishes and re-runs, every row of that track has the latest target's `profile_hash`.
- **IT-028**: `scoreAll` with an archived accepted track — writes no row for it.
- **IT-029**: 10,000 open jobs with primary and five accepted tracks — every open job has a primary row and each accepted track has rows only for its relevant jobs (counts checked against `isRelevant`).
- **IT-030**: during a recalculation of the PHP track (rows present from the previous hash) — `listBoard` with that track still returns the previous rows.
- **IT-031**: a job with title "Laravel Developer" and no description, and a job with title "Backend Engineer" and no description — both get primary rows; only the first gets a PHP row.

### `job_score` readers (TechSpec: ADR-008)

- **IT-032**: `listBoard` for a candidate with primary (fit 50) and PHP (fit 90) rows on the same job — default returns fit 50; `track = PHP` returns 90; `all` returns 90 labeled PHP; with equal fits `all` returns the primary label; `minFit = 60` excludes the job by default and keeps it for PHP and `all`.
- **IT-033**: `boardFacets` with `track = PHP` — lists only the PHP track's clusters; a `cluster` parameter from the primary track is dropped with notice `cluster_unknown`.
- **IT-034**: dossier (`buildDossier`), CSV export, markdown report, `scorerDiagnostics`, `funnelAnalysis`, `analyseGap`, `referralOpportunities`, `drizzleTargetCorpus.targetTexts`, `corpusStats` and `clusterBreakdown` for the candidate above — all report fit 50 and the primary cluster.
- **IT-035**: `enqueueStale`, `verifyJobs` ordering and `enqueueEligible` with a PHP row of fit 95 and a primary row of fit 30 — use 30.
- **IT-036**: `pipelineRows` read for a recruiter linked to the candidate — returns the primary fit and no track id, name or per-track fit.
- **IT-037**: `tests/architecture.test.ts` — every source file under `src/` and `app/` that references `jobScore` (except `schema.ts`, `scoring/apply.ts` and the migration) also references `scoreTrackFilter` or `primaryScoreFilter`.
- **IT-038**: after `setPrimaryTrack(PHP)` — `buildDossier` and the markdown report use the PHP fit.
- **IT-039**: candidate with a pending primary — dossier, export and report show no fit, as for a candidate without a profile today.
- **IT-040**: job detail data for a job without a PHP row — returns the PHP fit computed on demand with its breakdown, and the `job_score` row count is unchanged afterwards.
- **IT-041**: candidate with only a primary track — `listBoard` with `all` returns the same rows and fits as the default.

### Ingestion changes (TechSpec: ADR-011)

- **IT-042**: `observeRawJob(raw, "remotive:~terms", { keepExistingSource: true })` for a job first seen via `greenhouse:stackblitz` — `sourceId`, `externalId`, `url` and `applyUrl` stay unchanged; `lastSeenAt` is updated.
- **IT-043**: first term capture on Remotive for an unseen job — the job's `sourceId` is `remotive:~terms` and the `source` row exists with `enabled = false`.
- **IT-044**: a job with `closedAt` and `archivedAt` set, observed again by a term capture and, separately, by `syncOne` — both paths clear `closedAt` and `archivedAt`.
- **IT-045**: `syncAll` with `remotive:architect` returning jobs that exclude a `remotive:~terms` job — the `~terms` job stays open.
- **IT-046**: a term capture and `syncOne` observing the same fingerprint concurrently — one `job` row exists.
- **IT-047**: a term capture returning the same posting for "Brazil" and "Mexico" — two jobs exist, both attributed to the term.

### Quota ledger (TechSpec: ADR-010)

- **IT-048**: `reserve("remotive", { perDay: 4, perMinute: 2 })` five times across three minutes of one UTC day — the first four succeed; the fifth returns `retryAt = next UTC midnight`.
- **IT-049**: three reservations for Remotive in the same minute — the third returns `retryAt = next minute`, and the day window's `used` stays at 2.
- **IT-050**: ten concurrent `reserve` calls on two database connections with `perDay: 4` — exactly four succeed.
- **IT-051**: `syncOne` for `remotive:architect` with the day window full — makes no HTTP call and records `source.lastError = "quota"`.
- **IT-052**: `exhaustDay("remotive")` after a 429 — further reservations that UTC day fail.
- **IT-053**: a reservation at `23:59:59Z` and one at `00:00:00Z` — increment different day rows.
- **IT-054**: RemoteOK (no published limit) — the second reservation within one minute fails with `retryAt = next minute`.
- **IT-055**: Remotive with 2 day units used by sync and 5 distinct term keys queued — 2 captures succeed, 3 become `waiting_quota` with `run_after = next UTC midnight`.

### Capture runner (TechSpec: Components — Sourcing context)

- **IT-056**: `requestTermCaptures({ termKey: "laravel" })` twice on the same day with Remotive and RemoteOK reachable — creates two rows on the first call and returns `{ created: 0, existing: 2 }` on the second.
- **IT-057**: `requestTermCaptures` with `JHO_ENV=preview` — creates no row and returns `skipped: "ingestion_blocked"`.
- **IT-058**: `runTermCaptures` with a Remotive fixture of 3 jobs (2 mention Laravel) — the row ends `succeeded` with `fetched 3, created 3, attributed 2`, and `term_attribution` has 2 rows.
- **IT-059**: Remotive answering 429 while RemoteOK answers 200 — Remotive row `waiting_quota`, its day window exhausted; RemoteOK row `succeeded`.
- **IT-060**: RemoteOK answering 503 — row `failed` with `http_error`; the next day's `jho terms run` creates a new row for the new day and runs it.
- **IT-061**: Himalayas answering 404 on the search endpoint — row `failed` with `endpoint_gone`; `captureHealth` marks Himalayas red.
- **IT-062**: a fixture of 130 jobs — 100 observed, newest first, `total_hint = 130`.
- **IT-063**: a fixture of 0 jobs — row `succeeded` with all counts 0.
- **IT-064**: a row `running` with `claimed_at` 6 minutes ago and a row `succeeded` — the next drain reclaims the first and never re-runs the second.
- **IT-065**: two concurrent `runTermCaptures` over 6 queued rows — each row is processed exactly once (fixture call count 6).
- **IT-066**: `runTermCaptures({ budgetMs: 25_000 })` with a fake clock advancing 21 seconds per capture — stops after one capture, leaving the others `queued`.
- **IT-067**: open jobs of `remotive:architect` absent from a term capture result — remain open and unarchived.
- **IT-068**: an existing job returned by a capture — keeps its source and gets a `term_attribution` row.
- **IT-069**: a raw job without description whose title misses and whose tags hit — attributed; with tags missing too — ingested and unattributed.
- **IT-070**: Remotive disabled in the sources configuration after a term was saved — the next request skips it with `platform_disabled`.
- **IT-071**: logs and stdout captured during IT-058 and the `jho terms run` run — contain no occurrence of the term or its key.
- **IT-072**: Himalayas adapter with `validatedOn: null` — `requestTermCaptures` creates no Himalayas row.
- **IT-073**: archiving a track while its term's capture is `running` — the capture finishes `succeeded`; the next `jho terms run` enqueues nothing for that term.

### Saved terms (TechSpec: Components — Saved terms; API Endpoints — actions)

- **IT-074**: `saveTerm(scope, { term: "Laravel", trackId: php })` with ingestion permitted — stores the term, enqueues captures and returns `run: "started"`.
- **IT-075**: `saveTerm` without `trackId` — returns `track_required`; with an archived track — returns `track_archived`.
- **IT-076**: `saveTerm` when 20 active terms exist — returns `term_limit`.
- **IT-077**: `saveTerm("Tech Lead")` when `"techlead"` exists — returns `term_duplicate` with the existing term id.
- **IT-078**: two concurrent `saveTermAction` submissions of `"java"` — one `saved_term` row and one capture row per platform.
- **IT-079**: `saveTerm` with the capture enqueue forced to fail — neither the term nor any capture row exists.
- **IT-080**: `saveTerm` for a candidate with a pending primary — returns `primary_pending`.
- **IT-081**: `saveTermAction` in an impersonated session — stores the term, returns `waiting_sweep`, schedules no `after()` callback and enqueues nothing.
- **IT-082**: `saveTerm` with ingestion not permitted — stores the term and returns `captures_off`.
- **IT-083**: `saveTermAction` with ingestion permitted — returns before any capture runs and registers one `after()` callback that calls `runTermCaptures({ budgetMs: 25000, worker: "web" })`.
- **IT-084**: `rerunTerm` 2 hours after the first run — returns `cooldown` with `availableAt` 22 hours later; 25 hours after — returns `started`; while a capture row is `running` — returns `running`.
- **IT-085**: a daily `jho terms run` on the same UTC day as a manual run — makes no platform call and the term shows `succeeded` with `reused: true`.
- **IT-086**: `rerunTerm` inside the cooldown when only RemoteOK's row is `failed` — re-queues only that row.
- **IT-087**: two concurrent `rerunTermAction` calls 25 hours after the last run — one enqueue.
- **IT-088**: `rerunTermAction` in an impersonated session — returns `waiting_sweep` and schedules nothing.
- **IT-089**: `rerunTerm` with ingestion not permitted — returns `captures_off`.
- **IT-090**: pausing the only saver's term — `jho terms run` enqueues nothing for its key; after resume it enqueues it.
- **IT-091**: `moveTerm` to the Java track — the term's `track_id` changes and `listBoard({ broughtBy })` under the Java track returns its jobs.
- **IT-092**: `moveTerm` to an archived track — returns `track_archived`.
- **IT-093**: `deleteTerm` while its capture is `running`, where one attributed job has an application — the capture completes, `term_attribution` rows remain, the term is gone, the application is unchanged, and a second `deleteTerm` returns ok.
- **IT-094**: `newCount` for a term with 3 attributed jobs first seen after `last_visit_at`, 1 before, and 1 after but closed — returns 2; with `last_visit_at = null` — returns 4 (open jobs only).
- **IT-095**: rendering `/jobs?by=<termId>` — flags jobs new against the previous `last_visit_at` and sets `last_visit_at` after the render; a request with header `next-router-prefetch: 1` does not change it.
- **IT-096**: candidates A and B saving `"laravel"` at the same moment — one capture row per platform per day; `saved_term` queries in A's scope never return B's row.
- **IT-097**: `activeTermKeys()` with duplicated keys across candidates, a paused term and a term on an archived track — returns each active key once and excludes the other two.
- **IT-098**: `jho terms run` after three days without runs — enqueues exactly one row per (platform, active key) for today only.
- **IT-099**: `termOverview(scope)` with seeded captures in each state — returns per-platform states and counts identical across two consecutive calls.
- **IT-100**: 14 daily `succeeded` captures with 0 results — `termOverview` shows `no_results_14d` and the term stays `active`.
- **IT-101**: no capture with `origin = "sweep"` in 36 hours — `termOverview` shows `daily_repeat_paused`.
- **IT-102**: terms saved while ingestion was blocked, then ingestion permitted — the next `jho terms run` enqueues and runs them.
- **IT-103**: a job attributed to `laravel` and `php`, both saved by the candidate — counted in both terms' `newCount` and flagged new once in `listBoard`.
- **IT-104**: `saveTerm`, `rerunTerm` and `runTermCaptures` with the mail port spied — no mail is sent.

### Jobs screen query (TechSpec: Components — Board; ADR-012, ADR-013)

- **IT-105**: `listBoard({ term })` over seeded jobs — `laravel` matches a job with "Laravel" only in `job_page.text`; `Lara` does not match it; `java` matches "Java Engineer" and not "JavaScript Engineer"; `C#` matches "C# Developer"; `node.js` matches "Node.js Backend".
- **IT-106**: a job without `job_page` and without description, titled "PHP Developer" — matches `php`; a job whose only "php" occurrence is in a missing description does not.
- **IT-107**: `term` combined with `workMode = remote`, `minFit = 45` and `sort = recent` — returns only rows satisfying all.
- **IT-108**: `broughtBy` with the viewer's term — returns only attributed jobs; another candidate's term id or a deleted term id — returns unfiltered rows and notice `term_unknown`.
- **IT-109**: `broughtBy` with a term that has no attribution yet — returns 0 rows and the term's status for the empty state.
- **IT-110**: `pay = { min: 6000, currency: "USD", period: "month" }` over jobs at 9,500 USD/month, 38,000 BRL/month (BRL = 5.0), 4,000 USD/month, undisclosed, and ARS — returns 9,500 and 7,600 first, then the undisclosed and ARS jobs marked, with `hiddenBelowMinimum = 1`; with `disclosedOnly` — only the first two.
- **IT-111**: normalized amounts from the SQL path — equal `normalizePayTop` for the same jobs (table-driven over hour, day, week, month, year).
- **IT-112**: `sort = comp` with two jobs normalizing to the same amount and different fits — higher fit first; with equal fits — lower `job.id` first; paging with `limit 1` returns disjoint pages.
- **IT-113**: 10,000 open jobs with 2 KB descriptions — `listBoard` with `term`, `pay`, `track` and `sort = comp` completes in under 2,000 ms.
- **IT-114**: `listBoard({ broughtBy, newSince })` — flags `isNew` on jobs whose `first_seen_at` is after `newSince`.
- **IT-115**: `term` `O'Reilly%_` — bound as a parameter, returns without error and matches the literal text only.
- **IT-116**: parity table — for 30 (term, text) pairs, `matchesTerm` and PostgreSQL `text ~* termRegexSql(term)` return the same boolean.
- **IT-117**: running `listBoard` with a pay filter — leaves `job_score` and `saved_term` unchanged.
- **IT-118**: currency options for the pay control — equal the currencies of the latest stored FX date.
- **IT-119**: all matching jobs undisclosed with a minimum set — returns all, each marked `undisclosed`.
- **IT-120**: `disclosedOnly` with no qualifying job — returns 0 rows and the minimum for the empty state.

### Authorization and visibility (TechSpec: API Endpoints; ADR-006)

- **IT-121**: `tests/architecture.test.ts` — every exported function in `app/searches/**/actions.ts` awaits `guardOwnCandidate`; `saveTermAction` called with a recruiter session throws the forbidden error.
- **IT-122**: `/searches`, `/searches/tracks/new` and `/searches/tracks/[id]` are listed in `privatePages` and call `requireOwnCandidatePage`; a recruiter request returns 403; a candidate requesting another candidate's track id gets `notFound()`.
- **IT-123**: `/admin/captures` — allowed for an admin session, denied for a candidate and for an admin in an impersonated session.
- **IT-124**: `captureHealth()` on a single-candidate database — the returned object contains no field holding a term, query, `term_key` or candidate id (key and value scan).
- **IT-125**: CSV export for a recruiter and for a session without candidate scope — has no track column and no per-track fit.
- **IT-126**: `publicProfile()` — its enumerated fields are unchanged and include no track, term or range.
- **IT-127**: `tests/ingestion-guard-entrypoints.test.ts` extended — `requestTermCaptures`, `runTermCaptures`, `jho terms run` and `jho sources probe --term` throw `ingestion_blocked` with `JHO_ENV=preview`.
- **IT-128**: a recruiter linked to the candidate with `candidate:read` on that candidate's resource — cannot load `/searches` data nor call any track or term action.
- **IT-129**: an admin impersonating a candidate (also an admin) — edits a track successfully, the impersonation event exists, and `saveTermAction` returns `waiting_sweep`.
- **IT-130**: an admin session without impersonation — has no route or action that reads another candidate's tracks or terms (route list scan + direct action call returns forbidden).

### CLI (TechSpec: API Endpoints — CLI)

- **IT-131**: `jho terms run` via `tests/cov-cli-harness.ts` — prints one JSON line per platform with `platform, claimed, succeeded, waiting, failed, created, known` and exits 0; with the ingestion guard blocking — exits 1 with the guard's message.
- **IT-132**: `jho terms status` — prints the same aggregates as `captureHealth`; `jho tracks list --candidate <id>` — prints each track's name, status and scored-job count.
- **IT-133**: `jho sources probe remotive --term laravel` with fixture HTTP — prints up to 5 titles and writes no row to `job`, `term_capture` or `platform_quota`.

## End-to-End Tests

### From a failed search to a saved term (US-002, US-007, US-013, US-017, US-021)

- **E2E-001**: `/jobs` → type `Laravel` in the search field → a seeded job whose only "Laravel" is in its description appears; the field hint names title, company and description; "Search the platforms for 'Laravel'" is offered → choose it → `/searches/tracks/new?term=Laravel` shows suggested titles and supporting evidence → confirm → `/searches` lists the term under the new track with every platform "captures off in this environment" and the coverage note.
- **E2E-020**: `/jobs?q=zzqxunmatched` → empty state names the term and offers to search the platforms.

### Tracks (US-001, US-003, US-004, US-005, US-006)

- **E2E-002**: `/searches` → the primary track is first and labeled primary → open a seeded accepted track → change a keyword and save → `/jobs?track=<id>` shows the "recalculating" notice with previous fits; the evidence marker lists supported and gap keywords.
- **E2E-004**: `/searches` → promote the accepted track → `/jobs` without `track` opens on it.
- **E2E-005**: archive the accepted track → it disappears from the `/jobs` selector → restore → it returns.

### Jobs screen (US-020, US-023, US-024, US-025)

- **E2E-003**: `/jobs` → default fits are the primary track's → select the PHP track → URL has `track=` → select "all tracks" → each job shows one track label → reload keeps the selection.
- **E2E-007**: set minimum 6,000 USD per month → qualifying jobs first with converted amounts beside originals, then "not disclosed" and "not comparable" rows, and the "hidden below minimum" line → toggle "only with disclosed pay" → marked rows disappear → reload keeps both.
- **E2E-008**: sort by pay over seeded USD/year, BRL/month and USD/hour jobs → order follows normalized amounts.

### Terms (US-011, US-022, US-026)

- **E2E-006**: `/searches` → pause a term → it shows "paused" → resume → move it to another track → delete it → deleting again from a stale page shows no error.
- **E2E-009**: `/searches` shows "2 new" on a seeded term → open it → `/jobs?by=<id>` shows two jobs marked new → back to `/searches` and reload → the count is 0.

### Job detail (US-018, US-030)

- **E2E-010**: `/jobs/<id>` for a job without a PHP row → shows primary and PHP fits with breakdowns.

### Privacy and operations (US-027, US-028, US-029)

- **E2E-011**: recruiter session → `/searches` is forbidden → `/jobs` shows no track selector → `/recruiter/<candidateId>` shows no track name or term.
- **E2E-012**: admin → `/admin/captures` lists platforms with quota and failures and no term text → start impersonating a candidate → `/admin/captures` is denied.
- **E2E-019**: admin impersonating a candidate → save a term on `/searches` → the term shows "waiting for the next daily sweep".

### Cross-cutting (US-002, US-007, US-012, US-020, US-021, US-027)

- **E2E-013**: at 375, 768 and 1024 px, `/searches`, `/searches/tracks/new`, `/searches/tracks/<id>`, `/jobs` with every new control and `/admin/captures` have `scrollWidth <= clientWidth`.
- **E2E-014**: English locale → `/searches`, `/searches/tracks/<id>`, `/jobs` and `/admin/captures` contain no Portuguese dictionary value and no accented character outside `[data-user-content]` (track names and terms carry it).
- **E2E-015**: `/jobs?q=<script>` shows the notice and the text escaped; `/jobs?pay=0` shows the pay notice; `/jobs?track=999` shows the track notice and primary fits.
- **E2E-016**: an expired session on `/searches/tracks/new` → redirect to `/login`; after login nothing was saved.
- **E2E-017**: save term `a` → "too short" message; save `Tech Lead` when `techlead` exists → duplicate message linking the existing term.
- **E2E-018**: create a track named `<img src=x onerror=alert(1)>` → the name renders as text and no dialog opens.
