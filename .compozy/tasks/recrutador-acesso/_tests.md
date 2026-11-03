# Test Specification: Candidate Grants and Revokes Recruiter Access, and Profile Directory

Canonical test contract for #465. Companion to `_techspec.md`.
Derived from `_user_stories.md` (behavior) and `_techspec.md` (components).

## Strategy

- Frameworks and harnesses: Vitest for unit and integration; integration uses
  the Docker Postgres per-test database (`useTestDb`/`releaseTestDb`) with real
  migrations and real transactions. Fakes only at I/O boundaries: injected
  clock (`T0 = 2026-10-06T12:00:00Z` unless stated), a recording `Mailer`
  (or `fileMailer` under `JHO_MAIL_SINK`), a throwing `Mailer` for delivery
  failures, the fake sweep lease where the sweep is unit-tested. Server
  Actions run with the session helpers of `tests/entry-denial.test.ts`.
- E2E through `tests/e2e/run-isolated.mjs` (Playwright), per-role scenarios
  (G16) in `tests/e2e/ui/recruiter-access.mjs`,
  `tests/e2e/ui/recruiter-invite.mjs`, `tests/e2e/ui/recruiter-suggestions.mjs`
  and `tests/e2e/ui/recruiter-directory.mjs`, registered in
  `config/e2e-spec-map.json`. Invitation sign-up uses the fake OIDC issuer
  and the mail sink from #464. Fixtures in `tests/e2e/setup.mjs`: candidate
  "Ana E2E" (owner of grants), recruiter "Rui E2E" with account, candidates
  "Paula Pública" (Public, CV consent on), "Rita Recrutadores" (Recruiters),
  "Pedro Privado" (Private), each with a known salary floor, note and email
  that must never appear outside their scope.
- Execution: `pnpm exec vitest run <files>` locally; full suite and E2E in CI.
- Conventions: table-driven `it.each` for pure rules; one behavior per case;
  test names cite the case ID (`UT-012 …`).

## Coverage Matrix

| Source | Behavior | Unit | Integration | E2E |
|---|---|---|---|---|
| US-001 | Grant to existing recruiter | UT-015 | IT-016, IT-017 | E2E-001 |
| US-001.AC-1 | Form and scope statement | — | IT-075 | E2E-001 |
| US-001.AC-4 | Access-granted email | UT-045 | IT-016 | E2E-001 |
| US-001.AC-5 | History entry | — | IT-058 | E2E-006 |
| US-001.EC-1 | Malformed email | UT-003, UT-004, UT-005 | — | E2E-003 |
| US-001.EC-2 | Case and spaces normalized | UT-001 | IT-018 | — |
| US-001.EC-3 | Blank email | UT-002 | — | E2E-003 |
| US-001.EC-4 | Own email refused | UT-020 | IT-019 | E2E-003 |
| US-001.EC-5 | Already active or invited | — | IT-020, IT-021 | — |
| US-001.EC-6 | Disabled account → invitation | UT-016 | IT-022, IT-100 | — |
| US-001.EC-7 | No recruiter role → invitation | UT-017, UT-044 | IT-023 | — |
| US-001.EC-8 | Session expired | — | IT-077 | — |
| US-001.EC-9 | Recruiter-only or admin-only | UT-037 | IT-024, IT-075 | — |
| US-001.EC-10 | Double submit | — | IT-025 | — |
| US-001.EC-11 | Resubmit after lost connection | — | IT-020 | — |
| US-001.EC-12 | Email delivery fails | — | IT-026 | — |
| US-001.EC-13 | Daily cap | UT-022 | IT-033 | — |
| US-001.EC-14 | End date today or past | UT-009, UT-010 | IT-027 | E2E-003 |
| US-001.EC-15 | Empty state and 20+ entries | — | IT-059 | E2E-001 |
| US-002 | Invite recruiter without account | UT-019 | IT-028 | E2E-002 |
| US-002.AC-2 | Invitation email in candidate's language | UT-043 | IT-028 | — |
| US-002.EC-1 | Malformed, blank, own email | UT-002, UT-003, UT-020 | IT-019 | — |
| US-002.EC-2 | Pending invitation exists | — | IT-021 | — |
| US-002.EC-3 | Delivery fails | — | IT-029 | — |
| US-002.EC-4 | 20 pending | — | IT-030 | — |
| US-002.EC-5 | Daily cap | UT-022 | IT-033 | — |
| US-002.EC-6 | Same email, two candidates | — | IT-031, IT-088 | — |
| US-002.EC-7 | Sign-up without the link completes | — | IT-088 | — |
| US-002.EC-8 | Double submit | — | IT-032 | — |
| US-003 | Accept by signing up with invited email | UT-024 | IT-083, IT-084 | E2E-010, E2E-011 |
| US-003.AC-1 | Landing names candidate, expected address (also at 375 px) | UT-034 | IT-079 | E2E-010, E2E-015 |
| US-003.AC-4 | List, history and email after accept | — | IT-083 | E2E-010 |
| US-003.AC-5 | Existing recruiter account accepts | — | IT-093, IT-094 | — |
| US-003.EC-1 | Expired link | UT-026 | IT-080 | E2E-013 |
| US-003.EC-2 | Used, superseded or cancelled link | UT-027 | IT-080 | E2E-013 |
| US-003.EC-3 | Tampered or unknown token | UT-028 | IT-080 | E2E-013 |
| US-003.EC-4 | Abandoned sign-up | — | IT-082 | — |
| US-003.EC-5 | Link dies during sign-up | — | IT-089 | — |
| US-003.EC-6 | Signed in as another account | UT-034 | IT-095 | E2E-014 |
| US-003.EC-7 | Invited email without recruiter role | UT-031 | IT-096 | — |
| US-003.EC-8 | Two tabs | — | IT-092 | — |
| US-003.EC-9 | Cancelled before completion | UT-027 | IT-089 | — |
| US-003.EC-10 | Candidate disabled or deleted | UT-029 | IT-081, IT-097 | — |
| US-003.EC-11 | #464 sign-up cap | — | IT-099 | — |
| US-004 | Other email grants nothing | UT-025 | IT-085 | E2E-012 |
| US-004.EC-1 | Case and spaces equal | UT-001 | IT-086 | — |
| US-004.EC-2 | Provider email unverified | — | IT-101 | — |
| US-004.EC-3 | Gmail dot/plus variants differ | UT-006, UT-032 | IT-087 | — |
| US-004.EC-4 | Repeated wrong emails | — | IT-085, IT-099 | — |
| US-005 | Told and finds candidate | UT-045 | IT-016, IT-103 | E2E-001 |
| US-005.AC-3 | Empty state replaced by list | — | IT-103 | E2E-016 |
| US-005.EC-1 | Email link while signed out | — | — | E2E-021 |
| US-005.EC-2 | Email link after end → 404 | — | IT-038 | E2E-021 |
| US-005.EC-3 | Email not delivered, still listed | — | IT-026 | — |
| US-005.EC-4 | 50 candidates paginated by name | — | IT-103 | — |
| US-006 | End date set, moved, cleared | UT-007, UT-008 | IT-044, IT-045 | E2E-005 |
| US-006.AC-2 | End of day in shown zone | UT-011, UT-014 | — | — |
| US-006.AC-3 | Edit email and history | UT-046 | IT-044 | — |
| US-006.AC-4 | Invitation end date kept on accept | — | IT-091 | — |
| US-006.EC-1 | Past, today or unparseable | UT-009, UT-010, UT-013 | IT-027 | E2E-003 |
| US-006.EC-2 | Beyond 5 years | UT-012 | — | — |
| US-006.EC-3 | Edit after it ended | — | IT-046 | — |
| US-006.EC-4 | Link expires before end date | — | IT-063 | — |
| US-006.EC-5 | End date before acceptance | UT-030 | IT-090 | — |
| US-006.EC-6 | Same edit twice | — | IT-047 | — |
| US-007 | Access list and pending invitations | UT-033 | IT-059, IT-060 | E2E-001 |
| US-007.AC-3 | Last access refresh | — | IT-106 | E2E-017 |
| US-007.EC-1 | Empty state | — | IT-059 | E2E-001 |
| US-007.EC-2 | Renamed recruiter | — | IT-059 | — |
| US-007.EC-3 | Recruiter deleted | — | IT-013 | — |
| US-007.EC-4 | Recruiter disabled | UT-033 | IT-059 | — |
| US-007.EC-5 | Names as text | — | — | E2E-001 |
| US-007.EC-6 | Role removed | UT-033 | IT-008, IT-059 | — |
| US-007.EC-7 | 375 px | — | — | E2E-009 |
| US-008 | Revoke immediately | — | IT-038 | E2E-004 |
| US-008.AC-3 | Access-ended email, cause candidate | UT-047 | IT-038 | — |
| US-008.AC-4 | Suggestions stay with candidate | — | IT-043, IT-133 | — |
| US-008.EC-1 | Revoke twice | — | IT-039 | — |
| US-008.EC-2 | In-flight request | — | IT-038 | — |
| US-008.EC-3 | Cancel on dialog | — | — | E2E-004 |
| US-008.EC-4 | Expired a moment earlier | — | IT-041 | — |
| US-008.EC-5 | Delivery fails | — | IT-042 | — |
| US-008.EC-6 | Session expired at click | — | IT-077 | — |
| US-008.EC-7 | Forged revoke of other candidate | — | IT-040 | — |
| US-009 | Resend or cancel | — | IT-050, IT-053 | E2E-005 |
| US-009.AC-3 | Expired shown with Resend until dismissed | — | IT-052, IT-055, IT-060 | — |
| US-009.EC-1 | Resend counts against cap | — | IT-037 | — |
| US-009.EC-2 | Cancel during sign-up | — | IT-089 | — |
| US-009.EC-3 | Resend after acceptance | — | IT-051 | — |
| US-009.EC-4 | Cancel twice | — | IT-054 | — |
| US-009.EC-5 | No email on cancel | — | IT-053 | — |
| US-010 | Access ends at end date | — | IT-007, IT-061 | — |
| US-010.AC-2 | Expiry email and history | UT-047 | IT-061 | — |
| US-010.AC-3 | Suggestions stay | — | IT-061, IT-133 | — |
| US-010.EC-1 | Late job, access already denied | — | IT-007 | — |
| US-010.EC-2 | Extended before it passes | — | IT-048 | — |
| US-010.EC-3 | Extended after it passed | — | IT-049 | — |
| US-010.EC-4 | Many expire together | — | IT-062 | — |
| US-011 | Grant again after end | — | IT-003, IT-056 | — |
| US-011.EC-1 | Old end date not carried | — | IT-056 | — |
| US-011.EC-2 | Again while active | — | IT-020 | — |
| US-011.EC-3 | After administrator revoked | — | IT-057 | — |
| US-011.EC-4 | Counts against cap | UT-022 | IT-033 | — |
| US-012 | History | — | IT-058 | E2E-006 |
| US-012.EC-1 | Nothing shared yet | — | IT-058 | E2E-006 |
| US-012.EC-2 | Paginated | — | IT-058 | — |
| US-012.EC-3 | Email kept after removal | — | IT-013, IT-058 | — |
| US-012.EC-4 | Not editable | — | IT-015 | — |
| US-012.EC-5 | Impersonation read-only | — | IT-075 | E2E-008 |
| US-013 | Candidate list, name in title | — | IT-103, IT-105 | E2E-016 |
| US-013.EC-1 | No candidate | — | IT-103 | E2E-016 |
| US-013.EC-2 | No display name | — | IT-104 | — |
| US-013.EC-3 | Access ends while list open | — | IT-038 | E2E-021 |
| US-013.EC-4 | Markup in names | — | — | E2E-016 |
| US-013.EC-5 | 375 px | — | — | E2E-016 |
| US-014 | Funnel read-only, last access | — | IT-106 | E2E-017 |
| US-014.AC-2 | No write controls | — | IT-111 | E2E-017 |
| US-014.EC-1 | Empty funnel | — | IT-141 | — |
| US-014.EC-2 | Page out of range | — | IT-142 | — |
| US-014.EC-3 | Forged writes refused | UT-042 | IT-111 | — |
| US-014.EC-4 | 1,000 entries paginated | — | IT-142 | — |
| US-014.EC-5 | Job page without candidate data | — | IT-112 | — |
| US-015 | Current CV | — | IT-107 | E2E-017 |
| US-015.AC-3 | CV view updates last access | — | IT-106 | — |
| US-015.EC-1 | No CV yet | — | IT-108 | — |
| US-015.EC-2 | Earlier version or other candidate | — | IT-110 | — |
| US-015.EC-3 | Revoked while open | — | IT-110 | — |
| US-015.EC-4 | CV unavailable | — | IT-108 | — |
| US-015.EC-5 | Large CV complete | — | IT-109 | — |
| US-015.EC-6 | Download name | — | IT-109 | — |
| US-016 | Privacy boundary | UT-038 | IT-110, IT-111 | E2E-021 |
| US-016.EC-1 | Malformed ids | — | IT-110 | — |
| US-016.EC-2 | Export endpoints | — | IT-113 | — |
| US-016.EC-3 | Recruiter who is also candidate | — | IT-114 | — |
| US-016.EC-4 | `/p/` unchanged | — | IT-144 | — |
| US-017 | Loss of access and notice | UT-047 | IT-038, IT-067 | E2E-004 |
| US-017.AC-3 | Own suggestions hidden after end | — | IT-128 | — |
| US-017.EC-1 | Next navigation 404 | — | IT-038 | E2E-021 |
| US-017.EC-2 | Email not delivered | — | IT-042 | — |
| US-017.EC-3 | Re-granted: only new suggestions | — | IT-128 | — |
| US-018 | Suggest a job | UT-056 | IT-115 | E2E-018 |
| US-018.AC-1 | Pick from catalog or register | — | IT-124 | E2E-019 |
| US-018.EC-1 | Note over 500 | UT-050 | IT-126 | — |
| US-018.EC-2 | Note markup as text | UT-051 | IT-126 | — |
| US-018.EC-3 | Already suggested by me | UT-053 | IT-117 | — |
| US-018.EC-4 | Pending from another recruiter | UT-055 | IT-118 | — |
| US-018.EC-5 | Already in funnel | — | IT-119 | — |
| US-018.EC-6 | Closed or archived | UT-052 | IT-120 | — |
| US-018.EC-7 | Access ends before submit | — | IT-121 | — |
| US-018.EC-8 | 20 per 24 h | UT-057 | IT-122 | — |
| US-018.EC-9 | Double submit | — | IT-123 | — |
| US-018.EC-10 | New job validation fails | — | IT-124 | — |
| US-018.EC-11 | Email fails | — | IT-125 | — |
| US-019 | State of my suggestions | — | IT-127 | E2E-018, E2E-020 |
| US-019.EC-1 | None yet | — | IT-127 | — |
| US-019.EC-2 | Others' suggestions hidden | — | IT-127 | — |
| US-019.EC-3 | Paginated newest first | — | IT-127 | — |
| US-019.EC-4 | Closed marker | — | IT-127 | — |
| US-020 | Notice and review (also at 375 px) | UT-048 | IT-115, IT-139, IT-140 | E2E-018, E2E-022 |
| US-020.EC-1 | Empty state | — | IT-139 | — |
| US-020.EC-2 | Access ended marker | — | IT-139 | — |
| US-020.EC-3 | Closed job | — | IT-139 | — |
| US-020.EC-4 | 100 pending paginated | — | IT-139 | — |
| US-020.EC-5 | One email per recruiter per hour | UT-059 | IT-116 | — |
| US-020.EC-6 | Impersonation cannot decide | UT-039 | IT-138 | E2E-023 |
| US-021 | Accept into funnel | UT-058 | IT-129 | E2E-018 |
| US-021.EC-1 | Accept twice | — | IT-130 | — |
| US-021.EC-2 | Already in funnel | UT-058 | IT-131 | — |
| US-021.EC-3 | Already declined | UT-058 | IT-132 | — |
| US-021.EC-4 | Recruiter's access ended | — | IT-133 | — |
| US-021.EC-5 | Forged accept | — | IT-134 | — |
| US-022 | Decline | — | IT-135 | E2E-020 |
| US-022.EC-1 | Decline twice | — | IT-135 | — |
| US-022.EC-2 | Already accepted | — | IT-135 | — |
| US-022.EC-3 | Same recruiter re-suggests | UT-054 | IT-136 | — |
| US-022.EC-4 | Forged decline | — | IT-137 | — |
| US-023 | Administrator revokes or cancels | — | IT-066, IT-067, IT-068 | E2E-007 |
| US-023.EC-1 | Already ended | — | IT-069 | — |
| US-023.EC-2 | Not an administrator | — | IT-070 | — |
| US-023.EC-3 | Concurrent with candidate | — | IT-074 | — |
| US-024 | Administrator never grants | UT-036 | IT-071, IT-076 | E2E-007, E2E-008 |
| US-024.EC-1 | Forged candidate id | — | IT-072 | — |
| US-024.EC-2 | Admin who is also candidate | — | IT-073 | — |
| US-025 | Caps | UT-021, UT-022 | IT-033, IT-034 | — |
| US-025.EC-1 | Revocations and cancellations not counted | — | IT-036 | — |
| US-025.EC-2 | Concurrent at the limit | — | IT-035 | — |
| US-025.EC-3 | Refused attempts not counted | — | IT-036 | — |
| US-025.EC-4 | Administrator actions not counted | — | IT-036, IT-067 | — |
| US-026 | Directory search | UT-060 | IT-147, IT-148 | E2E-024 |
| US-026.AC-3 | Filters | UT-065 | IT-151 | E2E-024 |
| US-026.AC-4 | Allowlist-only cards | UT-070 | IT-146 | — |
| US-026.EC-1 | Empty search | UT-063 | IT-147 | — |
| US-026.EC-2 | No match, no hidden counts | — | IT-153 | — |
| US-026.EC-3 | Long or symbol-only text | UT-061, UT-062 | — | — |
| US-026.EC-4 | Forged parameters | UT-065 | IT-152 | — |
| US-026.EC-5 | Page out of range | UT-064 | IT-153 | — |
| US-026.EC-6 | Thousands of profiles (pagination; latency not asserted) | — | IT-147 | — |
| US-026.EC-7 | Rate limit | UT-068 | IT-154 | — |
| US-026.EC-8 | Session expires mid-search | — | IT-160 | — |
| US-026.EC-9 | Visibility changes between pages | — | IT-155 | — |
| US-026.EC-10 | Two roles | — | IT-164 | — |
| US-026.EC-11 | 375 px | — | — | E2E-028 |
| US-027 | Read profile, allowlist only (page and images) | — | IT-145, IT-159 | E2E-024 |
| US-027.AC-2 | CV text under consent, filtered | UT-071 | IT-158 | E2E-024 |
| US-027.AC-3 | `/p/` link for Public | — | IT-163 | — |
| US-027.AC-4 | No grant control, nothing recorded | — | IT-161 | — |
| US-027.EC-1 | No consent, no CV | UT-071 | IT-158 | — |
| US-027.EC-2 | Recruiters without `/p/` | — | IT-163 | — |
| US-027.EC-3 | Became Private | — | IT-155 | — |
| US-027.EC-4 | Unknown or malformed id | — | IT-145 | — |
| US-027.EC-5 | Recruiter also holds a grant | — | IT-162 | — |
| US-027.EC-6 | Markup as text | — | — | E2E-024 |
| US-027.EC-7 | Reload has no side effects | — | IT-161 | — |
| US-028 | Visibility decides discovery | UT-074 | IT-155, IT-156 | E2E-025, E2E-029 |
| US-028.AC-4 | Grants unaffected | — | IT-155 | — |
| US-028.EC-1 | Forged value | — | IT-157 | — |
| US-028.EC-2 | Same value twice | — | IT-157 | — |
| US-028.EC-3 | Two tabs, last wins | — | IT-157 | — |
| US-028.EC-4 | Impersonation refused | UT-036 | IT-156 | — |
| US-028.EC-5 | Profile with missing fields | — | IT-148 | — |
| US-028.EC-6 | Rapid changes | — | IT-155 | — |
| US-029 | Anonymous refused | UT-041 | IT-160 | E2E-026 |
| US-029.AC-2 | Candidate-only and admin-only refused | UT-041 | IT-160 | E2E-026 |
| US-029.EC-1 | Shared search URLs | — | IT-160 | — |
| US-029.EC-2 | Expired session | — | IT-160 | — |
| US-029.EC-3 | Admin impersonating recruiter | UT-040 | — | — |
| US-029.EC-4 | `/p/` of Recruiters → 404 | — | IT-166 | — |
| US-030 | Private never listed | UT-073 | IT-147, IT-150 | E2E-025 |
| US-030.AC-2 | Private by id → 404 | — | IT-145 | — |
| US-030.EC-1 | Exact name search | — | IT-150 | — |
| US-030.EC-2 | Invited recruiter still not finding | — | IT-150 | — |
| US-030.EC-3 | Unknown stored visibility | UT-073 | IT-147 | — |
| US-030.EC-4 | Zero visible profiles | — | IT-165 | — |
| US-031 | Private fields never shown | UT-070 | IT-146 | E2E-027 |
| US-031.AC-2 | Same fields as public profile | — | IT-146 | — |
| US-031.EC-1 | CV contacts and salary filtered | UT-071 | IT-158 | — |
| US-031.EC-2 | Future private field absent | UT-070 | — | — |
| US-031.EC-3 | Export or API | — | IT-167 | — |
| US-031.EC-4 | Search on private field content | — | IT-149 | — |
| Access rules | Pure decisions (TechSpec Core Interfaces) | UT-001–UT-034 | — | — |
| Policy | Four new actions (TechSpec Component Overview — Policy) | UT-035–UT-042 | — | — |
| Recruiter emails | Builders | UT-043–UT-049 | — | — |
| Schema and migration | Tables, copy, constraints | — | IT-001–IT-004 | — |
| Access predicate and admin store | `linkedCandidatesFor`, `revokeGrant`, removal | — | IT-005–IT-015 | — |
| Access service | Use cases and actions | — | IT-016–IT-060, IT-066–IT-077 | — |
| Sweep and cleanup | Expiry job, purge | — | IT-061–IT-065 | — |
| Route and entry registration | Inventory per task | — | IT-078, IT-102, IT-143, IT-168 | — |
| Invitation flow | Landing, cookie, completion | — | IT-079–IT-101 | — |
| Suggestion rules | Pure decisions | UT-050–UT-059 | — | — |
| Recruiter workspace | List, title, CV, last access | — | IT-103–IT-114, IT-141, IT-142 | — |
| Suggestion service | Create, digest, decide, lists | — | IT-115–IT-140 | — |
| Allowlist builder | `toAllowlistedProfile`, `allowlistedProfile` | UT-069–UT-073 | IT-144–IT-146 | — |
| Directory search | Query, search, rate limit | UT-060–UT-068 | IT-147–IT-154 | — |

## Unit Tests

### Access rules (TechSpec: Core Interfaces — `recruiter-access.ts`)

- **UT-001** (happy): `normalizeEmail("  Ana@X.COM ")` returns `{ ok: true, value: "ana@x.com" }`.
- **UT-002** (error): `normalizeEmail("")` and `normalizeEmail("   ")` return `{ ok: false, error: "blank_email" }`.
- **UT-003** (error): `normalizeEmail("ana.x.com")` returns `invalid_email`.
- **UT-004** (error): `normalizeEmail("ana silva@x.com")` returns `invalid_email`.
- **UT-005** (boundary): a 254-character address (`"a".repeat(242) + "@example.com"`) is accepted; 255 characters return `invalid_email`.
- **UT-006** (happy): `normalizeEmail("A.B+x@Gmail.com")` returns `"a.b+x@gmail.com"`, which differs from `normalizeEmail("ab@gmail.com")` (no provider rewriting).
- **UT-007** (happy): `parseEndDate({ date: "", tz: "America/Sao_Paulo", now: T0 })` returns `{ expiresAt: null, tz: "America/Sao_Paulo" }`.
- **UT-008** (happy): `parseEndDate({ date: "2026-10-20", tz: "America/Sao_Paulo", now: T0 })` returns `expiresAt: "2026-10-21T02:59:59.999Z"`.
- **UT-009** (error): `parseEndDate({ date: "2026-10-06", tz: "America/Sao_Paulo", now: T0 })` returns `date_past`.
- **UT-010** (error): `parseEndDate({ date: "2026-10-01", tz: "UTC", now: T0 })` returns `date_past`.
- **UT-011** (boundary): with `now = 2026-10-07T01:30:00Z` (still 2026-10-06 in São Paulo), `date: "2026-10-07"` is accepted with `tz: "America/Sao_Paulo"` and refused as `date_past` with `tz: "UTC"`.
- **UT-012** (boundary): with `now = T0`, `"2031-10-06"` is accepted and `"2031-10-07"` returns `date_too_far`.
- **UT-013** (error): `"2026-02-30"`, `"20/10/2026"` and `"abc"` each return `date_invalid`.
- **UT-014** (state): `tz: "Mars/Base"` and `tz: ""` fall back to `"UTC"`; `date: "2026-10-20"` then yields `"2026-10-20T23:59:59.999Z"`.
- **UT-015** (happy): `grantTarget` with an account `{ roles: ["recruiter"], disabled: false, emailVerified: true }` returns `"grant"`.
- **UT-016** (state): the same account with `disabled: true` returns `"invite"`.
- **UT-017** (state): an account with `roles: ["candidate"]` returns `"invite"`.
- **UT-018** (state): a recruiter account with `emailVerified: false` returns `"invite"`.
- **UT-019** (state): `account: null` returns `"invite"`.
- **UT-020** (error): `email` equal to one of `candidateEmails` returns `"self"`, even when the account has the recruiter role.
- **UT-021** (happy): `capDecision` with 9 timestamps inside 24 h and `limit: 10` returns `{ ok: true }`.
- **UT-022** (error): 10 timestamps inside 24 h, the oldest `2026-10-05T14:00:00Z`, return `{ ok: false, retryAt: "2026-10-06T14:00:00.000Z" }`.
- **UT-023** (boundary): a timestamp exactly 24 h before `now` is outside the window; 9 inside + 1 at the edge returns `{ ok: true }`.
- **UT-024** (happy): `inviteCompletion` with a pending invite for `ana@x.com` expiring after `now`, `accessExpiresAt: null`, enabled candidate and an enabled verified recruiter `ana@x.com` returns `"completed"`.
- **UT-025** (error): account email `bia@y.com` for an invite to `ana@x.com` returns `"mismatch"`.
- **UT-026** (error): `expiresAt <= now` returns `"invalid"`.
- **UT-027** (state): `it.each(["accepted", "cancelled", "superseded", "expired"])` statuses return `"invalid"`.
- **UT-028** (error): `invite: null` (unknown or tampered token) returns `"invalid"`.
- **UT-029** (state): `candidateEnabled: false` returns `"invalid"`.
- **UT-030** (state): `accessExpiresAt` before `now` returns `"period_over"`.
- **UT-031** (state): account with the invited email and `roles: ["candidate"]` returns `"not_recruiter"`.
- **UT-032** (error): invite to `ab@gmail.com` and account `a.b+x@gmail.com` returns `"mismatch"`.
- **UT-033** (state): `grantDisplay({ disabled: true, roles: ["recruiter"] })` → `"account_disabled"`; `{ disabled: false, roles: ["candidate"] }` → `"not_recruiter"`; `{ disabled: false, roles: ["recruiter"] }` → `"active"`.
- **UT-034** (happy): `maskEmail("ana@x.com")` → `"a•••@x.com"`; `maskEmail("a@x.com")` → `"a•••@x.com"`.

### Policy (TechSpec: Component Overview — Policy)

- **UT-035** (happy): `can(candidateSession(7), "access:manage", { kind: "candidate", candidateId: 7 })` allows.
- **UT-036** (error): the same with `impersonatedBy: 1` denies with "sessão emprestada".
- **UT-037** (error): `access:manage` denies a recruiter-only session, an admin-only session and a candidate session targeting `candidateId: 8`.
- **UT-038** (happy/error): `suggestion:create` on `{ candidate 7 }` allows a recruiter with `linkedCandidateIds: [7]` and denies one with `[8]` and a candidate-only session.
- **UT-039** (happy/error): `suggestion:decide` on own candidate allows; with `impersonatedBy` set denies.
- **UT-040** (happy): `candidate:discover` allows a recruiter session and a borrowed session whose roles are `["recruiter"]`.
- **UT-041** (error): `candidate:discover` denies `null`, candidate-only and admin-only sessions.
- **UT-042** (error): `candidate:write` and `application:write` on `{ candidate 7 }` deny a recruiter with `linkedCandidateIds: [7]`.

### Recruiter emails (TechSpec: Component Overview — Recruiter emails)

- **UT-043** (happy): `inviteEmail({ locale: "pt-BR", candidateName: "Ana", url, validUntil: "2026-10-13T12:00:00Z" })` text contains "Ana", the scope sentence, the validity date in pt-BR, the "use this same email" sentence and `url`; `locale: "en"` returns the English strings.
- **UT-044** (state): `inviteEmail({ …, needsRecruiterAccount: true })` adds the sentence that a recruiter account is required.
- **UT-045** (happy): `accessGrantedEmail` contains the candidate name, "No end date" or the formatted end with its zone, and the link `/recruiter/7`.
- **UT-046** (happy): `endDateChangedEmail` with `expiresAt` prints the new end; with `null` prints "no longer ends".
- **UT-047** (state): `it.each(["candidate", "admin", "expired"])` `accessEndedEmail` causes print, respectively, the candidate-revoked sentence without reason, "service administration", and "access period ended".
- **UT-048** (happy): `suggestionsDigestEmail` with 3 items lists the recruiter name and the 3 job titles with companies, and one link to `/suggestions`; notes are not included.
- **UT-049** (boundary): a candidate name `"Ana\nBcc: x@y.com"` produces a subject with no line break, and `<b>Ana</b>` appears verbatim in the plain-text body.

### Suggestion rules (TechSpec: Core Interfaces — `recruiter-suggestion.ts`)

- **UT-050** (boundary): `validateNote("")` → `null`; 500 characters → kept; 501 → `note_too_long`; `"  hi  "` → `"hi"`.
- **UT-051** (happy): `validateNote('<a href="x">job</a>')` returns the same string unchanged (rendered as text later).
- **UT-052** (error): `decideSuggest` with `job.closedAt` set, and separately with `archivedAt` set, returns `refuse/job_closed`.
- **UT-053** (error): `mine: "pending"` returns `refuse/already_suggested`.
- **UT-054** (error): `mine: "declined"` and `mine: "accepted"` return `refuse/already_decided_by_candidate`.
- **UT-055** (happy): `mine: null, pendingSuggestionId: 42` returns `{ kind: "join", suggestionId: 42 }`.
- **UT-056** (happy): `mine: null, pendingSuggestionId: null`, cap ok returns `{ kind: "create" }`.
- **UT-057** (ordering): cap refused returns `refuse/cap_reached` with `retryAt`; with the job also closed, `job_closed` wins.
- **UT-058** (state): `decideAccept` → `pending`+no application: `insert_backlog`; `pending`+application: `mark_only`; `accepted` or `declined`: `already_decided`.
- **UT-059** (boundary): `digestDue(null, T0)` → true; last sent 59 min ago → false; 60 min ago → true.

### Directory and allowlist (TechSpec: Core Interfaces — `candidate-directory.ts`, `candidate-public.ts`)

- **UT-060** (happy): `parseDirectoryQuery({ q: "  React  Node " })` returns two terms (`react`, `node`) and `textGiven: true`.
- **UT-061** (boundary): `q` of 250 characters is cut to 200 before parsing.
- **UT-062** (error): `q: "<script>"` and `q: "!!!"` yield `terms: []` with `textGiven: true`.
- **UT-063** (happy): `q` absent or `""` yields `terms: []`, `textGiven: false`.
- **UT-064** (boundary): `page` `"abc"`, `"-3"`, `"0"` → 1; `"7"` → 7.
- **UT-065** (error): `workModel: "x"` and `level: "ceo"` are dropped; `workModel: "remote"` is kept; `visibility: "private"` and `fields: "salary"` produce no field in the result.
- **UT-066** (boundary): `location` of 150 characters is trimmed to 100; `"  "` → `null`.
- **UT-067** (happy): `foldAccents("Sênior São Paulo")` → `"senior sao paulo"`.
- **UT-068** (boundary): `directoryRateDecision(60)` → ok; `61` → limited.
- **UT-069** (error): `toAllowlistedProfile` with headline `"Fale comigo: ana@x.com"` returns `headline: null`.
- **UT-070** (happy): `toAllowlistedProfile` given a row that also carries `salaryFloor`, `notes`, `email` returns exactly the keys `slug, name, headline, location, linkedinUrl, githubUrl, skills, facts, images, cv`.
- **UT-071** (state): `publicCv: false` → `cv: null`; `publicCv: true` with content holding `ana@x.com`, `+55 11 91234-5678` and `Pretensão salarial: R$ 30.000` → `cv` without those three.
- **UT-072** (state): `workModel: "remote"` with `publicWorkModel: false` is absent from `facts`.
- **UT-073** (state): `isDirectoryVisible("recruiters")` and `("public")` → true; `("private")`, `("foo")`, `null` → false.
- **UT-074** (happy): the dictionary has `candidate.visibility.recruitersHint` in pt-BR and en, each naming recruiters who signed up on their own.

## Integration Tests

### Schema, migration and access predicate (Postgres)

- **IT-001**: Migration copy — seed `recruiter_candidate(recruiter 2, candidate 7, created_by 1, created_at "2026-01-01T00:00:00Z")` on the previous schema; migrate; expect one `recruiter_grant` `active` with `recruiter_email` from `auth_user`, same `created_by`/`created_at`, `expires_at null`, and one `grant_created` event with `actor = 'system'`.
- **IT-002**: FK actions — delete recruiter user 2 → grant `recruiter_user_id` null, events keep `recruiter_email`; delete candidate 7 → its grants, invites, events and suggestions are gone.
- **IT-003**: Partial unique — a second `active` grant for (7, 2) fails with a unique violation; after the first becomes `revoked`, inserting a new `active` grant succeeds.
- **IT-004**: CHECKs — `status = 'paused'` on a grant, `note` of 501 characters on `recruiter_suggestion_by`, and an `active` grant with null recruiter are rejected.
- **IT-005**: `linkedCandidatesFor(2, ["recruiter"])` returns `[7]` for an active grant with no end.
- **IT-006**: grants in `revoked`, `expired` and `ended_account_removed` are not returned.
- **IT-007**: an `active` grant with `expires_at = "2026-10-06T11:59:59.999Z"` is not returned at `T0`; with `"2026-10-06T12:00:00.001Z"` it is.
- **IT-008**: user 2 loses the recruiter role → `linkedCandidatesFor(2, ["candidate"])` returns `[]` while the grant stays `active`.
- **IT-009**: `drizzleSessions.resolve` for a disabled recruiter returns `null`.
- **IT-010**: administrator reads `linkedCandidates(2)` and `linksOf(2)` apply the same predicate as IT-005 – IT-007.
- **IT-011**: `revokeGrant(grantId, admin 1)` → `status = 'revoked'`, `revoked_by = 1`, `ended_at` set, event `access_revoked` with `actor = 'admin'` and `actor_name` = admin's name; the recruiter's next `resolve` lacks 7.
- **IT-012**: two concurrent `revokeGrant` calls → one returns ok, the other `already_ended`; one event.
- **IT-013**: `UserDirectory.remove(2)` → the active grant becomes `ended_account_removed`, event `access_ended_account_removed` keeps `ana.rec@x.com`; pending suggestions by 2 stay `pending`.
- **IT-014**: `linkRecruiterToCandidate(2, 7, 1)` writes an active grant and a `system` event.
- **IT-015**: `tests/architecture.test.ts` — only `drizzle-store.ts`, `drizzle-directory.ts` and `drizzle-recruiter-access.ts` import `recruiterGrant`; no source file calls `.update(recruiterAccessEvent)` or `.delete(recruiterAccessEvent)`; nothing imports `recruiterCandidate` outside the schema.

### Access service and candidate actions (Postgres)

- **IT-016**: `grantRecruiterAccessAction(email "rui@x.com", no end)` as candidate 7 with an enabled verified recruiter `rui@x.com` → result `{ ok: true, kind: "grant" }`, active grant, `grant_created` (`actor = 'candidate'`), one `access_granted` email to `rui@x.com` linking `/recruiter/7`.
- **IT-017**: after IT-016, resolving the recruiter's existing session token returns `linkedCandidateIds` with 7 (no new login).
- **IT-018**: email `"  RUI@X.com "` matches the account `rui@x.com`; a second call with `"rui@x.com"` returns `already_active`.
- **IT-019**: candidate's own account email returns `self`; no row, no email.
- **IT-020**: with an active grant for `rui@x.com`, a second grant returns `already_active`; no event, no email.
- **IT-021**: with a pending invitation for `bia@y.com`, a grant to `bia@y.com` returns `already_invited`; no email.
- **IT-022**: the account `rui@x.com` disabled → invitation created (`kind: "invite"`); no grant; `linkedCandidatesFor` unchanged.
- **IT-023**: account `cand@x.com` with only the candidate role → `kind: "invite"`, invitation email with `needsRecruiterAccount: true`; the action result is identical to the no-account case.
- **IT-024**: the action called by a recruiter-only session and by an admin without candidate → denied (`AuthorizationError`); nothing written.
- **IT-025**: two concurrent grant calls for `rui@x.com` → one grant, one email; the other returns `already_active`.
- **IT-026**: throwing `Mailer` → grant active; `auth_event(kind = 'email_send_failed', detail = 'access_granted')`; the recruiter's `/recruiter` list still shows 7.
- **IT-027**: end date `"2026-10-06"` → `date_past`; no row.
- **IT-028**: no account for `bia@y.com`, candidate account `locale = 'en'` → pending invite with `expires_at = T0 + 7 d`, `token_hash` 64 hex characters and no raw token stored, `invite_sent` event, English invitation email.
- **IT-029**: throwing `Mailer` on invite → invite `pending` with `delivery_failed_at` set; `email_send_failed` recorded.
- **IT-030**: 20 pending unexpired invitations → 21st returns `too_many_pending`; with one of them past `expires_at`, the 21st succeeds.
- **IT-031**: candidates 7 and 8 both invite `bia@y.com` → two pending invitations with different tokens.
- **IT-032**: two concurrent invites to `bia@y.com` → one invitation, one email.
- **IT-033**: 10 counted actions since `T0 − 23 h` → the 11th returns `cap_reached` with `retryAt` = oldest + 24 h; no row, no email.
- **IT-034**: after advancing the clock past the oldest counted action + 24 h, the 11th succeeds.
- **IT-035**: with 9 counted, 3 concurrent grants to different emails → exactly one succeeds, two return `cap_reached`.
- **IT-036**: 9 counted + 2 revocations + 1 cancellation + 3 refused (`self`, `invalid_email`, `already_active`) + 1 administrator revocation → the next grant succeeds (10th counted).
- **IT-037**: resend writes `invite_resent` with `actor = 'candidate'` and counts toward the cap.
- **IT-038**: `revokeRecruiterAccessAction(grantId)` → `revoked`, `access_revoked` (`actor = 'candidate'`), one `access_ended` email (cause candidate); a session resolved before the revoke still holds 7, any resolve after it does not; `/recruiter/7` then answers 404.
- **IT-039**: two concurrent revocations → one ok, one `already_ended`; one email, one event.
- **IT-040**: candidate 8's session revoking candidate 7's grant id → `not_found`; grant unchanged.
- **IT-041**: grant with `expires_at` one second before `T0`, status still `active` → revoke returns `already_ended`; no `access_ended` email from the revoke.
- **IT-042**: throwing `Mailer` on revoke → grant `revoked`; `email_send_failed` (`access_ended`).
- **IT-043**: revoking a grant leaves the recruiter's `recruiter_suggestion` rows for 7 in `pending`.
- **IT-044**: `setGrantEndDateAction(grantId, "2026-10-20", "America/Sao_Paulo")` on a no-end grant → `expires_at = "2026-10-21T02:59:59.999Z"`, `end_date_changed` (detail = new ISO), one `end_date_changed` email.
- **IT-045**: clearing (`""`) → `expires_at null`, event detail `none`, email says it no longer ends.
- **IT-046**: editing a `revoked` grant → `already_ended`; nothing written.
- **IT-047**: the same edit submitted twice in sequence, and twice concurrently → one event, one email.
- **IT-048**: end date 2026-10-10; at 2026-10-10T20:00Z (before end in São Paulo) the candidate moves it to 2026-10-20 → at 2026-10-11T12:00Z `linkedCandidatesFor` still returns 7 and the sweep sends no `access_ended`.
- **IT-049**: after the end passes, `setGrantEndDateAction` returns `already_ended`.
- **IT-050**: `resendInviteAction` → old invite `superseded`, new `pending` with a different `token_hash` and `expires_at = now + 7 d`, `invite_resent` event, one email; the old token now resolves to `invalid`.
- **IT-051**: resend of an invite already `accepted` → `already_active`.
- **IT-052**: resend of a pending invite past `expires_at` → new pending invite; the old one ends `superseded`.
- **IT-053**: `cancelInviteAction` → `cancelled`, `cancelled_by` = candidate user, `invite_cancelled` event, no email; the token resolves to `invalid`.
- **IT-054**: cancel twice → one event; the second call returns ok without change.
- **IT-055**: `dismissInviteAction` on an expired invite → `dismissed_at` set; it leaves the list; history unchanged.
- **IT-056**: re-grant to `rui@x.com` after a revoked grant with end date 2026-12-01 → new `active` grant with `expires_at null`, a new `access_granted` email; history lists grant 1 created, revoked, grant 2 created.
- **IT-057**: re-grant after an administrator revocation → allowed.
- **IT-058**: history of 45 events → page 1 has 20 newest first (ties by id desc), page 3 has 5; each entry carries kind, time, email, actor; for a removed recruiter the email stays; with no events → empty list.
- **IT-059**: candidate list returns active grants newest first with current recruiter `full_name` (rename reflected), `last_accessed_at` or null, display `account_disabled` / `not_recruiter`; ended grants absent; 25 active grants all returned.
- **IT-060**: invitations list shows sent date, valid until, `delivery_failed`, and invitations past `expires_at` as `expired` until dismissed.
- **IT-061**: sweep job at `T0` with an active grant whose `expires_at` passed → `expired`, `ended_at`, `access_expired` (`actor = 'system'`), one email cause expired; pending suggestions stay; a second run changes nothing.
- **IT-062**: five grants with the same `expires_at` → five `expired`, five emails, one each.
- **IT-063**: pending invite past `expires_at` → `expired`, `invite_expired` event, no email, no grant.
- **IT-064**: `runSweepSlice` with a fake lease: two slices 10 min apart call `recruiterAccess` once under the key `manutencao:recruiter-access`; a slice 61 min later calls it again.
- **IT-065**: `runDatabaseCleanup` at `T0` deletes invites in `expired|cancelled|superseded` decided before `T0 − 30 d`, keeps newer ones and all `pending`, sets their events' `invite_id` to null, and deletes `recruiter_directory_query` rows older than one day.
- **IT-066**: administrator view of candidate 7 lists active grants (email, since, end) and pending invitations (email, sent, valid until).
- **IT-067**: `adminRevokeGrantAction` → `revoked`, event `actor = 'admin'` with `actor_name`, email cause admin; the candidate's counted actions in 24 h unchanged.
- **IT-068**: `adminCancelInviteAction` → `cancelled`, `cancelled_by` = admin, event `actor = 'admin'`.
- **IT-069**: administrator action on an ended grant → `already_ended`.
- **IT-070**: candidate session calling `adminRevokeGrantAction` → denied; borrowed session of an admin → denied.
- **IT-071**: borrowed session (admin impersonating candidate 7) calling grant, revoke, resend, cancel, dismiss and set end date → each denied; no row changes.
- **IT-072**: grant FormData carrying `candidateId = 8` from candidate 7's session → grant written for 7; nothing for 8.
- **IT-073**: an admin who also owns candidate 9, not borrowed, grants → allowed for 9.
- **IT-074**: concurrent candidate revoke and administrator revoke → one ending, one email, one event with the winner's actor.
- **IT-075**: `/account` renders the access section with scope statement and form for candidate 7; renders none for a recruiter-only session; for a borrowed session renders list and history without any form or button (`data-testid` absent).
- **IT-076**: `src/cli.ts` command table has no command whose name contains `grant` or `invite`.
- **IT-077**: grant and revoke actions with an expired session cookie → redirect to `/login`; no row.
- **IT-078**: inventory — the new actions appear in `tests/support/entry-inventory.ts` with their guards; `app/account` changes keep `PAGE_POLICY`; `app/admin` actions guarded by `user:manage`.

### Invitation flow (Postgres; depends on #464 sign-up)

- **IT-079**: `/signup/invite?token=<valid>` without session renders candidate "Ana", `a•••@x.com`, the "Create recruiter account" and "I already have an account" controls.
- **IT-080**: tokens of an expired, an accepted, a superseded and a cancelled invitation, and a random 43-character token, each render the identical neutral body (byte-equal HTML of `main`).
- **IT-081**: valid token whose candidate account is disabled, or whose candidate was deleted → neutral body.
- **IT-082**: `startInvitedSignup` sets `jho_invite` httpOnly, `SameSite=Lax`, `Max-Age` ≤ remaining validity, and redirects to `/signup?role=recruiter`; with no further step, no user and no grant exist and the invite stays `pending`.
- **IT-083**: social sign-up (fake OIDC) as recruiter with verified `bia@y.com` and the cookie → user created; invite `accepted` with `accepted_user_id`; grant `active` with `invite_id`; events `invite_accepted` then `grant_created`; one `access_granted` email; redirect `/recruiter/7`; cookie cleared.
- **IT-084**: manual sign-up with `bia@y.com`, code confirmed, cookie present → same results as IT-083.
- **IT-085**: sign-up through the link with `carla@z.com` → recruiter created, no grant, invite still `pending`, redirect `/recruiter?invite=mismatch`, `auth_event(kind = 'invite_mismatch')` without candidate data.
- **IT-086**: invite to `bia@y.com`, sign-up as `" Bia@Y.com"` → completes.
- **IT-087**: invite to `ab@gmail.com`, sign-up as `a.b+x@gmail.com` → `mismatch`.
- **IT-088**: candidates 7 and 8 invited `bia@y.com`; she signs up without any cookie → both invitations `accepted`, two grants, two emails.
- **IT-089**: invite cancelled (and, separately, past `expires_at`) between `startInvitedSignup` and sign-up completion → account created, no grant, redirect `/recruiter?invite=invalid`; history shows the cancellation and no acceptance.
- **IT-090**: invite with `access_expires_at` before completion → no grant, invite `expired`, redirect `/recruiter?invite=period_over`.
- **IT-091**: invite with `access_expires_at = "2026-10-21T02:59:59.999Z"` → grant `expires_at` equal, `expiry_tz` copied.
- **IT-092**: two concurrent completions with the same cookie token → one grant; the second reports `invalid`.
- **IT-093**: existing recruiter `bia@y.com` (verified) signs in through `/login?next=/signup/invite?token=…` → login hook completes the invite; the invite page then redirects to `/recruiter/7`.
- **IT-094**: signed-in recruiter `bia@y.com` with `email_verified_at null` submits `acceptInviteAction(token)` → grant created and `email_verified_at` set.
- **IT-095**: signed in as `carla@z.com` opening a valid link → message with `b•••@y.com`; no change.
- **IT-096**: signed in as `bia@y.com` with only the candidate role → "needs a recruiter account" message; no grant; the candidate's list shows the invitation still pending.
- **IT-097**: candidate account disabled after invitation, then sign-up completes → no grant; outcome `invalid`.
- **IT-098**: capturing `console.*` and the logger during IT-079, IT-082 and IT-083 → no output contains the raw token.
- **IT-099**: #464 per-IP cap reached during the invited sign-up → #464 refusal; the invite stays `pending` and completes on a later successful sign-up.
- **IT-100**: invite created while `rui@x.com` was disabled; an administrator re-enables it and Rui signs in → grant created.
- **IT-101**: LinkedIn identity with `email_verified` absent → #464 refuses sign-up; no user; invite `pending`.
- **IT-102**: inventory — `/signup/invite` in `PUBLIC_ROUTES` and `proxy.ts`; `startInvitedSignup` in `UNGUARDED_BY_DESIGN` with its control ("token de uso único por hash"); `acceptInviteAction` guarded; the page listed in `tests/e2e/routes.mjs` or `UNMEASURED_PAGES` with reason.

### Recruiter workspace (Postgres)

- **IT-103**: `recruiterCandidateSummaries` for a recruiter with 50 grants returns 25 per page ordered by name then id, each with `since`, `until` and the recruiter's own pending suggestion count; with 0 grants the page renders the #464 empty state.
- **IT-104**: candidate with empty name and headline "Backend" → label "Candidato · Backend"; the candidate's email never appears.
- **IT-105**: `generateMetadata` of `/recruiter/7` returns a title containing "Ana".
- **IT-106**: opening `/recruiter/7` sets `last_accessed_at = T0`; another open at `T0 + 30 s` writes nothing; at `T0 + 61 s` it updates; opening `/recruiter/7/cv` also updates.
- **IT-107**: `/recruiter/7/cv` shows the `is_current` CV content; after a new version is saved, it shows the new content and no version list.
- **IT-108**: candidate without a CV → "No CV yet"; current document with empty content → "CV unavailable" with no error detail.
- **IT-109**: `/recruiter/7/cv/download` returns `Content-Disposition: attachment; filename="ana-silva-cv.md"` with no numeric id, and a 900 KB content byte-equal to the stored one.
- **IT-110**: as a recruiter linked only to 7: `/recruiter/8`, `/recruiter/8/cv`, `/recruiter/8/cv/download`, `/recruiter/abc`, `/recruiter/-1`, `/recruiter/1.5` and `/recruiter/7/cv?version=<older id>` answer 404 or ignore the parameter (current CV); after revoking 7, `/recruiter/7/cv/download` answers 404.
- **IT-111**: as a recruiter linked to 7, invoking the funnel status and note actions for 7 → denied; no change in `application`.
- **IT-112**: as a recruiter linked to 7, `/jobs/<id>` for a job in 7's funnel renders no score, no fit analysis and no application note of 7.
- **IT-113**: `/api/export` as a recruiter linked to 7 returns no candidate 7 data (no applications, notes or CV).
- **IT-114**: a user with roles candidate (own 9) and recruiter (linked to 7) → `session.candidateId = 9`, `linkedCandidateIds = [7]`; another recruiter linked to 7 gets 404 on `/recruiter/9` (holding the recruiter role never shares 9).

### Suggestions (Postgres)

- **IT-115**: `suggestJobAction(7, job 100, note "Fits you")` → suggestion `pending`, `_by` row with the current `grant_id`, `suggestion_received` event, no `application` row, one digest email to Ana listing job 100.
- **IT-116**: a second suggestion 10 min later sends no email (`notified_at` null); the sweep at +60 min sends one digest listing both and sets `notified_at` on both rows.
- **IT-117**: suggesting job 100 again while pending → `already_suggested`; no email.
- **IT-118**: recruiter Rui and recruiter Sara both suggest job 100 → one `recruiter_suggestion`, two `_by` rows; the candidate list shows both names.
- **IT-119**: job 100 already in 7's funnel at `interviewing` → suggestion created `pending`; the action response is identical to the not-in-funnel case.
- **IT-120**: job with `closed_at` set, and one with `archived_at` set → `job_closed`.
- **IT-121**: grant revoked between page load and submit → the action answers 404; no suggestion.
- **IT-122**: 20 suggestions to 7 by Rui since `T0 − 23 h` → the 21st returns `cap_reached` with `retryAt`; with 19, two concurrent submissions → one succeeds.
- **IT-123**: two concurrent identical submissions → one suggestion, one email.
- **IT-124**: `createRecruiterJobAction` with `suggestFor = 7` and a valid job form → job created, suggestion pending, redirect `/recruiter/7`; with an empty title → form error and no suggestion; with `suggestFor = 8` (not linked) → 404 and no job.
- **IT-125**: throwing `Mailer` on the digest → suggestion exists; `email_send_failed` (`suggestions`); `notified_at` stays null.
- **IT-126**: note of 501 characters → `note_too_long`, nothing written; note `<b>hi</b>` stored as is and rendered escaped on `/suggestions`.
- **IT-127**: Rui's list on `/recruiter/7`: only his `_by` rows on his current grant, newest first, 20 per page, with state, decision date and a "Closed" marker for closed jobs; with none → "You have not suggested jobs yet".
- **IT-128**: after the grant ends, Rui's list for 7 is empty; after a re-grant he sees only suggestions made under the new grant.
- **IT-129**: `acceptSuggestionAction(id)` with no application → `application(status = 'backlog', channel = 'recruiter')`, suggestion `accepted` with `application_id`, `suggestion_accepted` event, the funnel row flagged as suggested; Rui sees "Accepted".
- **IT-130**: two concurrent accepts → one application, one event.
- **IT-131**: application exists at `interviewing` with `channel = 'referral'` → unchanged; suggestion `accepted`.
- **IT-132**: accept on a `declined` suggestion → `already_decided`.
- **IT-133**: accept after Rui's grant was revoked → succeeds.
- **IT-134**: candidate 8 accepting candidate 7's suggestion id → `not_found`; unchanged.
- **IT-135**: decline → `declined`, event, no `application` read or write; declining twice → one decision; declining an accepted one → `already_decided`.
- **IT-136**: after a decline, Rui suggests the same job → `already_decided_by_candidate`.
- **IT-137**: candidate 8 declining candidate 7's suggestion → `not_found`.
- **IT-138**: borrowed session accept and decline → denied; `/suggestions` renders without Accept/Decline.
- **IT-139**: `/suggestions` with 100 pending → 20 per page; each item has job, company, Ana's score, recruiter names, notes, date; an item from a revoked grant shows "Access ended" and remains decidable; a closed job shows "Closed"; with none → empty state.
- **IT-140**: nav count equals pending suggestions of the session's candidate (3 pending, 2 decided → 3).
- **IT-141**: `/recruiter/7` for a candidate with no applications renders "No applications yet".
- **IT-142**: funnel of 1,000 entries → `?page=abc` shows page 1, `?page=999` shows the last page (50), `?page=3` shows entries 41–60.
- **IT-143**: inventory — `/recruiter/[candidateId]/cv`, `/cv/download`, `/suggest`, `/suggestions` in `PAGE_POLICY` with guards; `suggestJobAction`, accept/decline in the entry inventory; `tests/entry-denial.test.ts` covers `suggestJobAction` with a non-linked id; `/suggestions` in `tests/e2e/routes.mjs`.

### Directory (Postgres)

- **IT-144**: `publicProfile("paula")` returns the same object as before the refactor (existing `tests/public-profile.test.ts` unchanged and green); `publicProfile("rita")` (Recruiters) returns `null`.
- **IT-145**: `allowlistedProfile({ id: rita }, ["recruiters", "public"])` returns her profile; for Pedro (Private), id 999999 and id `NaN` it returns `null`; the page answers 404 for each.
- **IT-146**: for Paula, the directory profile object deep-equals `publicProfile("paula")`; directory cards contain only fields of that object.
- **IT-147**: empty search with 45 visible and 10 Private profiles → `total = 45`, pages of 20 ordered by name then id, no Private row; a candidate with stored visibility `"foo"` absent.
- **IT-148**: `q = "senior react"` matches Rita (headline "Sênior"; confirmed skill "React"); a candidate with React only as a pending skill does not match; a profile with no headline is listed by name match only.
- **IT-149**: `q` equal to Rita's salary floor value, to a word only in her notes, or only in her CV text → no match.
- **IT-150**: `q = "Pedro Privado"` → no result, also for a recruiter holding a grant from Pedro.
- **IT-151**: `workModel = remote` matches only candidates with `work_model = remote` and `public_work_model = true`; `location = "porto"` matches "Porto Alegre".
- **IT-152**: `?visibility=private&fields=salaryFloor` returns the same result as no parameters.
- **IT-153**: `?page=99` with 45 results shows page 3; no match → "No profiles match" with no count.
- **IT-154**: 60 searches in 10 min render results; the 61st renders "Try again shortly" and no cards; at +10 min the next works; 5 concurrent at count 58 → at most 2 succeed.
- **IT-155**: Rita moves to Private → the next search lacks her, `/recruiter/directory/<rita>` answers 404, and her active grant to Rui still works; she moves back to Recruiters → listed again; three changes in a row each reflected on the next request.
- **IT-156**: `setVisibilityAction("recruiters", publicCv "on")` keeps `public_cv = true`; `"private"` clears it; a borrowed session → denied, unchanged.
- **IT-157**: `setVisibilityAction("everyone")` → validation error, unchanged; same value twice → no error; two sequential submissions from two tabs → last value stored.
- **IT-158**: Rita with consent → directory profile `cv` equals `publicCvMarkdown(content)` (no email, phone, salary passage); without consent → no `cv`, no CV link.
- **IT-159**: `/recruiter/directory/<rita>/image/photo` returns the image only with `public_photo = true`; Pedro's → 404; anonymous → redirect to login.
- **IT-160**: anonymous `GET /recruiter/directory?q=react` → redirect `/login?next=…`; candidate-only and admin-only sessions → refused page with no profile data, for the list, the profile and the image routes; an expired session behaves as anonymous.
- **IT-161**: row counts of every table except `recruiter_directory_query` are unchanged after a search and three profile reloads; the profile page has no grant or request control.
- **IT-162**: Rui (holding a grant from Rita) opening her directory profile sees the allowlist plus a link to `/recruiter/<rita>`; no funnel data on the directory page.
- **IT-163**: Paula's profile shows `/p/paula`; Rita's shows no `/p/` link.
- **IT-164**: a user with recruiter and candidate roles whose own profile is Private does not find it; set to Recruiters, it is listed.
- **IT-165**: installation with only Private profiles → empty state with no count.
- **IT-166**: anonymous `GET /p/rita` (Recruiters) → 404.
- **IT-167**: `/api/export` as a recruiter returns no fields of directory profiles.
- **IT-168**: inventory — `/recruiter/directory`, `/recruiter/directory/[id]` and its image route in `PAGE_POLICY` with `requirePage("candidate:discover")`; the list in `tests/e2e/routes.mjs`; the id pages in `UNMEASURED_PAGES` with reason; spec map area `recruiter-directory`.

## End-to-End Tests

### Candidate manages access (US-001, US-002, US-006 – US-009, US-012, US-023, US-024)

- **E2E-001**: Ana opens `/account` → sees the empty state and the scope statement → grants `rui@x.com` (recruiter "Rui <i>E2E</i>") with no end → the list shows "Active", today, "No end date", "Never", and the name rendered as literal text → Rui's session opens `/recruiter` and sees Ana → the mail sink holds the access-granted email.
- **E2E-002**: Ana grants `nova@x.com` (no account) → "Pending invitations" shows the email and "Link valid until" 7 days later → the mail sink holds the invitation in pt-BR.
- **E2E-003**: Ana submits `ana.x.com`, blank, her own email, and an end date of today → each shows its field error; the typed email is kept.
- **E2E-004**: Ana revokes Rui → dismisses the dialog first (nothing changes) → confirms → the entry leaves the list → Rui's next navigation to `/recruiter/<ana>` shows 404 → the mail sink holds "access ended".
- **E2E-005**: Ana sets Rui's end date, then clears it; resends the invitation to `nova@x.com` (new validity shown) and cancels it with confirmation.
- **E2E-006**: History shows the events from E2E-001 – E2E-005 newest first; a fresh candidate sees "Nothing shared yet".
- **E2E-007**: Admin opens `/admin/users`, sees Ana's grants and invitations, revokes one → Ana's history shows "Revoked by an administrator (<name>)"; no grant or invite control exists in the admin area.
- **E2E-008**: Admin impersonates Ana → the access section shows list and history with no form or action buttons.
- **E2E-009**: `/account` access section at 375 px (no horizontal scroll, actions reachable) and axe with no violations.

### Invited recruiter (US-003, US-004)

- **E2E-010**: Ana invites `bia@y.com` → open the link from the mail sink → landing names Ana and `b•••@y.com` → "Create recruiter account" → Google (fake issuer) as `bia@y.com` → lands on `/recruiter/<ana>` → Ana's list shows Bia "Active" and history "Invitation accepted".
- **E2E-011**: invitation to `caio@y.com` → manual sign-up with that email → code from the mail sink → lands on Ana's page.
- **E2E-012**: invitation to `dani@y.com` → sign-up through the link as `outra@y.com` → `/recruiter` shows the mismatch notice and no candidate.
- **E2E-013**: a cancelled link and a random token → the same neutral page.
- **E2E-014**: Rui signed in opens Bia's valid link → "This invitation is for b•••@y.com. Sign out to continue."
- **E2E-015**: `/signup/invite` states at 375 px and axe.

### Recruiter workspace and suggestions (US-005, US-013 – US-022)

- **E2E-016**: Rui with grants from Ana and "Zé <b>E2E</b>" → `/recruiter` lists both with "Access since", names as text, at 375 px; opening Ana shows "Ana" in the tab title; a recruiter with no grant sees the empty state.
- **E2E-017**: Rui opens Ana's page → funnel counts and rows with no status control → "View CV" shows the CV → download yields `ana-e2e-cv.md` → Ana's `/account` shows a last access time.
- **E2E-018**: Rui → "Suggest a job" → searches "Backend" → picks a job, note "Fits you" → his list shows "Pending" → Ana's nav shows 1 → `/suggestions` lists job, company, score, Rui, note → Accept → her funnel shows the job in Backlog with the "suggested by a recruiter" marker → Rui sees "Accepted".
- **E2E-019**: Rui registers a new job through `/jobs/new?suggestFor=<ana>` → lands on Ana's page with the suggestion "Pending".
- **E2E-020**: Ana declines a suggestion → her funnel unchanged → Rui sees "Declined".
- **E2E-021**: after Ana revokes Rui → `/recruiter/<ana>`, `/cv` and `/suggest` show 404; signed out, Rui opens the access-granted email link of an active grant from Zé → sign-in → Zé's page; the same link for Ana after the revoke → 404.
- **E2E-022**: `/suggestions`, `/recruiter/<ana>/cv` and `/recruiter/<ana>/suggest` at 375 px and axe.
- **E2E-023**: Admin impersonating Ana opens `/suggestions` → items visible, no Accept/Decline.

### Directory (US-026 – US-031)

- **E2E-024**: Rui opens `/recruiter/directory` → searches "react" → filters "remote" (chip visible, removable) → opens Paula → allowlist fields, filtered CV text, `/p/` link; opens Rita (headline with `<i>markup</i>` rendered as text) → no `/p/` link.
- **E2E-025**: Rita switches to Private on `/candidate` → Rui's next search lacks her and her directory page shows 404 → she switches to Recruiters → she appears; Pedro never appears, even searched by exact name.
- **E2E-026**: signed out, `/recruiter/directory` redirects to `/login`; Ana (candidate only) gets the refusal page; the admin-only account gets the refusal page.
- **E2E-027**: on every directory page Rui visits, the text never contains the fixtures' salary floors, notes, emails or phones.
- **E2E-028**: directory list and profile at 375 px and axe.
- **E2E-029**: `/candidate` shows Private, Recruiters and Public with hints; the Recruiters hint names recruiters who signed up on their own; the CV consent is offered for Recruiters and Public.
