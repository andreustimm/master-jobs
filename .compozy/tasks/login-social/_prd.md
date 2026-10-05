# Social Sign-In with Google and LinkedIn

Issue: #464. Related: #465 (candidate grants recruiter access), #237 (email
delivery via Resend).

## Overview

Today a person enters master-jobs with an email and password or with a magic
link that only the CLI can issue, and only an administrator can create an
account. Invited people often have no password, so their first access needs
the owner to run a command. There is no way for a new candidate or recruiter
to join on their own.

This feature lets anyone press "Continue with Google" or "Continue with
LinkedIn". An existing account is recognized — through the provider identity
already linked to it, or, on first use, through the email the provider
verifies — and the person is signed in. Someone without an account signs up in
the same flow, choosing whether they are a candidate or a recruiter. Provider
data is used only to authenticate: master-jobs keeps the provider identifier
and the verified email, nothing else.

It serves the owner (one-click access from any browser), invited members (no
password needed), new candidates (self-service start) and new recruiters
(self-service account ready for candidates to grant access). It removes the
administrator from routine account creation while keeping the administrator in
control of roles, provider links and disabled accounts.

## Goals

- A person with an account signs in with Google or LinkedIn in one flow,
  without a password or a CLI-issued magic link.
- The first social sign-in of an existing account links it automatically when
  the provider verifies the same email; later sign-ins rely on the provider
  identity, not the email.
- A person without an account creates one through Google or LinkedIn, choosing
  Candidate or Recruiter; the administrator role is never self-assigned.
- A new account never reaches anyone else's data: a candidate gets its own
  empty profile; a recruiter starts with no candidates.
- Every person sees and manages how their account can be accessed, and can
  never remove their last way in.
- Administrators see every account's methods, can remove a provider link, and
  the CLI offers the same listing and removal.
- LinkedIn usage stays within rule 1: official OpenID Connect, authentication
  only, no profile data stored.

## User Stories

- US-001 – US-003: social sign-in for existing accounts (linked identity,
  automatic link by verified email, unverified email guidance).
- US-004 – US-006: self-sign-up as candidate or recruiter and its refusals.
- US-007 – US-010: account page — connect, disconnect, add password, method
  list.
- US-011 – US-013: administration in the web and the CLI.
- US-014: availability per environment and configuration.
- US-015: recruiter empty state.

[Full user stories](_user_stories.md)

## Core Features

### F1. Social sign-in

- "Continue with Google" and "Continue with LinkedIn" buttons on the sign-in
  page, next to the existing email/password form.
- Completing the provider consent resolves the account:
  1. Provider identity already linked → sign in that account.
  2. Unknown identity, provider asserts a verified email, an enabled account
     with that email exists and has no identity from that provider → link and
     sign in (automatic link).
  3. Unknown identity, verified email, no account with that email → self-sign-
     up (F2).
  4. Unknown identity without a verified email → guidance message; nothing
     created or linked.
- After sign-in the person lands where their role lands today, or on the
  requested deep link when their role may see it.
- Sessions created by social sign-in behave exactly like password sessions
  (length, revocation, disabled-account cut-off).

### F2. Self-sign-up with role choice

- A choice page shows the verified email and two options: Candidate and
  Recruiter.
- Candidate: account with candidate role and its own new empty candidate,
  landing on the existing "create my profile" onboarding.
- Recruiter: account with recruiter role and no candidates, landing on the
  recruiter empty state (F6).
- The account exists only after the choice; abandoning creates nothing.
- Product-wide cap on self-created accounts per rolling hour.

### F3. Account page: sign-in methods

- Lists Password (set or not), Google, LinkedIn; for each linked provider the
  link date, last-use date and whether it was linked automatically or
  manually.
- Connect a provider (any email at the provider, verified or not).
- Disconnect a provider, refused when it is the last way in.
- Set a password on a social-only account.

### F4. Administration (web)

- The users list shows each account's linked providers and whether a password
  is set.
- Administrators can disconnect another account's provider (last-method
  protection applies) and never connect one on someone's behalf.

### F5. CLI

- `jho auth` lists an account's sign-in methods and disconnects a provider
  with the same rules and audit as the web. Linking stays browser-only.

### F6. Recruiter empty state

- A recruiter with no candidates sees an explanation that candidates grant
  access and that content appears once one does.

### Interactions

- F1 hands unknown verified identities to F2; F2 ends signed in through F1's
  session rules.
- F3, F4 and F5 share one set of rules for disconnecting and one audit trail.
- Access granting for recruiters (#465) later replaces F6 for recruiters who
  have candidates.

## Business Rules

### Identity and linking

- A social identity is the pair (provider, provider subject). It is unique
  across the product: one identity belongs to at most one account.
- An account holds at most one identity per provider (one Google, one
  LinkedIn).
- Sign-in by a linked identity never consults the email.
- Automatic linking requires all of: the provider asserts the email as
  verified; the normalized email equals an account's normalized email; the
  account is enabled; the account has no identity from that provider.
- If the account already has a different identity from that provider, the
  sign-in is refused with "This account is linked to another Google/LinkedIn
  account" and nothing changes.
- Manual linking from the account page requires an active, non-impersonated
  session and does not require email match or verification.
- Linking never changes the account email, roles, candidate or password.

### Self-sign-up

- Starts only for an unknown identity with a verified email matching no
  account.
- Roles offered: Candidate, Recruiter. Administrator is never offered and any
  forged request for it is refused.
- Candidate accounts receive a new empty candidate of their own (G25); they
  are never attached to an existing candidate.
- Recruiter accounts start with zero linked candidates; only a candidate can
  grant access (G25, #465).
- Cap: at most **20** self-created accounts in any rolling 60-minute window,
  product-wide. Reaching the cap pauses sign-up with a message; sign-in of
  existing accounts is unaffected. Administrator-created accounts do not count.
- A pending sign-up (between consent and choice) is valid for **15 minutes**
  and can be completed once.
- Password and magic-link flows never create accounts.

### Methods and protection

- Password, magic link, Google and LinkedIn coexist; linking a provider never
  removes the password.
- An account may be social-only. Its owner may add a password (existing
  rules: minimum 12 characters).
- Disconnecting a provider is refused when the account would be left with no
  password and no other provider. Magic link does not count, because only the
  CLI issues it.
- Concurrent disconnects cannot leave an account with no method.
- A disabled account cannot sign in by any method, and signing in never
  re-enables it.

### Permissions per persona

- Account owner: sees own methods; connects, disconnects, sets password.
- Administrator: sees every account's methods; disconnects providers of other
  accounts; cannot connect providers for others; inside an impersonation
  session has no administration actions and cannot connect or disconnect the
  impersonated account's providers.
- Recruiter and candidate: only their own account.
- CLI operator: lists and disconnects; never links.

### Messages and privacy

- Refusals that could reveal whether an email has an account use one neutral
  message (disabled account, unknown account in contexts where enumeration
  matters, unverified email guidance identical with or without an account).
- Sign-in attempts through social flows share the existing throttling of
  sign-in attempts.

### Audit

- Events recorded: automatic link, manual link, disconnect (by owner,
  administrator or CLI, naming who), self-sign-up (provider and chosen role),
  refused sign-up due to cap.
- Audit entries never contain provider tokens or profile data.

### Data kept per identity

- Provider, provider subject, verified email at link time, link date, last-use
  date, link origin (automatic or manual). Nothing else. Disconnecting deletes
  the record.

## User Experience

### Personas and goals

- Owner: enter quickly on any browser; see and control access.
- Existing member: first access without asking for a magic link.
- New candidate: start alone, in minutes.
- New recruiter: have an account ready for candidates to grant access.
- Administrator: see how people sign in; fix a wrong link.

### Primary flows

1. **Returning member:** sign-in page → "Continue with Google" → consent →
   landing page.
2. **Invited member, first time:** sign-in page → "Continue with LinkedIn" →
   consent → account recognized by verified email → landing page; the account
   page later shows LinkedIn "linked automatically".
3. **New candidate:** sign-in page → "Continue with Google" → consent → "How
   will you use master-jobs?" (shows the email) → Candidate → "create my
   profile" onboarding.
4. **New recruiter:** same, choosing Recruiter → recruiter empty state.
5. **Unverified LinkedIn email:** consent → guidance message → sign in another
   way → account page → "Connect LinkedIn".
6. **Manage methods:** account page → methods list → connect / disconnect / set
   password.
7. **Administrator:** users list → account methods → disconnect provider.

### UI considerations

- Provider buttons follow each provider's brand guidelines for sign-in buttons
  while respecting the product theme tokens around them.
- All text comes from the dictionary in Portuguese and English.
- Every new screen (choice page, recruiter empty state, method list) works at
  375 px width and is keyboard- and screen-reader-accessible.
- The choice page explains in one sentence what each role means and that
  administrators are invited by the owner.

### Onboarding and discoverability

- The buttons sit on the sign-in page; no separate sign-up page is needed.
- The empty-installation first-access screen stays CLI-only.

## High-Level Technical Constraints

- **Rule 1 (LinkedIn):** use only "Sign In with LinkedIn using OpenID Connect";
  never request `w_member_social` for sign-in; store no profile data. Rule 1,
  G01 and `docs/linkedin-policy.md` are amended in the same change that ships
  LinkedIn sign-in (ADR-003).
- **Rules 14 and 15 (authentication and authorization):** every new page and
  action is behind a session or listed as a public sign-in entry; actions call
  the authorization guard first; no action accepts a candidate identifier from
  input.
- **G16:** each role completes sign-in and reaches its own screens; per-role
  end-to-end scenarios are required.
- **G17:** return URLs derive from the configured public origin, never from
  the request host.
- **G24/G25:** impersonation keeps no administration and no method management;
  new accounts never point at existing candidates; only candidates grant
  recruiter access.
- **Rule 16/G41:** provider client secrets live in environment variables;
  only variable names may be recorded; tokens are never stored or logged.
- **Environments:** social sign-in only in production and local (ADR-005).
- **Rule 9/10/11:** dictionary text, theme tokens, 375 px.
- **Privacy:** honor LinkedIn and Google terms — delete identity data on
  disconnect; no combination with other LinkedIn content.
- **Vision update:** `docs/product/vision.md` and first-access documentation
  must state that self-sign-up exists for candidates and recruiters.

## Non-Goals (Out of Scope)

- Granting and revoking recruiter access to a candidate — issue #465.
- Email notifications of linking, unlinking or sign-up — wait for Resend
  (#237); audit and the account page cover visibility now.
- Using provider name, photo, headline or any profile data anywhere.
- Prefilling the candidate profile from LinkedIn or Google.
- Other providers (GitHub, Microsoft, Apple) and enterprise SSO/SAML.
- Self-service change of role after sign-up (administrators change roles as
  today).
- Social sign-in in Preview or staging.
- Domain or email allowlists for sign-up.
- Two-factor authentication inside master-jobs.

## Architecture Decision Records

- [ADR-001: Identify social logins by provider subject; link existing accounts by verified email or from the account page](adrs/adr-001.md) — identity key and linking rules.
- [ADR-002: Open self-sign-up through social login, choosing candidate or recruiter](adrs/adr-002.md) — the product stops being invite-only for candidates and recruiters.
- [ADR-003: LinkedIn and Google only for authentication, keeping provider subject and verified email only](adrs/adr-003.md) — data minimization and rule 1 amendment.
- [ADR-004: Sign-in methods coexist and the last method cannot be removed](adrs/adr-004.md) — coexistence, last-method protection, administrator and CLI powers.
- [ADR-005: Social sign-in available in production and local only](adrs/adr-005.md) — environment availability.

## Open Questions

- Should the self-sign-up cap (20 per hour) be configurable by the
  administrator, or is a fixed default enough?
- Should the choice page require accepting terms of use or a privacy notice
  before creating the account, now that sign-up is public?
- Recovery for a social-only person who loses the provider account relies on
  password recovery by email, which depends on email delivery (#237); until
  then an administrator must help. Is that acceptable?
