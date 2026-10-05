# Social Sign-In, Self-Sign-Up and Account Emails

Issue: #464. Related: #465 (candidate grants recruiter access), #237 (email
delivery, absorbed by this scope). Reference screen chosen by the owner:
https://app.tecla.io/t/signup.

## Overview

Today a person enters master-jobs with an email and password or with a magic
link that only the CLI can issue; only an administrator can create an account,
the account email is never verified, and the product cannot send email — not
even the password-recovery link. Invited people often have no password, so
their first access needs the owner to run a command, and nobody can join on
their own.

This feature lets people sign in with Google or LinkedIn and lets new people
join by themselves. A single sign-up screen, modeled on Tecla's, offers
"Continue with Google", "Continue with LinkedIn" and an email-and-password
form; in the same screen the person chooses Candidate or Recruiter and, as a
candidate, sends the CV, so sign-up also completes the first onboarding step.
Manual sign-ups are confirmed by a 6-digit code sent by email; every new
account receives a welcome email. An existing account is recognized by the
provider identity already linked to it or, on first use, by the email the
provider verifies, and is linked automatically. Provider data is used only to
authenticate.

The product gains a transactional email channel for the sign-up code, the
welcome message, notices when a provider is linked or unlinked, and the
password-recovery link.

It serves the owner (one-click access and visibility over access), invited
members (no password needed), new candidates (ready to receive scored jobs
right after sign-up) and new recruiters (an account ready for candidates to
grant access), while keeping the administrator in control of roles, provider
links and disabled accounts.

## Goals

- A person with an account signs in with Google or LinkedIn, without a password
  or a CLI-issued magic link.
- The first social sign-in of an existing account links it automatically when
  the email is verified and matches; later sign-ins rely on the provider
  identity.
- A person without an account signs up on one screen — with Google, LinkedIn
  or email and password — choosing Candidate or Recruiter; candidates leave
  sign-up with a profile and a CV.
- Every self-created account has a verified email: from the provider, or from
  the emailed code.
- The administrator role is never self-assigned, and a new account never
  reaches anyone else's data.
- Every person sees and manages how their account can be accessed, is notified
  by email of provider changes, can recover the password by email, and can
  never remove their last way in.
- Administrators and the CLI see every account's methods and can remove a
  provider link.
- LinkedIn usage stays within rule 1: official OpenID Connect, authentication
  only, no profile data stored.
- People accept published Terms of Use and Privacy Policy before an account is
  created.

## User Stories

- US-001 – US-003: social sign-in for existing accounts.
- US-004 – US-006: self-sign-up as candidate or recruiter on the single screen
  (social path) and its refusals.
- US-007 – US-010: account page — connect, disconnect, add password, method
  list.
- US-011 – US-013: administration in the web and the CLI.
- US-014: social availability per environment and configuration.
- US-015: recruiter empty state.
- US-016 – US-017: manual sign-up confirmed by emailed code.
- US-018 – US-020: account emails — welcome, provider notices, password
  recovery.
- US-021: Terms of Use and Privacy Policy.

[Full user stories](_user_stories.md)

## Core Features

### F1. Social sign-in

- "Continue with Google" and "Continue with LinkedIn" on the sign-in page and
  on the sign-up screen.
- Completing the provider consent resolves the account:
  1. Provider identity already linked → sign in that account.
  2. Unknown identity, verified email, an enabled account with that email and
     no identity from that provider → link and sign in (automatic link).
  3. Unknown identity, verified email, no account with that email → sign-up
     screen (F2), social path.
  4. Unknown identity without a verified email → guidance message; nothing
     created or linked.
- After sign-in the person lands where their role lands today, or on the
  requested deep link when their role may see it. Social sessions behave like
  password sessions.

### F2. Single sign-up screen (Tecla pattern)

- One screen, brand panel beside the form on wide screens, stacked on narrow
  ones. Entry points: social buttons and the manual form.
- Fields: role (Candidate / Recruiter); name; for Candidate, headline and CV
  (PDF upload or pasted text, with today's onboarding limits and checks);
  email and password on the manual path only (social path shows the verified
  email, read-only); acceptance of Terms of Use and Privacy Policy; language
  of the emails follows the screen language.
- Social path: one submit creates the account (and the candidate profile with
  the CV as first version) and signs in.
- Manual path: submit sends the code (F3); confirming the code creates the
  account and profile and signs in.
- Nothing is created until the final step succeeds; validation problems keep
  the other fields filled.
- Per-IP cap on self-created accounts per rolling hour (configurable).

### F3. Email confirmation code (manual sign-up)

- A 6-digit code is emailed; a "Check your email" step accepts it and offers
  resend after a cooldown.
- The account exists only after the code is confirmed.

### F4. Account emails

- Sign-up code; welcome after any self-sign-up; notice on every provider link
  or unlink; password-recovery link; "account already exists" notice when
  someone tries to sign up with a registered email.

### F5. Account page: sign-in methods

- Lists Password (set or not), Google, LinkedIn, each linked provider with
  link date, last use and link origin (automatic/manual), and the accepted
  Terms/Privacy versions.
- Connect a provider; disconnect a provider (never the last way in); set a
  password on a social-only account.

### F6. Administration (web) and CLI

- Users list shows linked providers and whether a password is set.
- Administrators disconnect another account's provider under last-method
  protection and never connect one on someone's behalf.
- `jho auth` lists methods and disconnects a provider with the same rules;
  linking stays browser-only.

### F7. Recruiter empty state

- A recruiter with no candidates sees why nothing appears and that candidates
  grant access (#465).

### F8. Terms of Use and Privacy Policy pages

- Public pages, readable without an account, in Portuguese and English,
  linked from the sign-up screen.
- Content: an original draft following the standard structure of terms of
  use and of a privacy policy under Brazil's LGPD (purpose, data collected —
  including the provider identifier and verified email —, legal basis,
  retention, sharing, data-subject rights, contact `contato@mastertimm.com.br`).
  Text is never copied from another site; the owner reviews it before
  production.

### Interactions

- F1 sends unknown verified identities to F2; F2's manual path goes through
  F3; account creation in F2/F3 triggers the welcome in F4.
- F5 and F6 share one set of disconnect rules, one audit trail, and trigger
  F4's provider notices.
- Accounts created through F3 have a verified email and therefore take part in
  F1's automatic link.

## Business Rules

### Identity and linking

- A social identity is the pair (provider, provider subject), unique across
  the product; an account holds at most one identity per provider.
- Sign-in by a linked identity never consults the email.
- Automatic linking requires: email asserted as verified by the provider;
  normalized email equal to an account's normalized email; account enabled;
  account without an identity from that provider.
- An account already linked to a different identity of that provider refuses
  the sign-in with "This account is linked to another Google/LinkedIn
  account"; nothing changes.
- Manual linking requires an active, non-impersonated session and accepts any
  provider email, verified or not.
- Linking never changes the account email, roles, candidate or password.

### Self-sign-up

- Roles offered: Candidate, Recruiter. Administrator is never offered; forged
  requests for it are refused.
- Candidate accounts receive a new candidate of their own with the submitted
  name, headline and CV as first version (G25); never an existing candidate.
- Recruiter accounts start with zero linked candidates (G25, #465).
- Terms of Use and Privacy Policy acceptance is mandatory; the accepted
  versions and time are recorded.
- Cap: at most **3** self-created accounts (social and confirmed manual
  together) per client IP address in any rolling 60-minute window. The value
  is configurable through an environment variable (default 3). Reaching it
  refuses further sign-ups from that address with a message; sign-in is
  unaffected; administrator-created accounts do not count.
- A social sign-up between consent and final submit is valid for **15
  minutes** and can be completed once.
- Password sign-in and magic link never create accounts.

### Manual sign-up and code

- Password minimum: 12 characters (existing rule).
- Code: 6 digits; valid **15 minutes**; **5** wrong attempts invalidate it;
  resend after **60 seconds**; at most **5** codes per email per hour; a new
  code invalidates the previous one.
- A pending sign-up not confirmed within **24 hours** is discarded.
- A pending sign-up cannot sign in, holds no session and never takes part in
  automatic linking.
- Signing up with an email that already has an account shows the same "check
  your email" step; the email received offers sign-in and recovery and
  contains no code. No screen reveals whether an email is registered.
- A pending sign-up for an email that gets an account by another path (e.g.
  Google) can no longer be confirmed.

### Methods and protection

- Password, magic link, Google and LinkedIn coexist; linking never removes the
  password.
- Social-only accounts may add a password from the account page or through
  password recovery.
- Disconnecting a provider is refused when the account would have no password
  and no other provider; magic link does not count. Concurrent disconnects
  cannot leave an account with no method.
- A disabled account cannot sign in by any method, and no flow re-enables it.

### Emails

- Sent to the account email: sign-up code, welcome (self-sign-up only),
  provider linked/unlinked (naming the provider, date and whether the owner or
  an administrator did it), password-recovery link (single use, one hour,
  origin from configuration, G17/G18), "account already exists" notice.
- Language: the language chosen on the sign-up screen, then the account's
  language.
- Emails never contain provider tokens, profile data or other people's data.
- Delivery failure never blocks the action that triggered it (except the code,
  which the person can resend); failures are recorded for administrators.
- In local and Preview, emails go to a development sink, never to real
  inboxes; codes and recovery links are never logged in deployments.

### Permissions per persona

- Account owner: own methods; connect, disconnect, set password.
- Administrator: sees every account's methods; disconnects others' providers;
  cannot connect providers for others; no administration or method management
  inside impersonation.
- Recruiter and candidate: only their own account.
- CLI operator: lists and disconnects; never links.

### Messages and privacy

- Refusals that could reveal account existence use one neutral message
  (disabled account, unverified email guidance, recovery request, sign-up with
  a registered email).
- Social sign-in attempts share the existing sign-in throttling.

### Audit

- Recorded: automatic link, manual link, disconnect (naming who), self-sign-up
  (path, provider and role), terms acceptance, refused sign-up due to cap,
  code confirmation, email delivery failure. Never tokens, codes or profile
  data.

### Data kept per identity

- Provider, provider subject, verified email at link time, link date, last
  use, link origin. Nothing else. Disconnecting deletes the record.

## User Experience

### Personas and goals

- Owner: one click on any browser; full view of access.
- Existing member: first access without a magic link.
- New candidate: join alone and leave sign-up with a profile and CV.
- New recruiter: an account ready for candidates.
- Administrator: see how people sign in; fix a wrong link.

### Primary flows

1. **Returning member:** sign-in → "Continue with Google" → consent → landing.
2. **Invited member, first time:** sign-in → "Continue with LinkedIn" → consent
   → recognized by verified email → landing; welcome is not sent (account was
   not self-created); a provider-linked notice is sent.
3. **New candidate, social:** sign-up → "Continue with Google" → consent → same
   screen with verified email → Candidate, name, headline, CV, accept terms →
   submit → cockpit → welcome email.
4. **New candidate, manual:** sign-up → Candidate, name, headline, CV, email,
   password, accept terms → "Check your email" → code → cockpit → welcome
   email.
5. **New recruiter:** either path choosing Recruiter (no CV) → recruiter empty
   state → welcome email.
6. **Unverified LinkedIn email:** guidance → sign in another way → account page
   → "Connect LinkedIn" → notice email.
7. **Forgot password:** sign-in → "Forgot password" → neutral confirmation →
   email link → new password.
8. **Manage methods / administrator:** account page or users list → connect,
   disconnect, set password → notice email.

### UI considerations

- The sign-up screen follows the Tecla layout (form column + brand panel with
  the product's own copy and imagery), built with the product's theme tokens
  and type scale; the sign-in page links to it ("Create account") and vice
  versa ("Already have an account? Sign in").
- Provider buttons follow each provider's sign-in brand guidelines.
- The role choice is the first field; candidate-only fields appear only for
  Candidate.
- All text from the dictionary in Portuguese and English; every new screen
  works at 375 px, with keyboard and screen readers; the code field accepts
  paste and one-time-code autofill.
- Emails are simple, text-first, with the product name and a single action.

### Onboarding and discoverability

- "Create account" on the sign-in page leads to the sign-up screen.
- The empty-installation first-access screen stays CLI-only.
- The existing "create my profile" onboarding remains for administrator-created
  accounts without a profile.

## High-Level Technical Constraints

- **Rule 1 (LinkedIn):** only "Sign In with LinkedIn using OpenID Connect", no
  `w_member_social` for sign-in, no profile data stored; rule 1, G01 and
  `docs/linkedin-policy.md` amended in the same change (ADR-003).
- **Rule 7:** the CV submitted at sign-up is the candidate's own document; no
  text is generated on their behalf.
- **Rules 14/15:** new pages and actions behind a session or registered as
  public sign-in/sign-up entries; actions call the authorization guard first;
  no action accepts a candidate identifier from input.
- **G16:** per-role end-to-end scenarios for sign-in and sign-up.
- **G17/G18:** links in emails use the configured public origin; recovery
  tokens single-use, one hour, burned before use, never logged in deployments.
- **G24/G25:** impersonation keeps no administration and no method management;
  new accounts never point at existing candidates; only candidates grant
  recruiter access.
- **Rule 16/G41:** provider and email-service secrets in environment
  variables only; never tokens or codes in database or logs.
- **Environments:** social sign-in only in production and local (ADR-005);
  manual sign-up works everywhere, with a development email sink outside
  production.
- **Email sending:** through Resend, from `contato@mastertimm.com.br`; the
  `mastertimm.com.br` domain carries the DNS records Resend requires.
- **Rules 9/10/11:** dictionary text, theme tokens, 375 px; new public routes
  registered in the E2E route list.
- **Privacy:** honor Google and LinkedIn terms; delete identity data on
  disconnect.
- **Vision update:** `docs/product/vision.md`, personas and first-access docs
  state that self-sign-up exists for candidates and recruiters.

## Non-Goals (Out of Scope)

- Granting and revoking recruiter access to a candidate — #465.
- Using provider name, photo, headline or any profile data; prefilling the
  profile from LinkedIn or Google.
- Other providers (GitHub, Microsoft, Apple) and enterprise SSO/SAML.
- Self-service role change after sign-up.
- Social sign-in in Preview or staging.
- Sign-up allowlists.
- Two-factor authentication inside master-jobs.
- Re-acceptance of changed terms by existing accounts.
- Marketing or digest emails; only the account emails listed above.
- Country or other profile fields beyond name, headline and CV at sign-up.

## Architecture Decision Records

- [ADR-001: Identify social logins by provider subject; link existing accounts by verified email or from the account page](adrs/adr-001.md) — identity key and linking rules.
- [ADR-002: Open self-sign-up, choosing candidate or recruiter](adrs/adr-002.md) — the product stops being invite-only for candidates and recruiters.
- [ADR-003: LinkedIn and Google only for authentication, keeping provider subject and verified email only](adrs/adr-003.md) — data minimization and rule 1 amendment.
- [ADR-004: Sign-in methods coexist and the last method cannot be removed](adrs/adr-004.md) — coexistence, last-method protection, administrator and CLI powers.
- [ADR-005: Social sign-in available in production and local only](adrs/adr-005.md) — environment availability.
- [ADR-006: Manual sign-up confirmed by an emailed code, and a transactional email channel](adrs/adr-006.md) — manual sign-up, code rules, account emails (absorbs #237).
- [ADR-007: One sign-up screen creates the account and the candidate profile](adrs/adr-007.md) — Tecla pattern.

## Open Questions

- None blocking. Resolved by the owner on 2026-10-05: terms and privacy start
  from an original standard draft reviewed by the owner; emails go through
  Resend from `contato@mastertimm.com.br`; sign-up cap is 3 per IP per hour,
  configurable by environment variable.
