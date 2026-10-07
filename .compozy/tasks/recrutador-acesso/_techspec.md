# TechSpec: Candidate Grants and Revokes Recruiter Access, and Profile Directory

Issue #465. Implements [`_prd.md`](_prd.md) and every story in
[`_user_stories.md`](_user_stories.md) (US-001 – US-031). Test contract:
[`_tests.md`](_tests.md). Depends on #464 (`.compozy/tasks/login-social/`):
sign-up screen, `email_verified_at`, `auth_user.locale`, `account-emails.ts`,
`Mailer`/`fileMailer`.

## Executive Summary

Recruiter access moves from the physical `recruiter_candidate` link to five
additive tables: `recruiter_grant` (state, end date, last access),
`recruiter_invite` (hashed single-use token), `recruiter_access_event`
(append-only history), and `recruiter_suggestion` + `recruiter_suggestion_by`
(ADR-011). Existing links are copied as active grants in the same migration;
`recruiter_candidate` is frozen and its removal is left to a later issue with
human review. The only access reader stays `linkedCandidatesFor`, which now
counts only active, unexpired grants, so revocation, expiry, role removal and
disabling all cut on the recruiter's next request without any cache or job
(ADR-012). Ending a grant is a conditional UPDATE that writes history in the
same transaction.

The candidate manages access from `/account` (grant by email, invitations,
end date with the browser's time zone, revoke, history) and decides
suggestions at `/suggestions`; every write is a Server Action guarded by a new
`access:manage` or `suggestion:decide` action that denies borrowed sessions
(G24). Invitations open under `/signup/invite` and complete when a recruiter
account proves the invited email, at the end of the #464 sign-up or after
sign-in (ADR-018). Accepting a suggestion creates the `backlog` application
through the candidate's own action, in the `decideSuggestion` pattern
(ADR-015). Limits are counted in the new tables under a per-candidate
advisory lock (ADR-017). Expiry notices, invitation expiry and grouped
suggestion emails run in the hourly sweep; dead invitations are purged by the
weekly cleanup (ADR-016). The recruiter directory is a new
`candidate:discover` action and `/recruiter/directory` routes on top of a
refactored allowlist builder shared with `/p/[slug]` (ADR-013), with the CV
consent extended to Recruiters (ADR-014). Trade-offs: an extra frozen table
until the follow-up removal, a one-click acceptance for signed-in recruiters,
and the invitation task waiting for `login-social` task_03.

## System Architecture

### Component Overview

| Component | Location | Responsibility |
|---|---|---|
| Schema + migration | `src/core/db/schema.ts`, `drizzle/postgres/<next>_recrutador_acesso.sql` | Six additive tables (ADR-011), CHECKs, partial uniques, FKs with `ON DELETE`; `INSERT … SELECT` copy of `recruiter_candidate`. |
| Access rules (pure) | `src/contexts/auth/domain/recruiter-access.ts` | Email normalization, end date + zone → instant, grant target decision, cap math, invitation completion decision, display status, email masking. |
| Policy | `src/contexts/auth/domain/types.ts`, `policy.ts` | New actions `access:manage`, `suggestion:create`, `suggestion:decide`, `candidate:discover`. |
| Access store | `src/contexts/auth/infra/drizzle-recruiter-access.ts` | Grants, invitations, history: transactional writes under the candidate advisory lock, conditional endings, reads for the candidate, the recruiter list and the administrator. |
| Access session read | `src/contexts/auth/infra/drizzle-store.ts` (`linkedCandidatesFor`), `drizzle-directory.ts` | Active-unexpired predicate; administrator reads; `revokeGrant` replaces `unlinkById`; account removal ends grants. |
| Access service | `src/contexts/auth/app/recruiter-access.ts` | Use cases: grant, revoke, set end date, resend, cancel, dismiss, admin revoke/cancel, complete invitations, expire due, list and history; sends emails after commit. |
| Recruiter emails | `src/contexts/auth/app/recruiter-emails.ts` | Localized `{subject, text}` builders: invitation, access granted, end date changed, access ended (cause), suggestions digest. |
| Suggestion rules (pure) | `src/contexts/pursuit/domain/recruiter-suggestion.ts` | Note validation, suggest decision (create/join/refuse), accept decision, digest due. |
| Suggestion store + service | `src/contexts/pursuit/infra/drizzle-recruiter-suggestions.ts`, `src/contexts/pursuit/app/recruiter-suggestions.ts` | Create/join under lock, accept/decline transaction, lists for candidate and recruiter, pending counts, digest batch. |
| Allowlist builder | `src/core/candidate-public.ts` | `allowlistedProfile(key, visibilities)`, pure `toAllowlistedProfile`; `publicProfile(slug)` wrapper. |
| Directory search | `src/core/candidate-directory.ts` | Pure `parseDirectoryQuery`; SQL search over allowlisted fields; rate-limit record + count. |
| Sweep + cleanup | `src/contexts/operations/app/sweep.ts`, `app/api/cron/varredura/route.ts` (composition), `src/core/db/retention.ts` | `manutencao:recruiter-access` hourly job; purge of dead invitations and query log. |
| Candidate web | `app/account/page.tsx`, `app/account/recruiter-access.tsx`, `app/account/recruiter-access-actions.ts`, `app/suggestions/page.tsx`, `app/suggestions/actions.ts`, `app/nav-links.tsx`, `app/candidate/page.tsx`, `app/candidate/actions.ts` | Access section, suggestions view, nav count, visibility hints and CV consent. |
| Invitation web | `app/signup/invite/page.tsx`, `app/signup/invite/actions.ts`, hooks in `src/contexts/auth/app/signup.ts` and `app/login/actions.ts` | Neutral page, cookie, acceptance, landing messages (ADR-018). |
| Recruiter web | `app/recruiter/page.tsx`, `app/recruiter/[candidateId]/page.tsx`, `…/cv/page.tsx`, `…/cv/download/route.ts`, `…/suggest/page.tsx`, `…/suggest/actions.ts`, `app/jobs/new/*` | List, candidate page (title, funnel, CV, my suggestions), CV view/download, suggest. |
| Directory web | `app/recruiter/directory/page.tsx`, `…/[id]/page.tsx`, `…/[id]/image/[kind]/route.ts` | Search, profile, images. |
| Admin web | `app/admin/users/page.tsx`, `app/admin/actions.ts` | Grants and invitations per candidate; revoke and cancel with the administrator's name. |

### Data flow

1. **Grant:** `/account` form → `grantRecruiterAccessAction` → `guard("access:manage", own candidate)` → service: normalize email, parse end date, transaction (advisory lock → caps → duplicate check → account lookup → insert grant + `grant_created` **or** insert invite + `invite_sent`) → commit → email (access granted or invitation) → on failure `auth_event(email_send_failed)` and, for an invitation, `delivery_failed_at`.
2. **Recruiter request:** cookie → `resolve()` → `linkedCandidatesFor` (active, unexpired grants) → `session.linkedCandidateIds` → page checks membership (404 otherwise) → `requirePage("candidate:read", candidate)` → read → touch `last_accessed_at`.
3. **Invitation:** email link → `/signup/invite?token` (lookup by hash) → cookie `jho_invite` → `/signup` (#464) → account committed with verified email → `completeInvitesForAccount` → grants + history + emails → landing.
4. **Suggestion:** recruiter page → `suggestJobAction` (selector id ∈ `linkedCandidateIds`, `guard("suggestion:create")`) → transaction (lock, cap, decision, insert/join, `suggestion_received`) → immediate digest if none sent to that candidate by this recruiter in the last hour, else left for the sweep.
5. **Decision:** `/suggestions` → `accept|declineSuggestionAction` → `guard("suggestion:decide", own candidate)` → transaction (lock row, status check, application insert when absent, history).
6. **End:** revoke/admin revoke → conditional UPDATE + history → email; expiry → predicate denies at once; sweep flips status, history, email.
7. **Directory:** `/recruiter/directory?q&location&workModel&level&page` → `requirePage("candidate:discover")` → record query + count (limit) → search over `visibility IN ('recruiters','public')` → cards from `toAllowlistedProfile` → profile `/recruiter/directory/[id]` → `allowlistedProfile({id}, ['recruiters','public'])` or 404.

External systems: Resend (existing `Mailer`), Postgres.

## Implementation Design

### Core Interfaces

```typescript
// src/contexts/auth/domain/recruiter-access.ts
export const INVITE_TTL_MS = 7 * 86_400_000;
export const CANDIDATE_DAILY_CAP = 10;
export const PENDING_INVITE_CAP = 20;
export type GrantStatus = "active" | "revoked" | "expired" | "ended_account_removed";
export type InviteStatus = "pending" | "accepted" | "expired" | "cancelled" | "superseded";
export type AccessError =
  | "blank_email" | "invalid_email" | "self" | "already_active" | "already_invited"
  | "cap_reached" | "too_many_pending" | "date_invalid" | "date_past" | "date_too_far"
  | "already_ended" | "not_found";
export type AccessResult<T> = { ok: true; value: T } | { ok: false; error: AccessError; retryAt?: string };
export function normalizeEmail(raw: string): AccessResult<string>;
export function parseEndDate(input: { date: string; tz: string; now: number }):
  AccessResult<{ expiresAt: string | null; tz: string }>;
export function grantTarget(input: {
  email: string; candidateEmails: readonly string[];
  account: { id: number; roles: readonly string[]; disabled: boolean; emailVerified: boolean } | null;
}): "self" | "grant" | "invite";
export function capDecision(countedAt: readonly string[], now: number, limit: number, windowMs: number):
  { ok: true } | { ok: false; retryAt: string };
```

```typescript
// src/contexts/auth/domain/recruiter-access.ts (continued)
export type InviteOutcome = "completed" | "mismatch" | "not_recruiter" | "period_over" | "invalid";
export function inviteCompletion(input: {
  invite: { status: InviteStatus; email: string; expiresAt: string; accessExpiresAt: string | null } | null;
  candidateEnabled: boolean;
  account: { email: string; roles: readonly string[]; disabled: boolean; emailVerified: boolean };
  now: number;
}): InviteOutcome;
export type GrantDisplay = "active" | "account_disabled" | "not_recruiter";
export function grantDisplay(recruiter: { disabled: boolean; roles: readonly string[] } | null): GrantDisplay;
export function maskEmail(email: string): string;              // "a•••@x.com"
```

```typescript
// src/contexts/pursuit/domain/recruiter-suggestion.ts
export const NOTE_MAX = 500;
export const SUGGESTION_DAILY_CAP = 20;
export type SuggestError = "note_too_long" | "job_closed" | "already_suggested"
  | "already_decided_by_candidate" | "cap_reached" | "not_found";
export function decideSuggest(input: {
  job: { closedAt: string | null; archivedAt: string | null };
  mine: "pending" | "accepted" | "declined" | null;   // my latest _by row for (candidate, job)
  pendingSuggestionId: number | null;                 // pending row by anyone
  cap: { ok: true } | { ok: false; retryAt: string };
}): { kind: "create" } | { kind: "join"; suggestionId: number } | { kind: "refuse"; error: SuggestError; retryAt?: string };
export function decideAccept(input: { status: "pending" | "accepted" | "declined"; applicationExists: boolean }):
  "insert_backlog" | "mark_only" | "already_decided";
export function digestDue(lastSentAt: string | null, now: number): boolean;  // ≥ 1 h
```

```typescript
// src/core/candidate-public.ts
export type ProfileKey = { slug: string } | { id: number };
export type DirectoryVisibility = "recruiters" | "public";
export function allowlistedProfile(key: ProfileKey, visibilities: readonly [DirectoryVisibility, ...DirectoryVisibility[]]):
  Promise<PublicProfile | null>;
export function publicProfile(slug: string): Promise<PublicProfile | null>; // allowlistedProfile({ slug }, ["public"])
// src/core/candidate-directory.ts
export type DirectoryQuery = { terms: ValidTerm[]; textGiven: boolean; location: string | null;
  workModel: string | null; level: string | null; page: number };
export function parseDirectoryQuery(params: Record<string, string | string[] | undefined>): DirectoryQuery;
export function searchDirectory(q: DirectoryQuery): Promise<{ cards: DirectoryCard[]; total: number }>;
export function recordDirectorySearch(recruiterUserId: number, nowIso: string): Promise<{ ok: boolean }>;
```

Errors are values, never thrown, except unexpected I/O errors, which reach the
existing error boundary. Every action returns `{ ok, error? }` mapped to
dictionary keys (`recruiterAccess.error.*`).

### Data Models

Tables (schema `production`; full column list and FK actions in ADR-011):

| Table | Key columns | Constraints |
|---|---|---|
| `recruiter_grant` | `candidate_id`, `recruiter_user_id`, `recruiter_email`, `status`, `invite_id`, `created_by`, `created_at`, `expires_at`, `expiry_tz`, `ended_at`, `revoked_by`, `last_accessed_at` | unique partial `(candidate_id, recruiter_user_id) WHERE status='active'`; CHECK status list; CHECK active ⇒ recruiter not null; index `(recruiter_user_id, status)`, `(candidate_id, status)` |
| `recruiter_invite` | `candidate_id`, `email`, `token_hash`, `status`, `expires_at`, `access_expires_at`, `expiry_tz`, `created_by`, `cancelled_by`, `accepted_user_id`, `created_at`, `decided_at`, `delivery_failed_at`, `dismissed_at` | unique `token_hash`; unique partial `(candidate_id, email) WHERE status='pending'`; CHECK status list; index `(email, status)` |
| `recruiter_access_event` | `candidate_id`, `grant_id`, `invite_id`, `suggestion_id`, `recruiter_email`, `kind`, `actor`, `actor_user_id`, `actor_name`, `detail`, `at` | CHECK kind list; CHECK actor list; index `(candidate_id, at desc, id desc)` |
| `recruiter_suggestion` | `candidate_id`, `job_id`, `status`, `application_id`, `created_at`, `decided_at` | unique partial `(candidate_id, job_id) WHERE status='pending'`; CHECK status list |
| `recruiter_suggestion_by` | `suggestion_id`, `recruiter_user_id`, `recruiter_email`, `grant_id`, `note`, `created_at`, `notified_at` | unique `(suggestion_id, recruiter_user_id)`; CHECK `char_length(note) <= 500`; index `(recruiter_user_id, created_at)` |
| `recruiter_directory_query` | `recruiter_user_id`, `at` | index `(recruiter_user_id, at)` |

History `kind` values: `invite_sent`, `invite_resent`, `invite_cancelled`,
`invite_expired`, `invite_accepted`, `grant_created`, `end_date_changed`,
`access_revoked`, `access_expired`, `access_ended_account_removed`,
`suggestion_received`, `suggestion_accepted`, `suggestion_declined`. `actor`:
`candidate`, `admin` (with `actor_name`), `recruiter`, `system`. `detail`
carries the new end date (ISO or `none`) or the job title and company snapshot.
No code path updates or deletes history rows; only the candidate CASCADE
removes them.

Changes to existing code (no schema change): `candidate.visibility` and
`public_cv` keep their values (no data migration); `setVisibilityAction` keeps
`public_cv` for `recruiters` and `public` (ADR-014).

Constants (pure modules, not environment): invitation 7 days; end date within
5 years; caps 10/24 h and 20 pending per candidate, 20 suggestions per
recruiter per candidate per 24 h; note 500; directory 60 searches per
recruiter per 10 min, 20 cards per page; recruiter list 25 per page;
suggestions and history 20 per page; `last_accessed_at` throttle 1 min;
digest interval 1 h; dead invitation purge 30 days.

### API Endpoints

| Method | Path / action | Auth | Description | Responses |
|---|---|---|---|---|
| GET | `/account` (section) | `requirePage("account:read")`; section only when `candidateScope(session)` | Access list, invitations, history (`?historyPage=`), form; read-only when borrowed | 200 |
| SA | `grantRecruiterAccessAction` (email, endDate?, tz?) | `guard("access:manage", own)` | Grant or invite | `{ok, kind:'grant'\|'invite'}`; `blank_email`, `invalid_email`, `self`, `already_active`, `already_invited`, `cap_reached`+`retryAt`, `too_many_pending`, `date_*` |
| SA | `revokeRecruiterAccessAction` (grantId) | same | Revoke | ok; `already_ended`; `not_found` (other candidate's id) |
| SA | `setGrantEndDateAction` (grantId, endDate\|'', tz) | same | Set/move/clear | ok; `already_ended`; `date_*`; no-op when unchanged |
| SA | `resendInviteAction` / `cancelInviteAction` / `dismissInviteAction` (inviteId) | same | Invitation management | ok; `already_active`; `cap_reached`; `not_found`; cancel twice → ok without change |
| GET | `/suggestions` | `requireOwnCandidatePage("candidate:read")` | Pending and decided suggestions (`?page=`) | 200 |
| SA | `acceptSuggestionAction` / `declineSuggestionAction` (id) | `guard("suggestion:decide", own)` | Decide | ok; `already_decided`; `not_found` |
| GET | `/signup/invite?token=` | public (inventory) | Invitation landing (ADR-018) | 200 neutral or state page |
| SA | `startInvitedSignup` (token) | public (inventory) | Cookie + redirect `/signup?role=recruiter` | 303; neutral page if invalid |
| SA | `acceptInviteAction` (token) | `guard("account:read")` + recruiter role | Accept while signed in | 303 `/recruiter/<id>`; state messages |
| GET | `/recruiter` | `requirePage("job:read")` | Granted candidates (`?page=`), `?invite=` landing notice | 200 |
| GET | `/recruiter/[candidateId]` | membership → `requirePage("candidate:read")` | Funnel, CV link, my suggestions, suggest | 200; 404 |
| GET | `/recruiter/[candidateId]/cv` | same | Current CV text | 200; 404; "No CV yet" |
| GET | `/recruiter/[candidateId]/cv/download` | same (route handler) | `text/markdown` attachment `<candidate-name>-cv.md` | 200; 404 |
| GET | `/recruiter/[candidateId]/suggest?q=` | membership → `requirePage("suggestion:create")` | Catalog search (open jobs by title/company, 20) + note | 200; 404 |
| SA | `suggestJobAction` (candidateId selector, jobId, note) | `guard("suggestion:create", {candidate})` after membership | Suggest | ok; `note_too_long`; `job_closed`; `already_suggested`; `already_decided_by_candidate`; `cap_reached`+`retryAt`; 404 |
| SA | `createRecruiterJobAction` (+ `suggestFor`, `note`) | `guard("job:write")` + `suggestion:create` when `suggestFor` | Register job and suggest | 303 `/recruiter/<id>`; form errors as today |
| GET | `/recruiter/directory` | `requirePage("candidate:discover")` | Search | 200; rate-limited notice |
| GET | `/recruiter/directory/[id]` | same | Allowlisted profile | 200; 404 |
| GET | `/recruiter/directory/[id]/image/[kind]` | same (route handler) | Photo/cover under opt-in | 200; 404 |
| SA | `adminRevokeGrantAction` (grantId), `adminCancelInviteAction` (inviteId) | `guard("user:manage")` (denied when borrowed) | Admin end | ok; `already_ended` |
| SA | `setVisibilityAction` | `guardOwnCandidate("candidate:write")` + `access:manage` | Visibility + CV consent | ok; validation error |

No CLI verb is added; `src/cli.ts` keeps no grant or invite command (US-024.AC-3).

## Integration Points

- **Resend** through the existing `Mailer` (`configuredMailer`), sender
  `RESEND_FROM`; `fileMailer` under `JHO_MAIL_SINK` in `local`/`e2e`; withheld
  in Preview. Emails are sent after commit; failure records
  `auth_event(kind='email_send_failed', detail='<message kind>')` and, for
  invitations, `recruiter_invite.delivery_failed_at`. No retry in the request.
- Links use `resolvePublicOrigin` (G17): `/signup/invite?token=…`,
  `/recruiter/<id>`, `/suggestions`.
- **#464 sign-up** (`src/contexts/auth/app/signup.ts`): a post-commit hook
  calls `completeInvitesForAccount`; the sign-in path (`app/login/actions.ts`,
  OIDC callback) calls it for recruiter accounts.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|---|---|---|---|
| `src/core/db/schema.ts`, `drizzle/postgres/` | modified | Six tables + data copy; additive, medium (data step) | Upgrade test; `select-production.ts`; L2 review |
| `recruiter_candidate` | deprecated | Frozen, no reads or writes | Follow-up issue to drop with human review |
| `linkedCandidatesFor`, `drizzle-directory.ts`, `ports.ts` | modified | Access predicate, `revokeGrant`, removal ends grants; high (authorization) | L2 review; `tests/auth-session.test.ts`, `cov-auth-directory.test.ts` |
| `policy.ts`, `types.ts` | modified | Four actions; high | `tests/auth-policy.test.ts` table |
| `src/core/candidate-public.ts` | modified | Refactor into builder; high (G21) | `tests/public-profile.test.ts` stays green |
| `app/candidate/actions.ts`, `page.tsx` | modified | CV consent for Recruiters; borrowed refusal | Tests + hints |
| `app/account/*`, `app/suggestions/*`, `app/nav-links.tsx` | new/modified | Candidate UI | i18n, 375 px, `data-testid`, E2E |
| `app/recruiter/*`, `app/jobs/new/*` | new/modified | Recruiter UI, suggest | E2E per role |
| `app/signup/invite/*`, `signup.ts`, `app/login/actions.ts` | new/modified | Public entry and hooks; depends on login-social task_03 | Inventory, L2 |
| `app/admin/*` | modified | Revoke/cancel UI | E2E admin |
| `sweep.ts`, cron composition, `retention.ts` | modified | Hourly job, purge | Sweep tests |
| `proxy.ts`, `tests/architecture.test.ts` (`PAGE_POLICY`, `PUBLIC_ROUTES`), `tests/support/entry-inventory.ts`, `tests/e2e/routes.mjs`, `config/e2e-spec-map.json` | modified | New routes and entries | Same commit as each route |
| `tests/e2e/setup.mjs` | modified | Fixtures write grants; new candidate/recruiter fixtures | — |
| `docs/product/vision.md`, `personas.md`, `docs/qa/personas.md`, QA journeys, `docs/engineering/rules/security.md` (G25 wording on grants) | modified | Recruiter as invited user; directory | Rule 23 |

## Testing Approach

- **Unit (Vitest):** pure modules (`recruiter-access.ts`,
  `recruiter-suggestion.ts`, `parseDirectoryQuery`, `toAllowlistedProfile`,
  `recruiter-emails.ts`, policy table) with explicit `now`; no I/O.
- **Integration (Vitest + Docker Postgres per test, `useTestDb`):** stores and
  services with real migrations, real transactions and concurrent calls
  (`Promise.all`) for caps, double submits and racing endings; `fileMailer`
  or a recording `Mailer` fake; Server Actions with the session helper used
  by `tests/entry-denial.test.ts`; sweep with the real lease store.
- **E2E (`tests/e2e/run-isolated.mjs`, Playwright):** per-role scenarios
  (G16) under `tests/e2e/ui/recruiter-access.mjs` and
  `tests/e2e/ui/recruiter-directory.mjs`; invitation sign-up through the fake
  OIDC issuer and `JHO_MAIL_SINK` from #464; fixtures in `setup.mjs`
  (candidate with grants, recruiter with account, Recruiters/Public/Private
  profiles); 375 px and axe on new pages; spec map areas `recruiter-access`,
  `recruiter-invite`, `recruiter-suggestions`, `recruiter-directory`.
- No real Resend call in any suite; time moves through the injected clock.

## Development Sequencing

### Build Order

1. Schema, migration with copy, upgrade test — no dependencies.
2. Pure domain (access rules, suggestion rules, directory query), policy
   actions, email builders + i18n keys — no dependencies.
3. Access store, `linkedCandidatesFor` switch, admin reads and `revokeGrant`,
   account removal — depends on 1, 2.
4. Access service + candidate UI in `/account`, caps, history, admin revoke
   and cancel UI, sweep job and purge — depends on 3.
5. Invitation landing, cookie, completion hooks — depends on 4 and on
   `login-social` task_03 merged into `dev`.
6. Recruiter workspace (list, title, CV, last access) and suggestions (create,
   decide, digest, nav count, `/jobs/new`) — depends on 4.
7. Allowlist builder refactor, directory, rate limit, visibility hints and CV
   consent — depends on 1, 2.
8. Docs (vision, personas, QA personas and journeys) — with 5 and 6.

### Technical Dependencies

- `login-social` task_03 (`/signup`, `signup.ts`) merged into `dev` before step 5.
- `JHO_MAIL_SINK` and the fake OIDC issuer from #464 for E2E.
- No new environment variable or external service.

## Monitoring and Observability

- History rows are the product audit; `auth_event` keeps operator signals:
  `email_send_failed` (detail: `recruiter_invite`, `access_granted`,
  `end_date_changed`, `access_ended`, `suggestions`), `denied` from guards,
  `invite_mismatch` (an invitation link completed with another email; no
  candidate data in detail).
- The sweep run row (`sweep_run`) records the job via the slice metrics; the
  job returns counts (`expired`, `invitesExpired`, `digests`) in the slice
  `detail`.
- Sentry captures unexpected errors; tokens and emails are scrubbed as today.

## Technical Considerations

### Key Decisions

- **Additive tables and a frozen legacy table** — automatic promotion; cost:
  a follow-up drop (ADR-011).
- **Single access predicate at session load** — one place to test; cost: one
  query per resolve, as today (ADR-012).
- **`candidate:discover` + shared allowlist builder** — G21 by construction
  (ADR-013); **CV consent for Recruiters** — owner decision (ADR-014).
- **Accept through the candidate's transaction** — rule 2 (ADR-015).
- **Hourly sweep job and browser time zone** — no new cron entry (ADR-016).
- **Limits in Postgres under an advisory lock** — correct across instances
  (ADR-017).
- **Invitation under `/signup`, completion by proven email** — reuses #464;
  cost: dependency on its task_03 (ADR-018).

### Known Risks

- **Authorization regression** in `linkedCandidatesFor` or the policy: high
  impact, mitigated by L2 review, policy table tests and per-role E2E.
- **Allowlist drift** in the refactor: mitigated by keeping
  `tests/public-profile.test.ts` unchanged and adding equality tests between
  `/p/` and directory output.
- **Selector id in recruiter actions (G40 reading):** the id only picks within
  `session.linkedCandidateIds`; registered in the entry inventory and covered
  by `tests/entry-denial.test.ts`. A reviewer must confirm it does not loosen
  G40; if they disagree, the alternative is a per-candidate route-bound
  action closure, with no data change.
- **Deploy window** between migration and code (ADR-011 risk): low.
- **Login-social schedule:** step 5 blocks until its task_03 lands.

## User Story Mapping

| Story | Components |
|---|---|
| US-001 | Access rules (`normalizeEmail`, `grantTarget`), access service `grant`, `/account` section, recruiter emails, history |
| US-002 | Access service invite path, invitation email, pending cap, `delivery_failed_at` |
| US-003 | `/signup/invite`, `startInvitedSignup`, `acceptInviteAction`, `completeInvitesForAccount`, #464 hooks |
| US-004 | `inviteCompletion` (`mismatch`), landing notice, `auth_event(invite_mismatch)` |
| US-005 | Access granted email, `/recruiter` list with since/until, pagination by name |
| US-006 | `parseEndDate`, `setGrantEndDateAction`, `access_expires_at` copy on accept, end-date email |
| US-007 | Candidate list read (`grantDisplay`, last access), invitations list |
| US-008 | `revokeRecruiterAccessAction`, conditional UPDATE, access ended email, predicate |
| US-009 | Resend (supersede + new token), cancel, dismiss |
| US-010 | Predicate on `expires_at`, sweep job step 1 |
| US-011 | New grant row after an ended one; partial unique |
| US-012 | `recruiter_access_event`, paginated history |
| US-013 | `/recruiter` list (name, since, until, pending count), `generateMetadata` title |
| US-014 | `/recruiter/[id]` funnel read-only, `last_accessed_at` |
| US-015 | `/recruiter/[id]/cv`, download route |
| US-016 | Predicate, membership 404, policy write denials, job page without candidate data |
| US-017 | Access ended email (cause), recruiter suggestions filtered by current grant |
| US-018 | Suggest page and action, `/jobs/new` `suggestFor`, `decideSuggest`, cap, digest |
| US-019 | Recruiter's suggestion list |
| US-020 | `/suggestions`, nav count, digest email |
| US-021 | `decideAccept`, accept transaction, funnel marker |
| US-022 | Decline action |
| US-023 | Admin grants/invitations view, `adminRevokeGrantAction`, `adminCancelInviteAction` |
| US-024 | `access:manage` denial when borrowed, no admin grant UI, no CLI verb |
| US-025 | `capDecision`, advisory lock, history-based count |
| US-026 | `candidate:discover`, `/recruiter/directory`, `parseDirectoryQuery`, `searchDirectory`, rate limit |
| US-027 | `/recruiter/directory/[id]`, `allowlistedProfile`, `/p/` link, grant link |
| US-028 | Visibility hints, `setVisibilityAction` (`access:manage`, CV consent) |
| US-029 | `candidate:discover` denials, `proxy.ts` |
| US-030 | Visibility filter constant, 404 for Private |
| US-031 | `toAllowlistedProfile` shared, `publicCvMarkdown` |

## Architecture Decision Records

- [ADR-001: Candidates grant access by the recruiter's email, with an invitation for people without an account](adrs/adr-001.md) — consent tied to a verified address.
- [ADR-002: Access scope is read-only funnel, current CV and job suggestions](adrs/adr-002.md) — what recruiters see.
- [ADR-003: Job suggestions are pending proposals that only the candidate turns into funnel entries](adrs/adr-003.md) — rule 2.
- [ADR-004: Access has no end by default, takes an optional end date, and ends immediately on revocation or expiry](adrs/adr-004.md) — forward-only.
- [ADR-005: Both parties are notified by email, and the candidate sees who has access and the full history](adrs/adr-005.md) — LGPD art. 18 VII.
- [ADR-006: Invitation links last 7 days and are single use; caps on invitations and suggestions](adrs/adr-006.md) — values.
- [ADR-007: Re-granting needs new consent, and revoking a pending invitation kills it](adrs/adr-007.md) — lifecycle.
- [ADR-008: Administrators can revoke access but never grant it](adrs/adr-008.md) — G25.
- [ADR-009: Recruiters become users invited by candidates, working from the existing candidate list](adrs/adr-009.md) — positioning.
- [ADR-010: Keep the three profile visibilities and add a profile directory for recruiters](adrs/adr-010.md) — directory.
- [ADR-011: Data model — additive grant, invitation, history and suggestion tables; `recruiter_candidate` frozen](adrs/adr-011.md) — tables and copy.
- [ADR-012: Access is cut only where the session loads it; ending a grant is an UPDATE](adrs/adr-012.md) — predicate.
- [ADR-013: Profile directory behind `candidate:discover`, built on a shared allowlist builder](adrs/adr-013.md) — directory design.
- [ADR-014: The CV second consent applies to Recruiters and Public](adrs/adr-014.md) — owner decision.
- [ADR-015: Suggestions become funnel entries only through the candidate's accept, in one transaction](adrs/adr-015.md) — accept.
- [ADR-016: Expiry, grouped notices and purge run in the hourly sweep; the end date is local to the stored time zone](adrs/adr-016.md) — jobs and zone.
- [ADR-017: Limits counted in the new tables under a per-candidate advisory lock; directory search limited per recruiter](adrs/adr-017.md) — limits.
- [ADR-018: Invitations open under `/signup` and complete when a recruiter account proves the invited email](adrs/adr-018.md) — invitation flow.
