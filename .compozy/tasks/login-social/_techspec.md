# TechSpec: Social Sign-In, Self-Sign-Up and Account Emails

Issue #464. Implements [`_prd.md`](_prd.md) and every story in
[`_user_stories.md`](_user_stories.md) (US-001 – US-021). Test contract:
[`_tests.md`](_tests.md).

## Executive Summary

Social sign-in uses OpenID Connect through `oauth4webapi` behind a new
`OidcProvider` port with Google and LinkedIn adapters (ADR-008). A provider
identity is keyed by `(provider, subject)` in a new `auth_identity` table and
links to an existing account automatically when the provider verifies the same
email (ADR-001). Self-sign-up — social or manual — goes through one pending
record in `auth_signup` that holds the chosen role, name, headline and CV text
until the final step, then creates the account and, for candidates, the
candidate profile in a single transaction that reuses `insertOwnCandidate`
(ADR-007, ADR-009). Manual sign-ups are confirmed by a 6-digit code sent over
the existing Resend `Mailer`, which gains localized builders for every account
email and a file sink for tests (ADR-006, ADR-011).

Everything new lives inside the `auth` bounded context (`src/contexts/auth/`)
and `app/` pages; the domain stays pure (rule 4, `tests/architecture.test.ts`),
and all schema changes are additive, so migration ships through the automatic
path. The main trade-offs: one new dependency (`oauth4webapi`), CV text of
unconfirmed sign-ups held up to 24 h, manual sign-up unavailable in Preview, and
a fake OIDC issuer to maintain for E2E (ADR-010).

## System Architecture

### Component Overview

| Component | Location | Responsibility |
|---|---|---|
| OIDC config | `src/contexts/auth/domain/oidc-config.ts` | Pure parse of provider env vars into `unconfigured | invalid | configured`, environment gate (ADR-005), issuer override gate (ADR-010). |
| `OidcProvider` adapters | `src/contexts/auth/infra/oidc/{client,google,linkedin}.ts` | Authorization URL (PKCE, state, nonce), code exchange, ID-token validation, claim mapping to `VerifiedIdentity`. |
| Flow state cookie | `src/contexts/auth/infra/flow-cookie.ts` | Encrypt/decrypt the 10-minute OIDC flow state (AES-GCM with `JHO_SESSION_SECRET`-derived key). |
| Identity resolution | `src/contexts/auth/domain/identity-resolution.ts` | Pure decision: sign in, auto-link, conflict, start sign-up, or unverified guidance (US-001–US-003). |
| Identity store | `src/contexts/auth/infra/drizzle-identities.ts` | `auth_identity` CRUD, last-method check under row lock, last-use touch. |
| Sign-up service | `src/contexts/auth/app/signup.ts` | Start/complete manual and social sign-ups, code issue/verify/resend, per-IP cap, account+candidate creation. |
| Sign-up store | `src/contexts/auth/infra/drizzle-signups.ts` | `auth_signup` persistence, advisory lock per IP, transactional completion with `insertOwnCandidate`. |
| Signup rules | `src/contexts/auth/domain/signup-rules.ts` | Pure: code generation input → hash, attempt/expiry/resend math, role validation, cap math. |
| Account emails | `src/contexts/auth/app/account-emails.ts` | Localized `{subject, text}` builders: code, welcome, account-exists, provider-linked/unlinked, recovery. |
| Mailers | `src/contexts/auth/infra/resend-mailer.ts` (+ `fileMailer`) | Existing Resend/console/withheld plus the file sink (ADR-011). |
| Legal documents | `content/legal/*.md`, `src/core/legal.ts` | Read versioned Markdown; expose current versions. |
| Web | `app/login/*`, `app/signup/*`, `app/account/*`, `app/terms`, `app/privacy`, `app/admin/users/*` | Pages, Server Actions and OIDC Route Handlers. |
| CLI | `src/cli.ts` (`jho auth methods`, `jho auth unlink`) | List and unlink providers. |
| Fake issuer | `tests/e2e/fake-oidc.mjs` | Loopback OIDC issuer for E2E. |

### Data flow

1. **Sign-in / link:** `GET /login/oauth/[provider]?intent=…&next=…` → config check → `OidcProvider.authorizationUrl` → flow cookie → provider → `GET …/callback` → decrypt+consume cookie → `OidcProvider.complete` → `VerifiedIdentity` → `resolveIdentity` decision → session (`completeLogin`) or link or pending social sign-up → `redirect303`.
2. **Social sign-up:** pending `auth_signup(kind=social)` + random token cookie → `/signup` shows verified email → Server Action `completeSocialSignup` → cap check + transaction (user, identity, candidate+CV) → session → welcome email.
3. **Manual sign-up:** `/signup` Server Action `startManualSignup` → validation (password, CV via `readCvPdf`/`parseOwnProfile`) → pending row + code hash → code email → `/signup/verify` → `confirmManualSignup` → cap + transaction → session → welcome.
4. **Account emails:** service → `account-emails` builder (locale) → `Mailer.send` → on failure `auth_event(email_send_failed)`.

External systems: Google OIDC, LinkedIn OIDC, Resend API.

## Implementation Design

### Core Interfaces

```typescript
// src/contexts/auth/ports.ts (additions)
export type OidcProviderId = "google" | "linkedin";
export type VerifiedIdentity = {
  provider: OidcProviderId;
  subject: string;
  email: string | null;
  emailVerified: boolean;
};
export type OidcStart = { url: string; flow: OidcFlowState };
export type OidcFlowState = {
  provider: OidcProviderId; state: string; nonce: string;
  codeVerifier: string; intent: "signin" | "link"; next: string | null; createdAt: string;
};
export interface OidcProvider {
  readonly id: OidcProviderId;
  start(input: { redirectUri: string; intent: OidcFlowState["intent"]; next: string | null }): Promise<OidcStart>;
  complete(input: { redirectUri: string; callbackUrl: URL; flow: OidcFlowState }): Promise<
    { ok: true; identity: VerifiedIdentity } | { ok: false; reason: "cancelled" | "provider_error" | "invalid_response" }
  >;
}
```

```typescript
// src/contexts/auth/domain/identity-resolution.ts
export type IdentityDecision =
  | { kind: "signin"; userId: number }
  | { kind: "auto_link"; userId: number }
  | { kind: "conflict"; provider: OidcProviderId }          // US-002.EC-1
  | { kind: "refused" }                                       // disabled account (neutral)
  | { kind: "signup"; email: string }                         // verified, no account
  | { kind: "unverified"; provider: OidcProviderId };         // US-003
export function resolveIdentity(input: {
  identity: VerifiedIdentity;
  linkedUser: { id: number; disabled: boolean } | null;
  emailUser: { id: number; disabled: boolean; hasProvider: boolean } | null;
}): IdentityDecision;
```

```typescript
// src/contexts/auth/app/signup.ts (public API)
export type SignupError =
  | "invalid_email" | "weak_password" | "role_invalid" | "terms_required"
  | "cv_too_short" | "cv_both" | "pdf_missing" | "pdf_too_large" | "pdf_not_pdf" | "pdf_no_text"
  | "too_many_codes" | "ip_cap" | "expired" | "wrong_code" | "code_locked" | "unavailable_here"
  | "email_taken";
export type SignupResult<T> = { ok: true; value: T } | { ok: false; error: SignupError; attemptsLeft?: number };
```

Errors are values, never thrown, except unexpected I/O errors, which bubble to the existing error boundary.

### Data Models

New and changed tables (schema `production`, Drizzle in `src/core/db/schema.ts`, migration in `drizzle/postgres/`), per ADR-009:

| Table | Column | Type | Notes |
|---|---|---|---|
| `auth_identity` | `id` | identity PK | |
| | `user_id` | int → `auth_user.id` | **ON DELETE CASCADE** |
| | `provider` | text | `google` \| `linkedin` (check) |
| | `subject` | text | |
| | `email_at_link` | text null | |
| | `origin` | text | `automatic` \| `manual` |
| | `linked_at`, `last_used_at` | text (ISO) | `last_used_at` null until used |
| | unique | `(provider, subject)`, `(user_id, provider)` | |
| `auth_signup` | `id` | identity PK | |
| | `kind` | text | `manual` \| `social` |
| | `token_hash` | text unique | SHA-256 of cookie/session token |
| | `email`, `locale` | text | email normalized |
| | `role` | text null | `candidate` \| `recruiter` |
| | `name`, `headline` | text null | |
| | `cv_text` | text null | |
| | `password_hash` | text null | scrypt, manual only |
| | `provider`, `subject` | text null | social only |
| | `code_hash` | text null | HMAC of code |
| | `code_attempts` | int default 0 | |
| | `code_sent_at` | text null | |
| | `ip_hmac` | text | HMAC-SHA256(ip, `JHO_SIGNUP_IP_SECRET`) |
| | `terms_version`, `privacy_version` | text null | |
| | `created_at`, `expires_at`, `completed_at` | text (ISO) | |
| | `user_id` | int null → `auth_user.id` | **ON DELETE SET NULL** |
| | index | `(ip_hmac, completed_at)`, `(email, completed_at)` | |
| `auth_user` (+) | `email_verified_at`, `terms_version`, `privacy_version`, `terms_accepted_at`, `signup_origin`, `locale` | text null | additive |

`codes sent per email per hour` is counted from `auth_event(kind='signup_code_sent', email)` in the last hour, like the existing reset limit.

Configuration (all read by pure parsers, documented in `docs/engineering/deploy.md`):

| Variable | Default | Purpose |
|---|---|---|
| `GOOGLE_OIDC_CLIENT_ID`, `GOOGLE_OIDC_CLIENT_SECRET` | — | Google sign-in |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | — | Shared with publishing app; sign-in scopes only |
| `JHO_SIGNUP_MAX_PER_IP_HOUR` | `3` | Per-IP cap; invalid → 3 |
| `JHO_SIGNUP_IP_SECRET` | — (required in production) | IP HMAC key |
| `JHO_MAIL_SINK` | — | File sink dir, only with `JHO_ENV` `local` or `e2e`, outside Vercel |
| `JHO_OIDC_ISSUER_GOOGLE`, `JHO_OIDC_ISSUER_LINKEDIN` | — | Fake issuer, only with `JHO_ENV` `local` or `e2e`, outside Vercel |

### API Endpoints

| Method | Path | Auth | Description | Responses |
|---|---|---|---|---|
| GET | `/login/oauth/[provider]` | public (`intent=link` requires session) | Start OIDC; query `intent=signin\|link`, `next` (relative) | 303 to provider; 303 `/login?error=unavailable` when not configured/environment; 404 unknown provider |
| GET | `/login/oauth/[provider]/callback` | public | Complete OIDC | 303 landing/`next`; 303 `/signup` (pending social); 303 `/login?error=cancelled\|provider\|expired\|conflict\|unverified\|refused`; 303 `/account?linked=…` or `/account?error=taken` for link |
| GET | `/signup` | public | Sign-up screen (manual form; social mode when pending cookie present) | 200 |
| POST (Server Action) | `startManualSignup` | public (registered in `UNGUARDED_BY_DESIGN`) | Validate, create pending, send code | redirect `/signup/verify`; field errors |
| POST (Server Action) | `completeSocialSignup` | public, pending cookie required | Create account+profile | redirect landing; errors |
| GET | `/signup/verify` | public | Code step | 200 |
| POST (Server Action) | `confirmSignupCode`, `resendSignupCode` | public | Verify / resend | redirect landing; `wrong_code` with attempts left; `expired`; `code_locked`; `too_many_codes` |
| GET | `/terms`, `/privacy` | public | Legal pages | 200 |
| POST (Server Action) | `disconnectProvider` | session, `guard("account:manage")` | Unlink own provider | ok / `last_method` |
| POST (Server Action) | `setOwnPassword` | session | First password for social-only account | ok / `weak_password` |
| POST (Server Action) | `adminDisconnectProvider` | `guard("admin:users")` | Unlink another account's provider | ok / `last_method` |
| CLI | `jho auth methods <email>` | operator | List methods | table; exit 1 unknown email |
| CLI | `jho auth unlink <email> <provider>` | operator | Unlink | ✓; exit 1 not linked/last method |

## Integration Points

- **Google OIDC** (`https://accounts.google.com`): scopes `openid email`; client secret auth (`client_secret_post`); fails closed on discovery/JWKS/token errors with `provider_error`; no retries inside a request.
- **LinkedIn OIDC** (`https://www.linkedin.com/oauth`): scopes `openid profile email`; LinkedIn may omit `email_verified` → treated as unverified.
- **Resend** (existing): `contato@mastertimm.com.br`; failures recorded, not retried in-request.
- Redirect URIs derive from `resolvePublicOrigin` (G17): `https://jobs.mastertimm.com.br/login/oauth/<provider>/callback` and `http://127.0.0.1:3000/...` registered at each provider.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|---|---|---|---|
| `src/core/db/schema.ts`, `drizzle/postgres/` | modified | Two new tables, six nullable columns; additive, low risk | Generate migration, upgrade test, register in `select-production.ts` |
| `src/contexts/auth/` | modified | New port, adapters, services; medium risk (authentication) | L2 review |
| `app/login/page.tsx` | modified | Provider buttons, "Create account" link, error messages | i18n, E2E |
| `app/signup/*`, `app/terms`, `app/privacy` | new | Public pages | Register in proxy, architecture tests, routes.mjs, spec map |
| `app/account/*` | modified | Methods list, connect/disconnect, set password, terms versions | E2E per role |
| `app/admin/users/*` | modified | Methods column, admin disconnect | E2E admin |
| `src/contexts/auth/app/password-reset.ts` | modified | Recovery email via localized builder | Keep G17/G18 tests green |
| `src/cli.ts`, `docs/cli.md` | modified | `methods`, `unlink` | CLI tests |
| `proxy.ts` | modified | Public `/signup`, `/terms`, `/privacy` | Tests |
| `AGENTS.md` rule 1, `docs/engineering/rules/security.md` G01, `docs/linkedin-policy.md` | modified | LinkedIn OIDC for authentication allowed (ADR-003) | Same commit (G62) |
| `docs/product/vision.md`, personas, first-access docs | modified | Self-sign-up exists | Docs |
| `package.json` | modified | `+oauth4webapi` | Renovate tracks it |
| `tests/outbound-transport-boundary.test.ts` | modified | Allow OIDC adapter files | Test |
| `content/legal/` | new | Terms and privacy drafts (owner reviews) | Owner review before production |

## Testing Approach

- **Unit (Vitest):** pure domain (`identity-resolution`, `signup-rules`, `oidc-config`, `account-emails`, flow cookie crypto) with no I/O; adapters with injected `fetch` (pattern of `tests/resend-mailer.test.ts`).
- **Integration (Vitest + Docker Postgres per test, `useTestDb`):** stores and services with real Drizzle and migrations: linking, sign-up completion transaction, per-IP cap under concurrency, last-method protection under concurrency, purge, migration upgrade test.
- **E2E (`run-isolated`):** fake OIDC issuer on loopback (ADR-010), `JHO_MAIL_SINK` to read codes, per-role scenarios (G16), 375 px and axe sweeps for new pages; database guard unchanged.
- No real provider or Resend calls in any suite.

## Development Sequencing

### Build Order

1. Schema and migration (`auth_identity`, `auth_signup`, `auth_user` columns) + upgrade test — no dependencies.
2. Pure domain: `oidc-config`, `identity-resolution`, `signup-rules` — no dependencies.
3. `account-emails` builders + i18n keys + `fileMailer` — depends on 2.
4. Stores: `drizzle-identities`, `drizzle-signups` — depends on 1.
5. `OidcProvider` adapters with `oauth4webapi` + flow cookie — depends on 2.
6. Services: identity linking/sign-in, sign-up (manual + social), disconnect, set password — depends on 3, 4, 5.
7. Web: `/login` buttons, OIDC routes, `/signup`, `/signup/verify`, `/account` methods, admin users column, `/terms`, `/privacy` + legal content — depends on 6.
8. CLI `methods`/`unlink` — depends on 6.
9. Fake issuer + E2E — depends on 7.
10. Docs and rule amendments (rule 1/G01/linkedin-policy, vision, deploy env vars, cli.md) — with 7.

### Technical Dependencies

- Owner: register OAuth clients (Google Cloud console; LinkedIn developer app "Sign In with LinkedIn using OpenID Connect") with the production and local redirect URIs; set `GOOGLE_OIDC_*`, `LINKEDIN_*`, `JHO_SIGNUP_IP_SECRET` in Vercel; review `content/legal/*`. Until then the buttons stay hidden (ADR-005) and manual sign-up works.

## Monitoring and Observability

- `auth_event` kinds: `oidc_signin`, `identity_linked` (detail `automatic|manual`), `identity_unlinked` (detail `self|admin|cli`), `signup_started`, `signup_code_sent`, `signup_code_failed`, `signup_completed` (detail path/provider/role), `signup_ip_capped`, `signup_expired`, `oidc_failed` (detail reason), `email_send_failed` (detail message kind).
- Sentry (server) captures unexpected errors; IP and email are scrubbed as today.
- The admin status view (`jho auth status`) shows which providers are configured and whether `JHO_SIGNUP_IP_SECRET` is set.

## Technical Considerations

### Key Decisions

- **oauth4webapi behind a port** — full ID-token validation without a framework; trade-off: one dependency (ADR-008).
- **Postgres-backed pending sign-ups and per-IP cap** — survives serverless instances; trade-off: CV text stored up to 24 h (ADR-009).
- **Fake issuer for E2E** — real flow tested; trade-off: test server to maintain (ADR-010).
- **Localized builders over existing Mailer + file sink** — trade-off: manual sign-up unavailable in Preview (ADR-011).
- **GET start route, `/signup`, Markdown legal docs** — keeps CSP, clear URLs, versioned terms (ADR-012).

### Known Risks

- Provider configuration mistakes (redirect URI mismatch): low; mitigated by status view and local testing.
- Account takeover via admin-typed email typo: mitigated by verified-email requirement, link notice email and audit (ADR-001).
- Email deliverability (SPF/DKIM for `mastertimm.com.br`): already in place for recovery; monitored through `email_send_failed`.
- Concurrency on cap and last-method: handled by advisory lock and row locks; covered by integration tests.

## Architecture Decision Records

- [ADR-001: Identify social logins by provider subject; link existing accounts by verified email or from the account page](adrs/adr-001.md) — identity key and linking rules.
- [ADR-002: Open self-sign-up, choosing candidate or recruiter](adrs/adr-002.md) — open sign-up, per-IP cap.
- [ADR-003: LinkedIn and Google only for authentication, keeping provider subject and verified email only](adrs/adr-003.md) — data minimization, rule 1 amendment.
- [ADR-004: Sign-in methods coexist and the last method cannot be removed](adrs/adr-004.md) — coexistence and last-method protection.
- [ADR-005: Social sign-in available in production and local only](adrs/adr-005.md) — environments.
- [ADR-006: Manual sign-up confirmed by an emailed code, and a transactional email channel](adrs/adr-006.md) — code rules (channel already exists).
- [ADR-007: One sign-up screen creates the account and the candidate profile](adrs/adr-007.md) — Tecla pattern.
- [ADR-008: OpenID Connect through oauth4webapi behind a provider port](adrs/adr-008.md) — OIDC library and port.
- [ADR-009: Data model — identities, pending sign-ups and terms acceptance in Postgres](adrs/adr-009.md) — tables, per-IP cap, IP HMAC.
- [ADR-010: Fake OIDC issuer for end-to-end tests, accepted only outside production](adrs/adr-010.md) — E2E strategy.
- [ADR-011: Localized account emails over the existing Mailer, with a file sink outside production](adrs/adr-011.md) — emails.
- [ADR-012: Routes, flow state and legal documents](adrs/adr-012.md) — URLs, flow cookie, legal docs.
