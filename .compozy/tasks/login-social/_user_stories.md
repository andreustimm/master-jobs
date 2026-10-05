# User Stories: Social Sign-In with Google and LinkedIn

Canonical behavior catalog for social sign-in and social self-sign-up. Companion
to `_prd.md`; consumed by `_techspec.md` (component mapping) and `_tests.md`
(coverage matrix).

## Personas

- **Owner (Andreus)** — the main user; holds admin and candidate roles, works
  terminal-first and wants one-click access from any browser.
- **Existing member** — a candidate or recruiter whose account an administrator
  created (often without a password); wants to enter without asking for a
  magic link.
- **New candidate** — someone without an account who wants to manage their own
  job search in master-jobs.
- **New recruiter** — someone without an account who works with candidates and
  expects to be given access by them.
- **Administrator** — keeps accounts healthy: sees how people sign in, removes
  a compromised provider link, disables accounts.

## Story Index

| ID     | Feature Area      | Persona          | Story |
|--------|-------------------|------------------|-------|
| US-001 | Social sign-in    | Existing member  | Sign in with an already linked Google or LinkedIn identity |
| US-002 | Social sign-in    | Existing member  | First social sign-in links the existing account by verified email |
| US-003 | Social sign-in    | Existing member  | Social sign-in without a verified email is guided to manual linking |
| US-004 | Self-sign-up      | New candidate    | Create a candidate account through Google or LinkedIn |
| US-005 | Self-sign-up      | New recruiter    | Create a recruiter account through Google or LinkedIn |
| US-006 | Self-sign-up      | New candidate    | Sign-up refused without verified email or when the hourly cap is reached |
| US-007 | Account methods   | Existing member  | Link Google or LinkedIn from the account page |
| US-008 | Account methods   | Existing member  | Unlink a provider, never the last way in |
| US-009 | Account methods   | New candidate    | Add a password to a social-only account |
| US-010 | Account methods   | Owner            | See every sign-in method with link date and last use |
| US-011 | Administration    | Administrator    | See and unlink another account's providers |
| US-012 | Administration    | Administrator    | Administrator role is never obtained through sign-up |
| US-013 | Administration    | Owner            | List and unlink providers from the CLI |
| US-014 | Availability      | Owner            | Social buttons only where the provider is configured and the environment allows |
| US-015 | Recruiter landing | New recruiter    | Recruiter without candidates sees an explanatory empty state |

## Social sign-in

### US-001: Sign in with an already linked identity

**As an** existing member, **I want** to press "Continue with Google" or
"Continue with LinkedIn" and be signed in, **so that** I do not need a password
or a magic link.

Acceptance criteria:

- AC-1: Given an enabled account linked to my Google identity, when I complete
  the Google consent, then I land signed in on the page my role lands on today
  (recruiter → jobs; candidate/admin → cockpit), with the same session length
  as password sign-in.
- AC-2: Given the same, when I sign in with LinkedIn linked to my account, then
  the same happens.
- AC-3: Given my email at Google changed after linking, when I sign in, then I
  still reach my account (the provider identity, not the email, decides).
- AC-4: Given a successful social sign-in, when I open the account page, then
  that method shows an updated "last used" date.

Edge cases:

- EC-1: Account disabled → sign-in refused with the same neutral message used
  for any refused sign-in; no session is created; the account is not
  re-enabled.
- EC-2: I cancel at the provider's consent screen → back on the sign-in page
  with "Sign-in cancelled", no account change.
- EC-3: The provider returns an error or is unreachable → back on the sign-in
  page with "Could not reach Google/LinkedIn, try again"; no account change.
- EC-4: I reuse an old or tampered return link (expired or replayed attempt) →
  refused with "This sign-in attempt expired, start again"; no session.
- EC-5: I start a social sign-in in two tabs and finish both → each finished
  attempt either signs me in once or is refused as expired; never two
  accounts, never an error page.
- EC-6: I am already signed in and open the sign-in page → redirected to my
  landing page as today.
- EC-7: Social sign-in attempts are throttled like password attempts → after
  repeated failures from the same source the page shows the same neutral
  throttle message as password sign-in.
- EC-8: A deep link (e.g. a job page) sent me to sign-in → after social sign-in
  I land on that page if my role may see it, otherwise on my landing page.

### US-002: First social sign-in links the existing account

**As an** existing member whose account was created by an administrator, **I
want** my first Google or LinkedIn sign-in to recognize my account by email,
**so that** I can enter without first setting a password.

Acceptance criteria:

- AC-1: Given an enabled account with email `ana@x.com` and no Google identity
  linked, when I sign in with a Google identity whose email `ana@x.com` Google
  asserts as verified, then the identity is linked to that account and I am
  signed in.
- AC-2: Given AC-1 happened, when I open the account page, then Google appears
  as a linked method with today's link date, and an audit entry records the
  automatic link.
- AC-3: Given the email differs only in letter case or surrounding spaces, when
  I sign in, then it still matches (same normalization as account emails).

Edge cases:

- EC-1: The account already has a different Google identity linked → no
  automatic link and no sign-in; message "This account is linked to another
  Google account; sign in with it or another method"; no detail about the
  other identity.
- EC-2: The matching account is disabled → same neutral refusal as US-001.EC-1;
  nothing linked.
- EC-3: The provider does not assert the email as verified → no automatic link
  (see US-003).
- EC-4: The provider returns no email at all → treated as unverified (US-003).
- EC-5: Two automatic-link attempts for the same account and provider finish
  at the same time → exactly one identity is linked; the other attempt signs
  in through it or is refused as expired.
- EC-6: The account has a password → linking keeps the password working.

### US-003: Social sign-in without a verified email

**As an** existing member whose LinkedIn email is not asserted as verified,
**I want** to be told how to connect LinkedIn, **so that** I am not stuck.

Acceptance criteria:

- AC-1: Given an unknown LinkedIn identity without a verified email, when I
  finish LinkedIn consent, then I see "We could not confirm your email with
  LinkedIn. Sign in another way and connect LinkedIn from your account page,
  or use Google", and no account is created or linked.
- AC-2: Given the same, the message is identical whether or not an account
  with that email exists (no account enumeration).

Edge cases:

- EC-1: Same situation with Google (rare) → same message naming Google.
- EC-2: I retry immediately → same result, no side effect.

## Self-sign-up

### US-004: Create a candidate account

**As a** new candidate, **I want** to sign up with Google or LinkedIn and pick
"Candidate", **so that** I can start managing my own job search.

Acceptance criteria:

- AC-1: Given an unknown identity with a verified email that matches no
  account, when I finish consent, then I see a choice page "How will you use
  master-jobs?" with "Candidate" and "Recruiter", showing the email that will
  be used.
- AC-2: When I choose "Candidate", then an account with the candidate role is
  created with my verified email, linked to that provider identity, with its
  own new empty candidate profile, and I land on the existing "create my
  profile" onboarding.
- AC-3: The new account sees only its own candidate data; nothing from any
  other candidate is visible anywhere.
- AC-4: An audit entry records the self-sign-up with provider and chosen role.

Edge cases:

- EC-1: I close the choice page without choosing → no account exists; signing
  in again restarts at the choice page.
- EC-2: I leave the choice page open longer than the attempt validity (15
  minutes) and then choose → "This sign-up expired, start again"; nothing
  created.
- EC-3: I submit the choice twice (double click, two tabs) → exactly one
  account; the second submit lands me signed in on the same account.
- EC-4: Between consent and choice someone else creates an account with my
  email → my choice links to that account instead of creating a new one only
  if US-002 conditions hold; otherwise "start again".
- EC-5: The choice page is opened directly without a pending sign-up → sent
  to the sign-in page.
- EC-6: Tampered choice value (anything but candidate/recruiter, including
  "admin") → refused; nothing created.

### US-005: Create a recruiter account

**As a** new recruiter, **I want** to sign up with Google or LinkedIn and pick
"Recruiter", **so that** candidates can later grant me access.

Acceptance criteria:

- AC-1: Given the choice page from US-004.AC-1, when I choose "Recruiter",
  then an account with the recruiter role is created, linked to my identity,
  with no candidate linked, and I land on the recruiter empty state (US-015).
- AC-2: The recruiter account sees no candidate data until a candidate grants
  access (issue #465).

Edge cases:

- EC-1: Same expiry, double-submit and tampering behavior as US-004.EC-2,
  EC-3, EC-6.
- EC-2: A recruiter later wants to be a candidate too → not self-service; an
  administrator changes roles as today.

### US-006: Sign-up refused

**As a** new candidate, **I want** a clear answer when sign-up is not possible,
**so that** I know what to do.

Acceptance criteria:

- AC-1: Given an unknown identity without a verified email, when I finish
  consent, then I see the US-003.AC-1 message and nothing is created.
- AC-2: Given 20 accounts were self-created in the last 60 minutes, when
  another person reaches the choice page and chooses a role, then they see
  "Sign-ups are paused for a moment, try again later" and nothing is created;
  existing members keep signing in normally.

Edge cases:

- EC-1: Two people choose at the same time when 19 sign-ups exist → at most one
  of them gets the 20th slot; the other sees the paused message.
- EC-2: The cap counts only self-created accounts; accounts created by
  administrators do not consume it.
- EC-3: Password and magic-link flows never create accounts, whatever the
  email.

## Account methods

### US-007: Link a provider from the account page

**As an** existing member, **I want** to connect Google or LinkedIn from my
account page, **so that** I can use it even when its email differs from mine.

Acceptance criteria:

- AC-1: Given I am signed in and Google is not linked, when I press "Connect
  Google" and complete consent, then Google appears as linked, with today's
  date, and an audit entry is recorded; my account email does not change.
- AC-2: The same works for LinkedIn even when LinkedIn does not assert the
  email as verified.

Edge cases:

- EC-1: The provider identity is already linked to another account → "This
  Google account is already connected to another master-jobs account";
  nothing changes on either account.
- EC-2: My account already has that provider linked → the connect button is
  not shown; a forced attempt is refused without changes.
- EC-3: I cancel at the provider → back on the account page, nothing changes.
- EC-4: My session expired during consent → after returning I am asked to
  sign in again and nothing is linked.
- EC-5: I am in an administrator impersonation session → connect and
  disconnect are not available (the impersonated account is not mine).

### US-008: Unlink a provider

**As an** existing member, **I want** to disconnect Google or LinkedIn,
**so that** that account no longer opens mine.

Acceptance criteria:

- AC-1: Given my account has a password and Google linked, when I disconnect
  Google, then Google disappears from my methods, signing in with it no longer
  reaches my account, and an audit entry is recorded.
- AC-2: Given my account has no password and only LinkedIn linked, when I try
  to disconnect LinkedIn, then I see "Add a password or connect another
  provider before disconnecting this one" and nothing changes.

Edge cases:

- EC-1: Two disconnects at the same time leaving zero methods → at most one
  succeeds; the other gets the AC-2 message.
- EC-2: After disconnecting, signing in with that provider behaves as an
  unknown identity (US-002 may relink by verified email) — the page warns
  "Signing in with Google again will reconnect it automatically if the email
  matches".
- EC-3: Disconnecting during an administrator impersonation → not available.

### US-009: Add a password to a social-only account

**As a** member who signed up socially, **I want** to set a password,
**so that** I have a way in that does not depend on the provider.

Acceptance criteria:

- AC-1: Given a social-only account, when I open the account page, then I can
  set a password following the existing password rules (minimum 12
  characters).
- AC-2: After setting it, I can sign in with email and password.

Edge cases:

- EC-1: Password below the minimum → the existing validation message.
- EC-2: Setting a password does not end my other sessions; changing an
  existing password keeps today's behavior (ends other sessions).

### US-010: See every sign-in method

**As the** owner, **I want** to see how my account can be accessed, **so
that** I notice anything unexpected.

Acceptance criteria:

- AC-1: The account page lists Password (set or not), Google and LinkedIn,
  each linked provider with link date and last-use date, and whether it was
  linked automatically or manually.
- AC-2: The list never shows provider tokens, profile photos, names or
  headlines.

Edge cases:

- EC-1: A provider was never used after linking → last use shows "never".
- EC-2: A provider is linked but currently unavailable in this environment
  (US-014) → still listed, with "not available here".

## Administration

### US-011: Administrator sees and unlinks providers

**As an** administrator, **I want** to see each account's sign-in methods and
remove a provider, **so that** I can handle a compromised or wrong link.

Acceptance criteria:

- AC-1: The users list shows, per account, which providers are linked and
  whether a password is set.
- AC-2: An administrator can unlink a provider from another account; the
  account owner sees it gone and an audit entry names the administrator.
- AC-3: An administrator cannot link a provider to another account.

Edge cases:

- EC-1: Unlinking the last method of another account → refused with the
  last-method message; the administrator may disable the account instead.
- EC-2: An administrator in an impersonation session → no administration
  actions, as today.
- EC-3: A non-administrator calling the unlink action → refused.

### US-012: Administrator role is never self-assigned

**As an** administrator, **I want** the admin role to stay invite-only, **so
that** open sign-up cannot grant administration.

Acceptance criteria:

- AC-1: The sign-up choice offers only Candidate and Recruiter.
- AC-2: An existing administrator account can sign in socially like any
  account (US-001/US-002) and keeps its roles.

Edge cases:

- EC-1: A forged sign-up request asking for admin → refused, nothing created.
- EC-2: First access of an empty installation still requires the CLI
  (`jho auth add-user … --role admin,candidate`); social sign-up never creates
  the first administrator.

### US-013: Manage providers from the CLI

**As the** owner, **I want** `jho auth` to list and remove provider links,
**so that** I can manage access from the terminal.

Acceptance criteria:

- AC-1: A CLI command lists an account's methods (password set or not,
  providers with link and last-use dates).
- AC-2: A CLI command unlinks a provider from an account with the same
  last-method protection and audit entry as the web.

Edge cases:

- EC-1: Unknown email → "no such account" (the CLI is an operator tool and may
  say so).
- EC-2: Provider not linked → "nothing to unlink", exit code signals no
  change.
- EC-3: The CLI never links providers (linking requires the browser).

## Availability

### US-014: Social buttons only where configured

**As the** owner, **I want** the social buttons only where they work, **so
that** nobody hits a broken flow.

Acceptance criteria:

- AC-1: In production and local, each provider button appears when that
  provider's credentials are configured.
- AC-2: In Preview and staging no social button appears; password sign-in
  works as today.
- AC-3: Starting a social flow by URL where it is unavailable → back on the
  sign-in page with "This sign-in option is not available here".

Edge cases:

- EC-1: Only Google configured → only Google shown.
- EC-2: No provider configured → the sign-in page is exactly as today.
- EC-3: The empty-installation first-access screen (no accounts yet) shows no
  social buttons.

## Recruiter landing

### US-015: Recruiter without candidates

**As a** new recruiter, **I want** to understand why I see nothing, **so
that** I know candidates must grant me access.

Acceptance criteria:

- AC-1: A recruiter with no linked candidates lands on a page explaining that
  candidates grant access to recruiters and that nothing will appear until
  one does.
- AC-2: The page works at 375 px width and uses the dictionary for all text.

Edge cases:

- EC-1: The recruiter later gets access (issue #465) → the page stops showing
  and the usual recruiter landing appears.
