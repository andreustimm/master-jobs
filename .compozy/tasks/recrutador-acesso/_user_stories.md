# User Stories: Candidate Grants and Revokes Recruiter Access

Canonical behavior catalog for the candidate granting, limiting and revoking a
recruiter's access to their own funnel and CV, the invitation for recruiters
without an account, job suggestions from recruiters, notices and the consent
history. Companion to `_prd.md`; consumed by `_techspec.md` (component mapping)
and `_tests.md` (coverage matrix).

## Personas

- **Candidate** — owns a candidate profile (the owner, Andreus, or a
  self-signed-up candidate from #464). Wants a trusted recruiter or coach to
  follow their search and bring jobs, without exposing notes, salary floor,
  contacts or private analyses, and wants to take access back at any time.
- **Invited recruiter without an account** — a recruiter or coach who receives
  an invitation email from a candidate and has never used master-jobs.
- **Recruiter with an account** — a person with the recruiter role (created by
  an administrator or by #464 sign-up), possibly following several candidates;
  needs to see each candidate's funnel and CV and suggest jobs.
- **Administrator** — keeps the installation safe; can cut an abusive or
  mistaken access, never creates one.

## Story Index

| ID     | Feature Area   | Persona                    | Story |
|--------|----------------|----------------------------|-------|
| US-001 | Granting       | Candidate                  | Grant access to a recruiter who already has an account |
| US-002 | Granting       | Candidate                  | Invite a recruiter who has no account |
| US-003 | Granting       | Invited recruiter          | Accept the invitation by signing up with the invited email |
| US-004 | Granting       | Invited recruiter          | Invitation completed with another email grants nothing |
| US-005 | Granting       | Recruiter with an account  | Be told about a new access and find the candidate |
| US-006 | Granting       | Candidate                  | Set, change or remove an optional end date |
| US-007 | Managing       | Candidate                  | See who has access and which invitations are pending |
| US-008 | Managing       | Candidate                  | Revoke a recruiter's access immediately |
| US-009 | Managing       | Candidate                  | Resend or cancel a pending invitation |
| US-010 | Managing       | Recruiter with an account  | Access ends at the end date |
| US-011 | Managing       | Candidate                  | Grant the same recruiter again after access ended |
| US-012 | Managing       | Candidate                  | See the history of grants, revocations and suggestions |
| US-013 | Recruiter view | Recruiter with an account  | Choose a candidate from the list; the name is in the page title |
| US-014 | Recruiter view | Recruiter with an account  | Read the candidate's funnel, read-only |
| US-015 | Recruiter view | Recruiter with an account  | Read the candidate's current CV |
| US-016 | Recruiter view | Recruiter with an account  | Never reach private data or other candidates |
| US-017 | Recruiter view | Recruiter with an account  | Lose access on revocation and be told |
| US-018 | Suggestions    | Recruiter with an account  | Suggest a job to a candidate |
| US-019 | Suggestions    | Recruiter with an account  | Follow the state of my suggestions |
| US-020 | Suggestions    | Candidate                  | Be told about and review pending suggestions |
| US-021 | Suggestions    | Candidate                  | Accept a suggestion into the funnel |
| US-022 | Suggestions    | Candidate                  | Decline a suggestion |
| US-023 | Administration | Administrator              | Revoke an access or cancel an invitation |
| US-024 | Administration | Administrator              | Never grant access, including while impersonating |
| US-025 | Limits         | Candidate                  | Invitation and grant caps protect against abuse |

## Granting

### US-001: Grant access to a recruiter who already has an account

**As a** candidate, **I want** to type a recruiter's email and give them access
to my funnel and CV, **so that** they can follow my search and suggest jobs.

Acceptance criteria:

- AC-1: Given I am signed in as a candidate on my account page, when I open
  "Recruiter access", then I see a form asking for the recruiter's email and an
  optional end date, and a plain statement of what the recruiter will see
  (funnel read-only, current CV as uploaded, ability to suggest jobs) and will
  never see (notes, salary floor, profile contacts, private analyses).
- AC-2: Given an enabled account with the recruiter role and that verified
  email exists, when I confirm, then the recruiter appears in my access list as
  "Active" with today's date, the end date I chose or "No end date", and "Never"
  as last access.
- AC-3: Given AC-2, when the recruiter makes their next request, then my
  candidate appears in their `/recruiter` list without signing out.
- AC-4: Given AC-2, then the recruiter receives an "access granted" email
  naming me, stating the scope and linking to my page in their workspace.
- AC-5: Given AC-2, then my history shows "Access granted to <email>" with date
  and time.

Edge cases:

- EC-1: Malformed email (no "@", spaces, over 254 characters) → field error
  "Enter a valid email"; nothing created, the form keeps the value.
- EC-2: Email in different case or with surrounding spaces → normalized; it
  matches the account and duplicates are detected on the normalized value.
- EC-3: Blank email → field error; nothing created.
- EC-4: My own account email → refused with "You cannot grant access to
  yourself"; nothing created.
- EC-5: The recruiter already has active access or a pending invitation from
  me → refused with "This recruiter already has access" (or "already invited")
  and a pointer to the existing entry; nothing created, no email.
- EC-6: The account with that email is disabled → handled as "no recruiter
  account": an invitation is sent (US-002); the disabled account gains nothing
  until re-enabled and the invitation completed.
- EC-7: The account with that email exists but lacks the recruiter role → an
  invitation is sent (US-002); the email says a recruiter account is needed;
  the screen does not reveal that an account exists.
- EC-8: My session expired → redirected to sign-in; after sign-in the form is
  empty and nothing was created.
- EC-9: Signed in as recruiter only or admin without a candidate → the access
  section is not shown; a forged grant request is refused and nothing is
  created.
- EC-10: Double submit (two clicks or two tabs) → one active grant, one email;
  the second attempt shows EC-5.
- EC-11: Connection lost after submit → on reload the list shows the grant if
  it was created; resubmitting shows EC-5, never a second grant.
- EC-12: Email delivery fails → the grant still exists; the list shows it
  active; the failure is recorded for administrators.
- EC-13: Daily cap reached → refused per US-025.
- EC-14: End date today or in the past → field error "Choose a future date";
  nothing created.
- EC-15: Zero recruiters before → the list goes from its empty state ("No one
  has access to your profile") to one entry; with 20 or more active entries the
  list stays readable, sorted by grant date, newest first.

### US-002: Invite a recruiter who has no account

**As a** candidate, **I want** to invite a recruiter who has never used
master-jobs, **so that** they can create an account and follow me.

Acceptance criteria:

- AC-1: Given no enabled recruiter account with that email, when I confirm the
  grant, then my list shows the email under "Pending invitations" with the
  sent date and "Link valid until <date>" (7 days later).
- AC-2: Given AC-1, then the recruiter receives an invitation email in my
  account's language, naming me, stating the scope, the link's validity and
  that the account must use this same email.
- AC-3: Given AC-1, then my history shows "Invitation sent to <email>".
- AC-4: Given a pending invitation, then the recruiter has no access to
  anything of mine until US-003 completes.

Edge cases:

- EC-1: Malformed, blank, own email → same as US-001 EC-1, EC-3, EC-4.
- EC-2: Pending invitation already exists for that email → refused, pointing
  to "Resend" (US-009); no email.
- EC-3: Email delivery fails → the invitation stays pending, marked "Email not
  delivered — resend"; the failure is recorded for administrators.
- EC-4: 20 pending invitations already → refused with "Too many pending
  invitations; cancel one first".
- EC-5: Daily cap reached → refused per US-025.
- EC-6: Same email invited by two different candidates → two independent
  invitations; each recruiter-side completion grants only the candidate whose
  link was used, and confirming the account also completes any other valid
  invitation addressed to that same verified email (each candidate consented
  to that address).
- EC-7: Invitation sent, then the recruiter signs up on their own (not via the
  link) with that email → the pending invitation completes when the account is
  confirmed with the verified email, as if the link had been used; the access
  granted email is sent.
- EC-8: Double submit → one invitation, one email.

### US-003: Accept the invitation by signing up with the invited email

**As an** invited recruiter without an account, **I want** to follow the link,
create my account and see the candidate, **so that** I can start helping them.

Acceptance criteria:

- AC-1: Given a valid invitation link, when I open it, then I land on the #464
  sign-up screen with Recruiter preselected, a line naming the candidate who
  invited me, and the invited email shown as the expected address.
- AC-2: Given AC-1, when I sign up with Google or LinkedIn whose verified email
  equals the invited email, then my account is created, access starts, and I
  land on the candidate's page in my workspace.
- AC-3: Given AC-1, when I sign up manually with the invited email and confirm
  the emailed code, then the same happens.
- AC-4: Given AC-2 or AC-3, then the invitation is used: the candidate's list
  moves me from "Pending invitations" to "Active", the history shows
  "Invitation accepted by <email>", and I receive the access-granted email.
- AC-5: Given I already have a recruiter account with the invited email, when
  I open the link, then I am asked to sign in (or, if signed in with that
  email, access starts at once) and I land on the candidate's page.

Edge cases:

- EC-1: Expired link (over 7 days) → neutral page "This invitation is no
  longer valid. Ask the candidate to send a new one."; no account change.
- EC-2: Link already used, superseded by a resend, or cancelled → same neutral
  page.
- EC-3: Tampered or unknown token → same neutral page; nothing reveals whether
  an invitation existed.
- EC-4: I open the link but abandon sign-up → nothing is created; the link
  stays usable until it expires.
- EC-5: The link expires or is cancelled while I am filling the sign-up form →
  the account is created if I finish (sign-up is open), but no access is
  granted, and the landing page says the invitation is no longer valid.
- EC-6: Signed in as another account (different email) when opening the link
  → message "This invitation is for <masked email>. Sign out to continue.";
  no access granted to the current account.
- EC-7: Signed in with the invited email but without the recruiter role (for
  instance, a candidate account) → message that the invitation needs a
  recruiter account; no access; the candidate is not told why.
- EC-8: Opening the link twice in two tabs and completing both → one account,
  one access; the second completion sees the used link (EC-2).
- EC-9: The candidate revoked the invitation before completion → EC-5
  behavior; the history shows the cancellation, not an acceptance.
- EC-10: The candidate's account is disabled or deleted before completion →
  neutral invalid page; no access.
- EC-11: Sign-up cap of #464 reached → #464 message; the invitation remains
  valid until it expires.

### US-004: Invitation completed with another email grants nothing

**As a** candidate, **I want** my invitation to work only for the address I
typed, **so that** a forwarded link never gives my data to someone else.

Acceptance criteria:

- AC-1: Given a valid invitation for `a@x.com`, when someone completes sign-up
  through the link with `b@y.com`, then a recruiter account for `b@y.com` is
  created (sign-up is open) but it gets no access to me.
- AC-2: Given AC-1, then the landing page says "This invitation was sent to a
  different email; ask the candidate to invite this address" without showing
  the candidate's data.
- AC-3: Given AC-1, then the invitation stays pending for `a@x.com` until it
  expires, is used correctly or is cancelled.

Edge cases:

- EC-1: Same address with different case or spaces → treated as equal (the
  invitation completes).
- EC-2: Provider email not verified → #464 refuses sign-up; nothing created.
- EC-3: Gmail dot or plus variants (`a.b+x@gmail.com` vs `ab@gmail.com`) →
  treated as different; no access.
- EC-4: Repeated attempts with wrong emails → each creates nothing beyond the
  #464 sign-up rules (IP cap applies).

### US-005: Be told about a new access and find the candidate

**As a** recruiter with an account, **I want** to learn that a candidate gave
me access and reach their page, **so that** I do not miss it.

Acceptance criteria:

- AC-1: Given a candidate grants me access, then I receive an email with the
  candidate's name, the scope, the end date if any, and a link to their page.
- AC-2: Given AC-1, when I open `/recruiter`, then the candidate is listed with
  "Access since <date>" and, if set, "Until <date>".
- AC-3: Given I had the #464 empty state, when the first access arrives, then
  the empty state is replaced by the list.

Edge cases:

- EC-1: I open the email link while signed out → sign-in, then the candidate's
  page.
- EC-2: I open the email link after access already ended → 404 page identical
  to any unknown candidate.
- EC-3: Email not delivered → the candidate still appears in my list.
- EC-4: I hold access from 50 candidates → the list paginates and sorts by
  candidate name; each entry is reachable.

### US-006: Set, change or remove an optional end date

**As a** candidate, **I want** to give access only until a date, **so that** it
closes on its own when an engagement ends.

Acceptance criteria:

- AC-1: Given the grant form, when I leave the end date empty, then access has
  no end and the list shows "No end date".
- AC-2: Given the grant form, when I choose a future date, then access ends at
  the end of that date (23:59 in the time zone shown next to the field) and the
  list shows the exact end.
- AC-3: Given an active grant, when I edit its end date (set, move or clear),
  then the change applies at once, the history records it, and the recruiter
  receives an email stating the new end (or that it no longer ends).
- AC-4: Given a pending invitation with an end date, when the recruiter
  accepts after part of the period passed, then access still ends on the
  chosen date.

Edge cases:

- EC-1: Date today or in the past, or unparseable → field error; nothing
  changes.
- EC-2: Date more than 5 years ahead → field error "Choose a date within 5
  years".
- EC-3: Editing the end date of a grant that ended meanwhile (stale screen) →
  refused with "This access has already ended"; the list refreshes.
- EC-4: The invitation's link expires before the end date and the recruiter
  never accepted → nothing to end; history shows the invitation expired.
- EC-5: End date that falls before the recruiter accepts → acceptance grants
  nothing and the landing page says the access period is over.
- EC-6: Same edit submitted twice → one change, one history entry, one email.

## Managing

### US-007: See who has access and which invitations are pending

**As a** candidate, **I want** one list of everyone who can see my data,
**so that** I know with whom it is shared (LGPD art. 18 VII).

Acceptance criteria:

- AC-1: Given active grants, then each entry shows the recruiter's name (if the
  account has one) and email, granted on, end date or "No end date", and last
  access ("Never" until the first visit).
- AC-2: Given pending invitations, then each shows the email, sent on, link
  valid until, and delivery problems if any.
- AC-3: Given the recruiter opens my funnel or CV, then my list shows the new
  last-access time on my next load.

Edge cases:

- EC-1: No grants and no invitations → empty state explaining what access is
  and the grant form.
- EC-2: Recruiter account renamed → the list shows the current name.
- EC-3: Recruiter account deleted → the entry leaves the active list; the
  history keeps the email and the end reason "account removed".
- EC-4: Recruiter account disabled → the entry stays active but marked
  "Account disabled"; the recruiter cannot sign in; I can still revoke.
- EC-5: Names and emails are shown as user content, never interpreted as
  markup.
- EC-6: Recruiter role removed from the account by an administrator → access
  stops working at once; entry marked "No longer a recruiter"; I can revoke.
- EC-7: Viewed at 375 px → every column remains readable, actions reachable.

### US-008: Revoke a recruiter's access immediately

**As a** candidate, **I want** to take access back in one action, **so that**
withdrawing consent is as easy as giving it.

Acceptance criteria:

- AC-1: Given an active grant, when I choose "Revoke" and confirm, then the
  entry leaves the active list and the history shows "Access revoked by you".
- AC-2: Given AC-1, when the recruiter makes their next request to any of my
  pages or my CV, then they get the same 404 as for an unknown candidate, and I
  disappear from their `/recruiter` list.
- AC-3: Given AC-1, then the recruiter receives an "access ended" email saying
  the candidate revoked it, without a reason.
- AC-4: Given AC-1, then the recruiter's suggestions stay with me: pending ones
  remain pending and I can still accept or decline them.

Edge cases:

- EC-1: Revoke clicked twice or in two tabs → one revocation, one email; the
  second sees "Already ended".
- EC-2: The recruiter is loading my CV at the moment of revocation → requests
  after the revocation are denied; a request authorized before it may finish.
- EC-3: Cancel on the confirmation dialog → nothing changes.
- EC-4: Revoking an access that expired a moment earlier → shown as already
  ended; no second email.
- EC-5: Email delivery fails → revocation still holds; failure recorded.
- EC-6: Session expired at click time → sign-in; access unchanged until I
  revoke again.
- EC-7: A forged request to revoke another candidate's grant → refused;
  nothing changes (the grant is looked up within my own candidate only).

### US-009: Resend or cancel a pending invitation

**As a** candidate, **I want** to resend an invitation the recruiter missed or
cancel one I no longer want, **so that** pending invitations reflect my
decision.

Acceptance criteria:

- AC-1: Given a pending invitation, when I choose "Resend", then a new email
  goes out with a new link valid for 7 days, the previous link stops working,
  and the list shows the new validity.
- AC-2: Given a pending invitation, when I choose "Cancel invitation" and
  confirm, then it leaves the list, its link shows the neutral invalid page,
  and the history records "Invitation cancelled".
- AC-3: Given an expired invitation, then it appears as "Expired" with a
  "Resend" option until I dismiss it; the history records the expiry.

Edge cases:

- EC-1: Resend counts against the daily cap (US-025).
- EC-2: Cancel while the recruiter is completing sign-up → per US-003 EC-5, no
  access.
- EC-3: Resend after the recruiter already accepted (stale screen) → refused
  with "This recruiter already has access"; list refreshes.
- EC-4: Cancel twice → one cancellation.
- EC-5: Cancelled invitation → the recruiter receives no email.

### US-010: Access ends at the end date

**As a** recruiter with an account, **I want** access to end exactly when the
candidate set it, **so that** both of us know where we stand.

Acceptance criteria:

- AC-1: Given an end date, when that moment passes, then my next request to the
  candidate's pages or CV returns 404 and the candidate leaves my list.
- AC-2: Given AC-1, then I receive an "access ended" email saying the access
  period ended, and the candidate's history records "Access expired".
- AC-3: Given AC-1, then my pending suggestions stay with the candidate.

Edge cases:

- EC-1: The expiry email job runs late → access is already denied at request
  time; the email arrives later.
- EC-2: The candidate extends the end date before it passes → access continues;
  no "ended" email.
- EC-3: The candidate extends after it passed → refused; a new grant is needed
  (US-011).
- EC-4: Many grants expiring at the same moment → each ends and emails once.

### US-011: Grant the same recruiter again after access ended

**As a** candidate, **I want** to grant access again to someone I revoked,
**so that** a mistake or a new engagement is easy to handle.

Acceptance criteria:

- AC-1: Given an ended grant (revoked or expired), when I grant the same email
  again, then a new grant starts (or a new invitation if they have no recruiter
  account) with today's date, the new optional end date and a new
  access-granted email.
- AC-2: Given AC-1, then the history shows the earlier grant and its end, then
  the new grant, as separate entries.

Edge cases:

- EC-1: The earlier end date does not carry over.
- EC-2: Grant again while one is active or pending → refused (US-001 EC-5).
- EC-3: Grant again after an administrator revoked → allowed; it is the
  candidate's decision; history shows both.
- EC-4: Counts against the daily cap.

### US-012: See the history of grants, revocations and suggestions

**As a** candidate, **I want** a history of every sharing decision, **so that**
I can answer who has seen my data and when.

Acceptance criteria:

- AC-1: Given any event — invitation sent, resent, cancelled, expired,
  accepted, accepted with another email (not shown: nothing happened to my
  data), grant, end date changed, revocation (by me or by an administrator),
  access expiry, suggestion received, accepted, declined — then the history
  shows it with date, time, the recruiter's email, and who acted.
- AC-2: Given the history, then entries are newest first and paginated.

Edge cases:

- EC-1: No events → "Nothing shared yet".
- EC-2: Hundreds of events → paginated; first page loads as fast as the
  account page.
- EC-3: Recruiter account later removed → entries keep the email.
- EC-4: Entries cannot be edited or deleted by anyone through the product.
- EC-5: Administrator impersonating me → sees the history read-only.

## Recruiter view

### US-013: Choose a candidate from the list; the name is in the page title

**As a** recruiter with an account following several candidates, **I want** to
pick a candidate from my list, **so that** I always know whose data I am
looking at.

Acceptance criteria:

- AC-1: Given access from several candidates, when I open `/recruiter`, then I
  see each candidate's name, access since, end date if any, and the number of
  my pending suggestions to them.
- AC-2: Given I open a candidate, then the page title and the browser tab
  include that candidate's name.

Edge cases:

- EC-1: No candidate → the #464 empty state (US-015 there).
- EC-2: Candidate without a display name → a neutral label ("Candidate") plus
  the profile headline if any; never their email.
- EC-3: A candidate's access ends while my list is open → the entry is gone on
  the next load; following its link gives 404.
- EC-4: Candidate names with markup → rendered as text.
- EC-5: 375 px → list usable.

### US-014: Read the candidate's funnel, read-only

**As a** recruiter with an account, **I want** to see the candidate's funnel as
today, **so that** I know where their search stands.

Acceptance criteria:

- AC-1: Given access, then the candidate page shows funnel counts per stage and
  the list (title, company, status, applied date, closed/archived marker),
  paginated, as today.
- AC-2: Given AC-1, then there is no control to change status, add or remove
  funnel entries, or edit notes.
- AC-3: Given AC-1, then opening the page updates the candidate's "last
  access" for me.

Edge cases:

- EC-1: Empty funnel → "No applications yet".
- EC-2: Page number out of range or non-numeric → first or last valid page.
- EC-3: Forged write requests (status change, note) for that candidate → refused
  by the authorization policy; nothing changes.
- EC-4: Funnel with 1,000 entries → paginated as today.
- EC-5: A job link opened from the funnel → shows the job, never the
  candidate's score, notes or analyses for it.

### US-015: Read the candidate's current CV

**As a** recruiter with an account, **I want** to read the candidate's current
CV, **so that** I can evaluate and present them.

Acceptance criteria:

- AC-1: Given access and a CV, then the candidate page offers "View CV", which
  shows the current version as uploaded (PDF view and download, or the pasted
  text).
- AC-2: Given the candidate uploads a new version, then my next view shows the
  new one; earlier versions are never listed.
- AC-3: Given I open the CV, then the candidate's "last access" updates.

Edge cases:

- EC-1: Candidate without a CV → "No CV yet"; no broken link.
- EC-2: Direct link to an earlier version or another candidate's CV → 404.
- EC-3: Access revoked while the CV page is open → download or refresh after
  revocation returns 404.
- EC-4: CV file missing from storage → "CV unavailable", no error details.
- EC-5: Large CV (at the onboarding size limit) → loads; no truncation of the
  file.
- EC-6: Downloaded file name includes the candidate's name, not internal ids.

### US-016: Never reach private data or other candidates

**As a** candidate, **I want** a recruiter with access to see only the agreed
scope, **so that** my private reasoning stays mine.

Acceptance criteria:

- AC-1: Given a recruiter with access, then no page, download, export or API
  available to them shows my notes, salary floor, profile contact fields,
  score explanations, fit analyses, dossiers, mail suggestions or earlier CV
  versions.
- AC-2: Given a recruiter, when they request any page of a candidate who did
  not grant them access, then they get the same 404 as for a nonexistent id.

Edge cases:

- EC-1: Malformed or negative candidate ids in the URL → 404.
- EC-2: `/api/export` or any export endpoint called by a recruiter → no data of
  followed candidates beyond the agreed scope.
- EC-3: A recruiter who is also a candidate (two roles) → each data set stays
  in its own scope; their own candidate data is never shared by holding the
  recruiter role.
- EC-4: Public profile `/p/[slug]` rules unchanged: still the allowlist only
  (G21–G23).

### US-017: Lose access on revocation and be told

**As a** recruiter with an account, **I want** to know when a candidate ends my
access, **so that** I stop relying on it.

Acceptance criteria:

- AC-1: Given the candidate revokes, then I receive an email saying access
  ended because the candidate revoked it, and the candidate disappears from my
  list.
- AC-2: Given an administrator revokes, then the email says access was ended
  by the service administration.
- AC-3: Given access ended, then my suggestions to that candidate are no longer
  visible to me.

Edge cases:

- EC-1: I am on the candidate page when access ends → next navigation gives
  404; no partial data is served after the end.
- EC-2: Email not delivered → access still ended.
- EC-3: Access ended and granted again later → my earlier suggestions stay
  hidden; I see only suggestions from the new grant.

## Suggestions

### US-018: Suggest a job to a candidate

**As a** recruiter with an account, **I want** to suggest a job to a candidate I
follow, **so that** they consider an opportunity I know about.

Acceptance criteria:

- AC-1: Given access, when I choose "Suggest a job" on the candidate page,
  then I can pick a job from the catalog by searching title or company, or
  register a new job with the existing recruiter job form, and add an optional
  note (up to 500 characters).
- AC-2: Given I submit, then the suggestion appears in my suggestion list for
  that candidate as "Pending", and the candidate receives an email.
- AC-3: Given AC-2, then the candidate's funnel does not change.

Edge cases:

- EC-1: Note over 500 characters → field error; note kept.
- EC-2: Note with markup or links → shown as plain text to the candidate.
- EC-3: Same job already pending from me to that candidate → refused with
  "Already suggested"; no second email.
- EC-4: Same job pending from another recruiter → allowed; the candidate sees
  both recruiters on one suggestion entry.
- EC-5: The job is already in the candidate's funnel → allowed without
  revealing that it is (the funnel status is visible to me anyway); on accept
  nothing changes in the funnel (US-021 EC-2).
- EC-6: Closed or archived job → refused with "This job is closed".
- EC-7: Access ends between opening the form and submitting → refused with
  404; nothing created.
- EC-8: 20 suggestions to this candidate in 24 hours → refused with a message
  saying when I can suggest again.
- EC-9: Double submit → one suggestion, one email.
- EC-10: New job registration fails validation → form errors as today; no
  suggestion created.
- EC-11: Email delivery fails → the suggestion exists; failure recorded.

### US-019: Follow the state of my suggestions

**As a** recruiter with an account, **I want** to see what the candidate did
with my suggestions, **so that** I can follow up.

Acceptance criteria:

- AC-1: Given suggestions to a candidate, then their page lists my suggestions
  with job, date, and state (Pending, Accepted, Declined, with decision date).
- AC-2: Given the candidate declines, then I see "Declined" without any reason.

Edge cases:

- EC-1: No suggestions → "You have not suggested jobs yet".
- EC-2: Suggestions by other recruiters → never shown to me.
- EC-3: Hundreds of suggestions → paginated, newest first.
- EC-4: Suggested job later closed → shown with a "Closed" marker.

### US-020: Be told about and review pending suggestions

**As a** candidate, **I want** to learn about new suggestions and review them in
one place, **so that** I decide on each.

Acceptance criteria:

- AC-1: Given a new suggestion, then I receive an email naming the recruiter
  and the job with a link to my suggestions.
- AC-2: Given pending suggestions, then a "Suggestions" view lists each with
  the job, company, my score for it, the recruiter(s), note(s) and date, with
  "Accept" and "Decline".
- AC-3: Given pending suggestions, then the navigation shows their count.

Edge cases:

- EC-1: No suggestions → empty state explaining where suggestions come from.
- EC-2: Suggestion from a recruiter whose access ended → still listed, marked
  "Access ended"; I can still decide.
- EC-3: Suggested job closed after the suggestion → listed with "Closed";
  accept still allowed, as with any closed job in the funnel.
- EC-4: 100 pending suggestions → paginated.
- EC-5: Email notices for many suggestions in a short time → at most one email
  per recruiter per hour, listing all suggestions in that window.
- EC-6: Administrator impersonating me → sees suggestions, cannot accept or
  decline.

### US-021: Accept a suggestion into the funnel

**As a** candidate, **I want** to accept a suggestion, **so that** the job
enters my funnel by my own decision.

Acceptance criteria:

- AC-1: Given a pending suggestion, when I accept, then the job enters my funnel
  in the first stage (Backlog), the suggestion shows "Accepted", the
  recruiter(s) see "Accepted", and the history records it.
- AC-2: Given AC-1, then the funnel entry shows it came from a recruiter
  suggestion.

Edge cases:

- EC-1: Accept twice or in two tabs → one funnel entry.
- EC-2: Job already in my funnel → suggestion marked "Accepted"; the funnel
  entry keeps its current status.
- EC-3: Suggestion already declined (stale screen) → refused with "Already
  decided".
- EC-4: Recruiter's access ended → accept still works.
- EC-5: Forged accept for another candidate's suggestion → refused.

### US-022: Decline a suggestion

**As a** candidate, **I want** to decline a suggestion, **so that** it leaves my
list without touching my funnel.

Acceptance criteria:

- AC-1: Given a pending suggestion, when I decline, then it leaves the pending
  list, the recruiter sees "Declined", the history records it, and the funnel
  does not change.

Edge cases:

- EC-1: Decline twice → one decision.
- EC-2: Already accepted → refused with "Already decided".
- EC-3: The same recruiter suggests the same job again after a decline →
  refused with "The candidate already decided on this job".
- EC-4: Forged decline for another candidate → refused.

## Administration

### US-023: Revoke an access or cancel an invitation

**As an** administrator, **I want** to end an access or cancel an invitation,
**so that** I can stop abuse or a mistake.

Acceptance criteria:

- AC-1: Given the administration area, then I see active grants and pending
  invitations per candidate, with dates and end dates.
- AC-2: When I revoke a grant, then the same effects as US-008 apply, the
  recruiter's email says the service administration ended it, and the
  candidate's history shows "Revoked by an administrator (<my name>)".
- AC-3: When I cancel an invitation, then the same effects as US-009 AC-2
  apply, recorded as by an administrator.

Edge cases:

- EC-1: Revoke an already ended grant → "Already ended".
- EC-2: Not an administrator → the area and action are refused.
- EC-3: Concurrent revocation by the candidate and me → one end, one email;
  the history records whichever happened first.

### US-024: Never grant access, including while impersonating

**As an** administrator, **I want** the product to stop me from granting access
for someone, **so that** consent always comes from the candidate (G25).

Acceptance criteria:

- AC-1: Given the administration area, then there is no grant or invite action.
- AC-2: Given I impersonate a candidate, then the access page is read-only: no
  grant, revoke, resend, cancel or end-date controls, and forged requests are
  refused.
- AC-3: Given the CLI, then no command grants or invites; listing grants and
  revoking may exist with the same rules as the web.

Edge cases:

- EC-1: A forged grant request with a candidate id → refused; no grant (the
  candidate is always taken from the session).
- EC-2: An administrator who is also a candidate grants on their own profile
  outside impersonation → allowed as a candidate.

## Limits

### US-025: Invitation and grant caps protect against abuse

**As a** candidate, **I want** the product to limit how many invitations can be
sent from my account, **so that** it cannot be used to spam people.

Acceptance criteria:

- AC-1: Given 10 grants, invitations and resends in the last 24 hours, when I
  try another, then it is refused with "Limit reached; try again after
  <time>", and nothing is sent.
- AC-2: Given the oldest of those leaves the 24-hour window, then I can grant
  again.

Edge cases:

- EC-1: Revocations and cancellations do not count.
- EC-2: Concurrent requests at the limit → never more than 10 within the
  window.
- EC-3: Refused attempts do not count.
- EC-4: Administrator-side actions never count against the candidate.
