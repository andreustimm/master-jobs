# Test Specification: Social Sign-In, Self-Sign-Up and Account Emails

Canonical test contract for #464. Companion to `_techspec.md`.
Derived from `_user_stories.md` (behavior) and `_techspec.md` (components).

## Strategy

- Frameworks and harnesses: Vitest for unit and integration; integration uses
  the Docker Postgres per-test database (`useTestDb`/`releaseTestDb`) with real
  migrations. Fakes only at I/O boundaries: injected `fetch` for OIDC and
  Resend, injected clock, `fileMailer` sink. E2E through
  `tests/e2e/run-isolated.mjs` with the fake OIDC issuer
  (`tests/e2e/fake-oidc.mjs`, ADR-010) and `JHO_MAIL_SINK`.
- Execution: `pnpm exec vitest run <files>` locally; full suite and E2E in CI.
  E2E scenarios per role (G16) under `tests/e2e/ui/`, registered in
  `config/e2e-spec-map.json` (areas `social-sign-in`, `sign-up`,
  `account-methods`, `legal`).
- Conventions: table-driven `it.each` for pure rules; one behavior per case;
  test names cite the case ID (`UT-012 …`).

## Coverage Matrix

| Source | Behavior | Unit | Integration | E2E |
|---|---|---|---|---|
| US-001 | Sign in with linked identity | UT-020, UT-021 | IT-001 | E2E-001 |
| US-001.AC-3 | Provider email changed still signs in | UT-022 | IT-002 | — |
| US-001.AC-4 | Last use updated | — | IT-003 | E2E-020 |
| US-001.EC-1 | Disabled account refused neutrally | UT-023 | IT-004 | E2E-002 |
| US-001.EC-2 | Cancel at provider | UT-040 | — | E2E-003 |
| US-001.EC-3 | Provider error | UT-041, UT-042 | — | E2E-004 |
| US-001.EC-4 | Expired/tampered flow | UT-030, UT-031, UT-032 | IT-005 | E2E-005 |
| US-001.EC-5 | Two tabs finish | UT-033 | IT-006 | — |
| US-001.EC-6 | Already signed in | — | — | E2E-006 |
| US-001.EC-7 | Throttling shared | — | IT-007 | — |
| US-001.EC-8 | Deep link next | UT-034, UT-035 | — | E2E-007 |
| US-002 | Auto-link by verified email | UT-024 | IT-008 | E2E-008 |
| US-002.AC-2 | Linked shown + audit | — | IT-009 | E2E-020 |
| US-002.AC-3 | Email normalization | UT-025 | — | — |
| US-002.EC-1 | Different identity already linked | UT-026 | IT-010 | E2E-009 |
| US-002.EC-2 | Disabled match | UT-023 | IT-004 | — |
| US-002.EC-3/EC-4 | Unverified or missing email | UT-027, UT-028 | — | E2E-010 |
| US-002.EC-5 | Concurrent auto-link | — | IT-011 | — |
| US-002.EC-6 | Password kept | — | IT-012 | — |
| US-003 | Unverified guidance | UT-027 | IT-013 | E2E-010 |
| US-003.AC-2 | No enumeration | UT-029 | IT-013 | — |
| US-003.EC-1 | Google unverified | UT-028 | — | — |
| US-003.EC-2 | Retry no side effect | — | IT-013 | — |
| US-004 | Candidate social sign-up | UT-060 | IT-020 | E2E-011 |
| US-004.AC-3 | Own data only | — | IT-021 | E2E-011 |
| US-004.AC-4 | Audit + terms recorded | — | IT-022 | — |
| US-004.AC-5 | Welcome email | UT-080 | IT-023 | E2E-011 |
| US-004.EC-1 | Abandon creates nothing | — | IT-024 | — |
| US-004.EC-2 | Pending expired | UT-061 | IT-025 | — |
| US-004.EC-3 | Double submit | — | IT-026 | — |
| US-004.EC-4 | Email taken meanwhile | UT-062 | IT-027 | — |
| US-004.EC-5 | Direct open without pending | — | — | E2E-012 |
| US-004.EC-6 | Forged role | UT-063 | IT-028 | — |
| US-004.EC-7 | PDF errors | UT-064 | IT-029 | E2E-013 |
| US-004.EC-8 | CV too short | UT-065 | — | — |
| US-004.EC-9 | Terms not accepted | UT-066 | — | E2E-013 |
| US-004.EC-10 | PDF and text both | UT-067 | — | — |
| US-005 | Recruiter sign-up | UT-060 | IT-030 | E2E-014 |
| US-005.AC-2 | No candidate data | — | IT-030 | E2E-014 |
| US-005.EC-1 | Same expiry/double/tamper | UT-061, UT-063 | IT-026 | — |
| US-005.EC-2 | Role change by admin only | — | IT-031 | — |
| US-006 | Unverified refused | UT-027 | IT-013 | — |
| US-006.AC-2 | Per-IP cap | UT-068 | IT-032 | E2E-015 |
| US-006.EC-1 | Concurrent last slot | — | IT-033 | — |
| US-006.EC-2 | Admin accounts not counted | UT-069 | IT-034 | — |
| US-006.EC-3 | Sign-in never creates | — | IT-035 | — |
| US-006.EC-4 | Pending does not consume slot | UT-069 | IT-034 | — |
| US-006.EC-5 | Invalid env → default 3 | UT-001 | — | — |
| US-007 | Connect provider | — | IT-040 | E2E-016 |
| US-007.AC-2 | Unverified LinkedIn manual link | UT-036 | IT-041 | — |
| US-007.EC-1 | Identity on another account | UT-037 | IT-042 | — |
| US-007.EC-2 | Already linked | — | IT-043 | — |
| US-007.EC-3 | Cancel | UT-040 | — | E2E-016 |
| US-007.EC-4 | Session expired during consent | UT-038 | IT-044 | — |
| US-007.EC-5 | Impersonation blocked | UT-090 | IT-045 | — |
| US-008 | Disconnect | — | IT-046 | E2E-017 |
| US-008.AC-2 | Last method refused | UT-091 | IT-047 | E2E-017 |
| US-008.EC-1 | Concurrent disconnects | — | IT-048 | — |
| US-008.EC-2 | Relink warning | — | — | E2E-017 |
| US-008.EC-3 | Impersonation blocked | UT-090 | IT-045 | — |
| US-009 | Set password | UT-092 | IT-049 | E2E-018 |
| US-009.EC-1 | Short password | UT-092 | — | — |
| US-009.EC-2 | Sessions kept/ended | — | IT-050 | — |
| US-010 | Methods list | UT-093 | IT-051 | E2E-020 |
| US-010.AC-2 | No profile data shown | UT-094 | — | — |
| US-010.EC-1 | Never used | UT-093 | — | — |
| US-010.EC-2 | Not available here | UT-093 | — | — |
| US-011 | Admin sees methods | — | IT-052 | E2E-019 |
| US-011.AC-2 | Admin unlink audited | — | IT-053 | E2E-019 |
| US-011.AC-3 | Admin cannot link | UT-095 | IT-054 | — |
| US-011.EC-1 | Admin last method refused | UT-091 | IT-047 | — |
| US-011.EC-2 | Admin in impersonation | UT-090 | IT-045 | — |
| US-011.EC-3 | Non-admin refused | UT-095 | IT-054 | — |
| US-012 | Only candidate/recruiter offered | UT-063 | — | E2E-011 |
| US-012.AC-2 | Admin signs in socially | — | IT-055 | E2E-021 |
| US-012.EC-1 | Forged admin | UT-063 | IT-028 | — |
| US-012.EC-2 | First access stays CLI | — | — | E2E-022 |
| US-013 | CLI list | — | IT-060 | — |
| US-013.AC-2 | CLI unlink | — | IT-061 | — |
| US-013.EC-1 | Unknown email | — | IT-062 | — |
| US-013.EC-2 | Not linked | — | IT-063 | — |
| US-013.EC-3 | CLI never links | — | IT-064 | — |
| US-014 | Buttons where configured | UT-002, UT-003 | — | E2E-023 |
| US-014.AC-2 | Preview hides | UT-004 | — | — |
| US-014.AC-3 | Start by URL unavailable | UT-004 | IT-065 | — |
| US-014.EC-1 | Only Google | UT-003 | — | — |
| US-014.EC-2 | None configured | UT-002 | — | E2E-022 |
| US-014.EC-3 | First-access screen | — | — | E2E-022 |
| US-015 | Recruiter empty state | — | — | E2E-014 |
| US-015.AC-2 | 375 px + dictionary | — | — | E2E-024 |
| US-015.EC-1 | With access later | — | IT-066 | — |
| US-016 | Manual sign-up start | UT-070 | IT-070 | E2E-025 |
| US-016.AC-2 | Expiry stated | — | — | E2E-025 |
| US-016.EC-1 | Invalid email | UT-071 | — | — |
| US-016.EC-2 | Weak password | UT-072 | — | — |
| US-016.EC-3 | Email already registered | UT-073 | IT-071 | E2E-026 |
| US-016.EC-4 | Pending replaced | — | IT-072 | — |
| US-016.EC-5 | Double submit | — | IT-073 | — |
| US-016.EC-6 | 5 codes/hour | UT-074 | IT-074 | — |
| US-016.EC-7 | Cap at confirmation | — | IT-032 | — |
| US-016.EC-8 | CV problems before code | UT-064 | IT-029 | — |
| US-016.EC-9 | Sink outside production | UT-005, UT-081 | IT-075 | E2E-025 |
| US-017 | Confirm code | UT-075 | IT-076 | E2E-025 |
| US-017.AC-2 | Password works + auto-link eligible | — | IT-077 | E2E-027 |
| US-017.EC-1 | Wrong code / lock after 5 | UT-076 | IT-078 | E2E-028 |
| US-017.EC-2 | Expired code | UT-077 | IT-079 | — |
| US-017.EC-3 | Code normalization | UT-078 | — | — |
| US-017.EC-4 | Double confirm | — | IT-080 | — |
| US-017.EC-5 | Pending > 24 h | UT-061 | IT-081 | — |
| US-017.EC-6 | "I already have a code" | — | — | E2E-029 |
| US-017.EC-7 | Email taken by Google meanwhile | UT-062 | IT-082 | — |
| US-017.EC-8 | Resend cooldown | UT-079 | IT-083 | E2E-028 |
| US-018 | Welcome email | UT-080 | IT-023 | E2E-011 |
| US-018.AC-2 | Not for admin-created | — | IT-084 | — |
| US-018.EC-1 | Delivery failure | — | IT-085 | — |
| US-018.EC-2 | At most one welcome | — | IT-026 | — |
| US-019 | Link/unlink notice | UT-082 | IT-086 | — |
| US-019.AC-2 | No foreign data | UT-083 | — | — |
| US-019.EC-1 | Failure recorded | — | IT-085 | — |
| US-019.EC-2 | Order | — | IT-087 | — |
| US-020 | Recovery email | UT-084 | IT-088 | E2E-030 |
| US-020.AC-2 | Ends sessions | — | IT-089 | — |
| US-020.AC-3 | Social-only first password | — | IT-090 | — |
| US-020.EC-1 | Disabled → no email | — | IT-091 | — |
| US-020.EC-2 | Rate limit | — | IT-092 | — |
| US-020.EC-3 | Reused/expired link | — | IT-093 | — |
| US-020.EC-4 | Never logged in deployments | UT-085 | — | — |
| US-021 | Legal pages | UT-100 | — | E2E-031 |
| US-021.AC-2 | Required | UT-066 | — | E2E-013 |
| US-021.AC-3 | Versions recorded | — | IT-022 | E2E-020 |
| US-021.EC-1 | New version for new sign-ups | UT-101 | IT-094 | — |
| US-021.EC-2 | 375 px, zoom | — | — | E2E-024 |
| OIDC config (TechSpec) | parse + gates | UT-001–UT-006 | — | — |
| OidcProvider adapters | start/complete, validation | UT-040–UT-047 | IT-100 | — |
| Flow cookie | encrypt/decrypt/consume | UT-030–UT-033 | IT-005 | — |
| Identity resolution | decisions | UT-020–UT-029, UT-036–UT-038 | — | — |
| Signup rules | codes, expiry, cap math | UT-060–UT-079 | — | — |
| Account emails | builders | UT-080–UT-085 | — | — |
| fileMailer | sink gating | UT-005, UT-081 | IT-075 | — |
| Migration | additive upgrade | — | IT-101, IT-102 | — |
| Purge | expired rows | — | IT-103 | — |
| OIDC routes | GET start/callback shapes | UT-034, UT-035 | IT-065, IT-104 | E2E-001–E2E-010 |
| Override gate | production ignores issuer override | UT-006 | IT-105 | — |

## Unit Tests

### OIDC config (TechSpec: Component Overview — OIDC config)

- **UT-001** (boundary): `parseSignupLimits(env)` — `JHO_SIGNUP_MAX_PER_IP_HOUR` = `"7"` → 7; `""`, `"0"`, `"-1"`, `"abc"`, missing → 3.
- **UT-002** (happy): `parseOidcConfig(env)` — no Google/LinkedIn vars → both `unconfigured`; `availableProviders()` returns `[]`.
- **UT-003** (happy): `parseOidcConfig` — only `GOOGLE_OIDC_CLIENT_ID`+`SECRET` → google `configured`, linkedin `unconfigured`.
- **UT-004** (state): `socialAvailable(env)` — `JHO_ENV=preview` with credentials → `false`; `JHO_ENV=production` with `JHO_PUBLIC_URL` → `true`; local process → `true`.
- **UT-005** (state): `mailSinkDir(env)` — `JHO_MAIL_SINK=/tmp/x` with `JHO_ENV=production` → `null`; with `JHO_ENV=local` → `/tmp/x`.
- **UT-006** (error): `issuerFor("google", env)` — `JHO_OIDC_ISSUER_GOOGLE=http://127.0.0.1:9` with `JHO_ENV=production` → `https://accounts.google.com`; error messages name variables, never values.

### Identity resolution (TechSpec: Core Interfaces — resolveIdentity)

- **UT-020** (happy): linked user enabled → `{kind:"signin", userId}`.
- **UT-021** (happy): linked user with emailVerified=false → still `signin` (email not consulted).
- **UT-022** (happy): linked user whose provider email differs from account email → `signin`.
- **UT-023** (error): linked or email-matched user disabled → `{kind:"refused"}`.
- **UT-024** (happy): no linked user, verified email matches enabled user without provider → `auto_link`.
- **UT-025** (boundary): `normalizeEmail(" Ana@X.com ")` equals `normalizeEmail("ana@x.com")`.
- **UT-026** (error): email user already has that provider (`hasProvider=true`) → `{kind:"conflict"}`.
- **UT-027** (error): unknown identity, `emailVerified=false` → `{kind:"unverified", provider:"linkedin"}`.
- **UT-028** (error): unknown identity, `email=null` → `unverified`.
- **UT-029** (state): unverified decision identical whether `emailUser` exists or not.
- **UT-036** (happy): `decideManualLink({identity unverified, sessionUser})` → `link`.
- **UT-037** (error): manual link where identity linked to another user → `{kind:"taken"}`.
- **UT-038** (error): manual link with no session → `{kind:"session_required"}`.

### Flow cookie (TechSpec: Component Overview — Flow state cookie)

- **UT-030** (happy): `sealFlow(state, key)` then `openFlow(sealed, key, now)` returns the same state.
- **UT-031** (error): tampered ciphertext → `null`.
- **UT-032** (boundary): `openFlow` at `createdAt + 10 min + 1 s` → `null`; at `+ 9 min 59 s` → state.
- **UT-033** (state): `state` param mismatch between cookie and callback → `expired`.
- **UT-034** (boundary): `safeNext("/jobs/12")` → `/jobs/12`; `"https://evil.test"`, `"//evil.test"`, `"/\\evil"` → `null`.
- **UT-035** (happy): `landingFor(roles, next)` — recruiter with `next=null` → `/jobs`; candidate → `/`; candidate with `next=/jobs/1` → `/jobs/1`.

### OidcProvider adapters (TechSpec: Integration Points)

- **UT-040** (error): `complete` with callback `?error=access_denied` → `{ok:false, reason:"cancelled"}`.
- **UT-041** (error): token endpoint returns 500 (injected fetch) → `provider_error`.
- **UT-042** (error): discovery fetch rejects → `provider_error`.
- **UT-043** (error): ID token signed by a key not in JWKS → `invalid_response`.
- **UT-044** (error): ID token with wrong `aud` → `invalid_response`.
- **UT-045** (error): ID token with wrong `nonce` → `invalid_response`.
- **UT-046** (happy): Google claims `{sub:"1", email:"a@x.com", email_verified:true}` → `VerifiedIdentity{provider:"google", subject:"1", emailVerified:true}`.
- **UT-047** (boundary): LinkedIn claims without `email_verified` → `emailVerified:false`; `start` requests scopes exactly `openid profile email` (no `w_member_social`).

### Signup rules (TechSpec: Component Overview — Signup rules)

- **UT-060** (happy): `validateRole("candidate")`, `("recruiter")` → ok.
- **UT-061** (boundary): pending `expires_at` = created + 24 h (manual) / + 15 min (social); `isExpired` true at expiry + 1 ms.
- **UT-062** (state): completion when `emailTaken=true` → `email_taken`.
- **UT-063** (error): `validateRole("admin")`, `""`, `"Candidate "` → `role_invalid`.
- **UT-064** (error): `readCvPdf` mapping — file > 10 MB → `pdf_too_large`; non-PDF header → `pdf_not_pdf`; no text → `pdf_no_text`.
- **UT-065** (boundary): pasted CV of 99 chars → `cv_too_short`; 100 → ok.
- **UT-066** (error): `termsAccepted=false` → `terms_required`.
- **UT-067** (error): PDF and pasted text both present → `cv_both`.
- **UT-068** (boundary): `capReached(completedLastHour=2, max=3)` → false; `3, 3` → true.
- **UT-069** (state): cap counts only `completed` self sign-ups; pending rows and admin-created users excluded.
- **UT-070** (happy): manual start input valid → pending payload with password hashed, code 6 digits, `code_hash` ≠ code.
- **UT-071** (error): email `"ana@"` → `invalid_email`.
- **UT-072** (boundary): password 11 chars → `weak_password`; 12 → ok.
- **UT-073** (state): start with registered email → outcome `account_exists_notice` (no code), screen result identical to normal start.
- **UT-074** (boundary): 5 codes sent in last hour → `too_many_codes`; 4 → allowed.
- **UT-075** (happy): `verifyCode("123456", hash)` → true.
- **UT-076** (boundary): 4th wrong attempt → `wrong_code` with `attemptsLeft=1`; 5th → `code_locked`.
- **UT-077** (boundary): code sent at T, verify at T+15 min+1 s → `expired`.
- **UT-078** (boundary): `normalizeCode(" 123-456 ")` → `"123456"`; `"12345"` → wrong.
- **UT-079** (boundary): resend at sent+59 s → refused with seconds left 1; at +60 s → allowed.

### Account emails (TechSpec: Component Overview — Account emails)

- **UT-080** (happy): `welcomeEmail({locale:"pt-BR", role:"candidate", signInUrl})` → subject/text from `email.welcome.*`, contains sign-in URL; `"en"` → English.
- **UT-081** (state): `configuredMailer` with `JHO_MAIL_SINK` set and `JHO_ENV=local` → `fileMailer`; production → Resend/withheld.
- **UT-082** (happy): `providerNoticeEmail({provider:"google", action:"linked", by:"admin", at})` names provider, date, "an administrator".
- **UT-083** (state): notice builder output contains no provider email, token, name or photo fields.
- **UT-084** (happy): `recoveryEmail({locale:"en", url})` → English text with the URL.
- **UT-085** (state): code and recovery URL are not passed to any logger in non-local environments (logger spy).

### Account methods (TechSpec: Component Overview — Identity store / Web)

- **UT-090** (error): `can(impersonatedSession, "account:manage-methods")` → false.
- **UT-091** (state): `canDisconnect({hasPassword:false, providers:["linkedin"]}, "linkedin")` → false; with password → true.
- **UT-092** (boundary): `setOwnPassword` 11 chars → `weak_password`; 12 → ok.
- **UT-093** (state): `methodsView` — linked never used → `lastUsed:"never"`; provider unavailable in env → `availableHere:false`.
- **UT-094** (state): `methodsView` exposes only provider, dates, origin, availability.
- **UT-095** (error): policy — admin has no `identity:link-for-other`; non-admin lacks `admin:users`.

### Legal documents (TechSpec: Component Overview — Legal documents)

- **UT-100** (happy): `readLegal("terms","pt-BR")` returns title, body and `version` from front matter.
- **UT-101** (state): `currentLegalVersions()` reflects the front matter after a change.

## Integration Tests

### Identity linking and sign-in (Postgres)

- **IT-001**: identity store + service — seed user with Google identity; `signInWithIdentity` → session row created; `oidc_signin` event.
- **IT-002**: same identity with changed email → same user session.
- **IT-003**: sign-in updates `auth_identity.last_used_at`.
- **IT-004**: disabled user (linked or email match) → no session, no link, `oidc_failed` detail `refused`.
- **IT-005**: callback with expired flow cookie → no session; event `oidc_failed` `expired`.
- **IT-006**: two callbacks with the same flow state → first signs in, second `expired`.
- **IT-007**: repeated failed social attempts share the `login_failed` window with password attempts.
- **IT-008**: user without Google + verified matching email → identity row `origin=automatic`, session.
- **IT-009**: auto-link writes `identity_linked` (`automatic`) and a notice email to the sink.
- **IT-010**: user with Google subject A, sign-in with subject B same email → no change; `conflict`.
- **IT-011**: two concurrent auto-links for the same user/provider → one identity row; unique constraint respected, other request signs in through it or fails `expired`.
- **IT-012**: after auto-link, password login still works.
- **IT-013**: unverified identity, with and without matching account → identical response; no rows created; retry idempotent.

### Sign-up (Postgres)

- **IT-020**: pending social + `completeSocialSignup(candidate, name, headline, cvText, terms)` → one `auth_user` (candidate, `email_verified_at`, `signup_origin=google`), one identity, one new candidate with `candidate_document` current CV, session.
- **IT-021**: new candidate account cannot read another candidate's jobs/documents (`candidateScope`).
- **IT-022**: completion writes `signup_completed` event and terms/privacy versions on the user.
- **IT-023**: completion sends one welcome email (sink) in the chosen locale.
- **IT-024**: pending created and abandoned → no `auth_user`; purge removes it after expiry.
- **IT-025**: completing a social pending after 15 min → `expired`, nothing created.
- **IT-026**: two concurrent completions of the same pending → one user, one welcome email, second returns signed-in redirect.
- **IT-027**: account created for the email between consent and completion → `email_taken`; no duplicate.
- **IT-028**: completion with role `admin` → `role_invalid`; nothing created.
- **IT-029**: CV PDF errors surface before any pending row or code is created.
- **IT-030**: recruiter completion → recruiter role, zero `recruiter_candidate` rows, no candidate created.
- **IT-031**: role change of a self-created recruiter only through admin `role_changed`.
- **IT-032**: 3 completed sign-ups from the same `ip_hmac` in 60 min → 4th `ip_cap`, `signup_ip_capped` event; different IP succeeds.
- **IT-033**: two concurrent completions from one IP with 2 used → exactly one succeeds.
- **IT-034**: admin-created users and pending rows do not count toward the cap.
- **IT-035**: password and magic-link sign-in with an unknown email create no user.

### Account methods (Postgres)

- **IT-040**: signed-in user, link flow intent=link → identity `origin=manual`; account email unchanged.
- **IT-041**: manual link with unverified LinkedIn identity succeeds.
- **IT-042**: link identity already owned by another user → `taken`; both accounts unchanged.
- **IT-043**: link a provider already linked → refused, no change.
- **IT-044**: callback with intent=link and no session → `session_required`, nothing linked.
- **IT-045**: impersonation session calling disconnect/link/admin actions → denied.
- **IT-046**: disconnect with password set → identity removed; `identity_unlinked` `self`; notice email.
- **IT-047**: disconnect last method (user or admin) → `last_method`, no change.
- **IT-048**: two concurrent disconnects leaving zero methods → one succeeds, one `last_method`.
- **IT-049**: social-only user sets 12-char password → password login works.
- **IT-050**: first password set keeps other sessions; changing an existing password ends others (existing behavior).
- **IT-051**: `listMethods(userId)` returns password flag, providers with dates and origin.
- **IT-052**: admin users listing includes providers and password flag per account.
- **IT-053**: admin disconnect → event names admin; notice email says "an administrator".
- **IT-054**: no service path links a provider for another user; non-admin calling admin disconnect → denied.
- **IT-055**: admin account auto-links and signs in socially, keeps roles.

### CLI

- **IT-060**: `jho auth methods ana@x.com` prints password flag and providers with dates.
- **IT-061**: `jho auth unlink ana@x.com google` removes identity; event `cli`; notice email.
- **IT-062**: unknown email → "no such account", exit code 1.
- **IT-063**: provider not linked → "nothing to unlink", exit code 1.
- **IT-064**: no `jho auth link` command exists (`--help` lists none).

### Availability and routes

- **IT-065**: `GET /login/oauth/google` with `JHO_ENV=preview` → 303 `/login?error=unavailable`; unknown provider → 404.
- **IT-066**: recruiter with a `recruiter_candidate` row does not land on the empty state.
- **IT-104**: callback route handles RSC fetch and returns 303 like `app/login/callback/route.ts`.
- **IT-105**: with `JHO_ENV=production`, `JHO_OIDC_ISSUER_GOOGLE` is ignored by the composed provider.

### Manual sign-up and code

- **IT-070**: `startManualSignup` valid → pending row (`kind=manual`), code email in sink, no user.
- **IT-071**: registered email → same screen result; sink has "account exists" email without code; no pending code.
- **IT-072**: second start for same email → previous code invalid, new code valid, data replaced.
- **IT-073**: double submit → one pending, one email.
- **IT-074**: 6th code request within an hour → `too_many_codes`; no email.
- **IT-075**: `JHO_MAIL_SINK` set with `JHO_ENV=production` → sink not used (withheld/Resend).
- **IT-076**: correct code → user (verified email, password, role), candidate with CV, session, welcome.
- **IT-077**: confirmed manual account later auto-linked by Google with same verified email.
- **IT-078**: 5 wrong codes → locked; correct code afterwards → `code_locked`.
- **IT-079**: correct code after 15 min → `expired`.
- **IT-080**: concurrent correct confirmations → one user.
- **IT-081**: pending older than 24 h → `expired`; purged.
- **IT-082**: Google sign-up creates account for the email before code confirmation → confirmation `email_taken`.
- **IT-083**: resend within 60 s refused; after 60 s new code sent.

### Emails

- **IT-084**: admin-created account → no welcome email.
- **IT-085**: mailer failure on welcome/notice → action still completes; `email_send_failed` recorded.
- **IT-086**: link and unlink each send one notice email naming provider and actor.
- **IT-087**: link then unlink → two emails in that order.
- **IT-088**: recovery request for existing enabled account → localized email with single-use link.
- **IT-089**: recovery completion ends other sessions.
- **IT-090**: social-only account uses recovery to set first password.
- **IT-091**: disabled account → neutral response, no email.
- **IT-092**: recovery over limit → neutral response, no email.
- **IT-093**: reused or expired recovery link → existing invalid message.

### Legal, migration and maintenance

- **IT-094**: user who accepted v1 keeps v1 after documents change; new sign-up records v2.
- **IT-100**: Google adapter against the fake issuer (in-process) completes and validates a real signed ID token.
- **IT-101**: upgrade test — database at the previous migration with users migrates; new tables/columns exist; existing users unaffected.
- **IT-102**: FK delete intent — deleting a user cascades identities and nulls `auth_signup.user_id`.
- **IT-103**: maintenance purge removes pending > 24 h and completed > 30 days.

## End-to-End Tests

### Social sign-in (US-001 – US-003)

- **E2E-001**: `/login` → "Continue with Google" (fake issuer, linked candidate) → cockpit; recruiter account → `/jobs`.
- **E2E-002**: disabled account via Google → `/login` neutral message.
- **E2E-003**: cancel at fake consent → `/login` "Sign-in cancelled".
- **E2E-004**: fake issuer returns error → "Could not reach Google".
- **E2E-005**: replay old callback URL → "This sign-in attempt expired".
- **E2E-006**: signed-in user opens `/login` → redirected to landing.
- **E2E-007**: open `/jobs/<id>` logged out → sign in with Google → lands on `/jobs/<id>`.
- **E2E-008**: admin-created account without password, verified Google email match → signed in; account shows Google "linked automatically".
- **E2E-009**: account linked to Google subject A, sign in with subject B same email → conflict message.
- **E2E-010**: LinkedIn without verified email → guidance message; no account.

### Sign-up (US-004 – US-006, US-012, US-014 – US-017, US-021)

- **E2E-011**: Google (unknown verified email) → `/signup` shows email read-only → Candidate, name, headline, PDF CV, accept terms → cockpit → welcome email in sink; only own data visible; no "Administrator" option.
- **E2E-012**: open `/signup` without pending social → manual form shown (no read-only email).
- **E2E-013**: submit without terms / with a non-PDF file → messages; fields kept; no account.
- **E2E-014**: Recruiter sign-up via LinkedIn (verified) → recruiter empty state explaining access.
- **E2E-015**: 4th sign-up from the same IP within the hour → limit message.
- **E2E-016**: account page → "Connect Google" → linked; cancel path returns with no change.
- **E2E-017**: disconnect Google with password → gone + relink warning; social-only account disconnect last → refused message.
- **E2E-018**: social-only account sets password → can sign in with email and password.
- **E2E-019**: admin users list shows providers; admin disconnects one → owner sees it gone.
- **E2E-020**: account page lists methods with dates/origin and accepted terms versions.
- **E2E-021**: admin account signs in with Google and keeps admin menu.
- **E2E-022**: empty installation → first-access screen without social buttons; no providers configured → `/login` unchanged.
- **E2E-023**: only Google configured → only Google button on `/login` and `/signup`.
- **E2E-024**: `/signup`, `/signup/verify`, recruiter empty state, `/terms`, `/privacy` at 375 px pass overflow and axe sweeps.
- **E2E-025**: manual sign-up (candidate, PDF) → "Check your email" with 15-minute notice → code from sink → cockpit → welcome email.
- **E2E-026**: manual sign-up with a registered email → same "Check your email" step; sink has "account exists" email.
- **E2E-027**: confirmed manual account signs in with password.
- **E2E-028**: wrong code shows attempts left; resend button disabled with countdown, enabled after 60 s (clock-controlled build flag only in E2E).
- **E2E-029**: leave after code sent, return to `/signup` → "I already have a code" → confirm.
- **E2E-030**: forgot password → neutral confirmation → link from sink → new password → sign in.
- **E2E-031**: `/terms` and `/privacy` render in Portuguese and English without a session.
