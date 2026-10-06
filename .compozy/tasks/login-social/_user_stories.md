# User Stories: Social Sign-In with Google and LinkedIn

Canonical behavior catalog for social sign-in, self-sign-up (social or manual
with an emailed code) on a single screen that also creates the candidate
profile, and account emails. Companion
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
| US-016 | Manual sign-up    | New candidate    | Sign up with email and password on the single screen |
| US-017 | Manual sign-up    | New candidate    | Confirm the sign-up with the emailed code |
| US-018 | Account emails    | New candidate    | Receive a welcome email once the account exists |
| US-019 | Account emails    | Existing member  | Receive a notice when a provider is linked or unlinked |
| US-020 | Account emails    | Existing member  | Recover the password through an emailed link |
| US-021 | Terms             | New candidate    | Read and accept the Terms of Use and Privacy Policy |

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
  account, when I finish consent, then I return to the sign-up screen showing
  the verified email (not editable, no password field) with the role choice
  "Candidate" / "Recruiter", name, and the terms acceptance.
- AC-2: When I choose "Candidate", fill name, headline and CV (PDF upload or
  pasted text, same limits as today's onboarding), accept the terms and
  submit, then one account with the candidate role is created with my
  verified email, linked to that provider identity, with its own new
  candidate profile holding that CV as its first version, and I land on my
  cockpit signed in.
- AC-3: The new account sees only its own candidate data; nothing from any
  other candidate is visible anywhere.
- AC-4: An audit entry records the self-sign-up with provider and chosen role,
  and the terms acceptance is recorded with document versions and time.
- AC-5: After the account is created I receive the welcome email (US-018).

Edge cases:

- EC-1: I close the sign-up screen without submitting → no account exists;
  signing in again with the provider returns me to the sign-up screen.
- EC-7: The PDF is too large, not a PDF, or has no text layer → the existing
  onboarding messages appear on the sign-up screen, the other fields stay
  filled, nothing is created.
- EC-8: Pasted CV shorter than the current minimum → existing message; nothing
  created.
- EC-9: Terms not accepted → the submit is refused with "Accept the Terms of
  Use and Privacy Policy to continue".
- EC-10: Both a PDF and pasted text are provided → the existing "choose one"
  message.
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

- AC-1: Given the sign-up screen from US-004.AC-1, when I choose "Recruiter",
  the headline and CV fields disappear; filling name, accepting the terms and
  submitting creates an account with the recruiter role, linked to my
  identity, with no candidate linked, and I land on the recruiter empty state
  (US-015) and receive the welcome email.
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
- AC-2: Given 3 accounts were self-created from my IP address in the last 60
  minutes (default, configurable by environment variable), when I submit
  another sign-up, then I see "Too many sign-ups from this network, try again
  later" and nothing is created; existing members keep signing in normally,
  and people on other IP addresses can still sign up.

Edge cases:

- EC-1: Two sign-ups from the same IP finish at the same time when 2 exist →
  at most one gets the 3rd slot; the other sees the limit message.
- EC-2: The cap counts only self-created accounts; accounts created by
  administrators do not consume it.
- EC-5: The environment variable is missing or invalid → the default 3
  applies.
- EC-3: Password sign-in and magic-link flows never create accounts, whatever
  the email; only the sign-up screen does.
- EC-4: The cap counts confirmed manual sign-ups and social sign-ups together;
  a pending manual sign-up does not consume a slot until confirmed.

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

## Manual sign-up

### US-016: Sign up with email and password

**As a** new candidate (or recruiter), **I want** to sign up with my email
and a password on the same screen, **so that** I can join without Google or
LinkedIn.

Acceptance criteria:

- AC-1: Given the sign-up screen, when I choose a role, fill name, email,
  password (minimum 12 characters, same rule as today), the candidate fields
  when Candidate, accept the terms and submit, then I see "Check your email"
  with the address, a code field and "resend code" (available after 60
  seconds), and no account exists yet.
- AC-2: The screen states that the code expires in 15 minutes.

Edge cases:

- EC-1: Invalid email format → field message; nothing sent.
- EC-2: Password below the minimum → existing message; nothing sent.
- EC-3: The email already has an account → the screen shows exactly the same
  "Check your email" step; the email received says an account already exists
  and offers sign-in and password recovery, with no code.
- EC-4: The email has a pending sign-up → a new code is sent and the previous
  code stops working; the latest submitted data replaces the pending data.
- EC-5: Submit twice → one pending sign-up and one code email.
- EC-6: 5 codes already sent to this email in the last hour → "Too many codes
  requested, try again later"; nothing sent.
- EC-7: Per-IP sign-up cap reached (US-006.AC-2) → limit message at
  confirmation time.
- EC-8: CV problems → same messages as US-004.EC-7/EC-8/EC-10, before any
  code is sent.
- EC-9: In Preview or local, the email goes to the development sink, never to
  a real inbox; the screen behaves the same.

### US-017: Confirm the sign-up with the code

**As a** new candidate, **I want** to type the code I received, **so that**
my account is created and I am signed in.

Acceptance criteria:

- AC-1: Given a pending sign-up, when I type the correct 6-digit code within
  15 minutes, then the account is created with the chosen role, a verified
  email and the password I set (and, for candidates, the profile with my CV),
  I am signed in on my landing page and the welcome email is sent.
- AC-2: The confirmed account can sign in with email and password from then
  on, and may be linked automatically by a Google or LinkedIn identity with
  the same verified email (US-002).

Edge cases:

- EC-1: Wrong code → "Wrong code, N attempts left"; after 5 wrong attempts the
  code is invalidated and I must request a new one.
- EC-2: Code expired → "This code expired, request a new one".
- EC-3: Code with spaces, dashes or pasted with surrounding text → digits are
  extracted; anything other than 6 digits is "wrong code".
- EC-4: Correct code entered twice (double submit, two tabs) → one account;
  the second submit lands signed in on it or sees "already confirmed, sign
  in".
- EC-5: Pending sign-up older than 24 hours → discarded; the code page says
  "This sign-up expired, start again".
- EC-6: I close the page and come back later → the sign-up screen offers
  "I already have a code" for the pending email while it is valid.
- EC-7: Meanwhile someone signed up with the same email through Google →
  confirming fails with "This email already has an account, sign in"; nothing
  duplicated.
- EC-8: Resend pressed before 60 seconds → button disabled with a countdown.

## Account emails

### US-018: Welcome email

**As a** new candidate or recruiter, **I want** a welcome email once my
account exists, **so that** I know it worked and where to start.

Acceptance criteria:

- AC-1: Right after an account is created by sign-up (manual after the code,
  or social), one welcome email goes to the account email, in the language
  chosen on the sign-up screen, with the sign-in link and what to do first
  for the chosen role.
- AC-2: Accounts created by administrators do not receive the self-sign-up
  welcome.

Edge cases:

- EC-1: Email delivery fails → the account still exists and works; the failure
  is recorded for the administrator; no retry storm.
- EC-2: Duplicate creation attempts → at most one welcome email.

### US-019: Notice when a provider is linked or unlinked

**As an** existing member, **I want** an email when Google or LinkedIn is
linked to or unlinked from my account, **so that** I notice anything I did
not do.

Acceptance criteria:

- AC-1: Every link (automatic or manual) and every unlink (by me, an
  administrator or the CLI) sends one email to the account email naming the
  provider, the date and who did it (me / an administrator), with a pointer to
  the account page.
- AC-2: The email never contains provider tokens, names, photos or the
  provider email of someone else.

Edge cases:

- EC-1: Delivery fails → the change still happens and stays visible on the
  account page; failure recorded.
- EC-2: Link and unlink in quick succession → two emails in order.

### US-020: Password recovery by email

**As an** existing member, **I want** the password-recovery link sent to my
email, **so that** I can recover access without the administrator.

Acceptance criteria:

- AC-1: Requesting recovery on the sign-in page shows the same neutral
  confirmation as today whether or not the account exists; when it exists and
  is enabled, an email with the single-use link (valid one hour) is sent.
- AC-2: Using the link to set a new password ends all other sessions, as
  today.
- AC-3: A social-only account can use recovery to set its first password.

Edge cases:

- EC-1: Disabled account → neutral confirmation, no email.
- EC-2: More than the existing limit of requests per hour → neutral
  confirmation, no further email.
- EC-3: Link used twice or after one hour → existing "link invalid or expired"
  message.
- EC-4: In deployments the link is never written to logs.

## Terms

### US-021: Terms of Use and Privacy Policy

**As a** new candidate, **I want** to read the Terms of Use and the Privacy
Policy before accepting, **so that** I know how my data is used.

Acceptance criteria:

- AC-1: The sign-up screen links to public Terms of Use and Privacy Policy
  pages, readable without an account, in Portuguese and English, with an
  original text in the standard LGPD structure that names
  `contato@mastertimm.com.br` as the contact.
- AC-2: Submitting without accepting is refused (US-004.EC-9).
- AC-3: The account records which versions were accepted and when; the
  account page shows them.

Edge cases:

- EC-1: The documents change → new sign-ups accept the new version; existing
  accounts keep their recorded version (re-acceptance is out of scope).
- EC-2: The pages work at 375 px and with zoom.
