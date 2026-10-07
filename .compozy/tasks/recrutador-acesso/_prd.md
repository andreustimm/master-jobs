# Candidate Grants and Revokes Recruiter Access

Issue: #465. Depends on #464 (social sign-in, self-sign-up, recruiter empty
state, transactional email channel). Decisions by the owner on 2026-10-06;
values left open were decided by the agent under the goal of the same date
(ADR-006 to ADR-008).

## Overview

A recruiter in master-jobs reads only the candidates linked to them. The link
exists in the data model, but nobody can create it from the product: only
tests create links, and only an administrator removes them. Since #464, anyone
with a verified email can sign up as a recruiter, and that account stays empty
because rule G25 says only the candidate creates the link.

This feature gives the candidate that control. From their account page the
candidate grants a recruiter access by email. A recruiter who already has an
account gets access immediately. Anyone else gets an invitation that becomes
access only when they sign up with that same, verified email. The grant shows
the candidate's funnel read-only and their current CV, and lets the recruiter
suggest jobs. A suggestion enters the funnel only when the candidate accepts
it. Access has no end unless the candidate sets one. The candidate can revoke
at any moment, and the cut takes effect on the recruiter's next request. Both
parties are notified by email, and the candidate sees who has access, when
each recruiter last looked, and the full history of sharing decisions.

The grant becomes the only way for a recruiter to see a non-public profile.
Today a profile set to the "Recruiters" visibility can be read by any
authenticated recruiter. With open recruiter sign-up, that means anyone who
signs up. The option is removed: profiles keep only Private and Public, those
on "Recruiters" become Private, and their candidates are told on the account
page that recruiters now get access by invitation (ADR-010).

It serves candidates who work with a recruiter or career coach and want help
without handing over their private reasoning (notes, salary floor, contacts,
analyses), and recruiters who need a clear, consented view of the people they
represent. Unlike agency tools where the agency owns the candidate record, here
the candidate owns the data and decides, recipient by recipient, who sees it.
That ownership matches what LGPD and GDPR ask of consent (specific, recorded,
revocable as easily as given).

## Goals

- A candidate grants a named recruiter access to their funnel and current CV
  from their account page, without an administrator.
- A recruiter without an account can join through an invitation, and the
  access reaches only the email address the candidate typed, after that
  address is verified.
- A recruiter with access sees the funnel read-only and the current CV, and
  can suggest jobs. Notes, salary floor, profile contacts, private analyses
  and earlier CV versions stay out of their reach.
- Only the candidate's decision changes the funnel: suggestions wait for
  acceptance.
- The candidate can end access at any time, or schedule its end. The cut takes
  effect on the recruiter's next request, and nothing the candidate received
  is lost.
- The candidate can always answer "who can see my data, who has seen it, and
  since when".
- Administrators can still cut an access, and the product makes it impossible
  for anyone but the candidate to create one.
- A recruiter reads a non-public profile only through an active grant from
  that candidate; no profile setting opens it to every recruiter.

## User Stories

- US-001 – US-006: granting by email, invitation for recruiters without an
  account, email binding, recruiter notice, optional end date.
- US-007 – US-012: the candidate's access list, revocation, invitation resend
  and cancel, expiry, re-granting, history.
- US-013 – US-017: the recruiter's view: candidate list, funnel, current CV,
  privacy boundary, loss of access.
- US-018 – US-022: job suggestions from recruiter to candidate and the
  candidate's decision.
- US-023 – US-024: administration: revoke only, never grant.
- US-025: abuse limits.
- US-026: removal of the "Recruiters" profile visibility.

[Full user stories](_user_stories.md)

## Core Features

### F1. Grant by email (account page)

- A "Recruiter access" section on the candidate's account page with: the grant
  form (email, optional end date), a plain-language statement of the scope
  (what is shared, what never is, and that the CV is shared as uploaded), the
  access list, pending invitations and the history.
- Granting resolves the email:
  1. An enabled account with the recruiter role and that verified email exists
     → access starts now; "access granted" email to the recruiter.
  2. Otherwise → invitation (F2).
- One active grant or pending invitation per candidate and email.

### F2. Invitation for recruiters without an account

- Invitation email with a single-use link valid for 7 days, naming the
  candidate, the scope and the address the account must use.
- The link opens the #464 sign-up screen with Recruiter preselected and a line
  naming the inviting candidate. Social and manual paths both work.
- Access starts when the account is confirmed with the invited email (provider
  verified or code confirmed). Any other email creates the account without
  access.
- An existing recruiter account with the invited email can accept by signing
  in through the link.
- A recruiter account confirmed with the invited email by any path (even
  without the link) completes every still-valid invitation to that address.
- Resend issues a new link and voids the old one; cancel voids it.

### F3. Recruiter workspace

- `/recruiter` lists every candidate who granted access, with access since,
  end date and the count of the recruiter's pending suggestions. A recruiter
  with several candidates picks one there.
- The candidate page shows the candidate's name in the title, the funnel
  read-only (as today), "View CV" for the current version, the recruiter's own
  suggestions and "Suggest a job".
- Outside an active grant, every candidate page and CV returns the same 404 as
  a nonexistent candidate.

### F4. Job suggestions

- The recruiter suggests a catalog job or registers a new one through the
  existing recruiter job form, with an optional note.
- The candidate gets an email and a "Suggestions" view with pending items
  (job, company, the candidate's score, recruiter(s), notes, date) and Accept
  / Decline.
- Accept puts the job in the funnel at Backlog, marked as suggested by a
  recruiter. Decline leaves the funnel untouched. Both are final and visible
  to the suggesting recruiter as state only.

### F5. End of access

- Revocation by the candidate, from the access list, with confirmation.
- Optional end date, editable while access is active; expiry acts like a
  revocation.
- Revocation by an administrator (F7).
- All three cut access on the recruiter's next request, notify the recruiter,
  and keep suggestions with the candidate.

### F6. Notices and history

- Emails to the recruiter: invitation, access granted, end date changed,
  access ended (revoked by candidate, revoked by administration, expired).
- Email to the candidate: new suggestion (grouped per recruiter per hour).
- Access list with last access; append-only history of every sharing event.

### F7. Administration

- Administrators see grants and invitations per candidate, revoke grants and
  cancel invitations, with the administrator's name recorded.
- No grant or invite action for administrators in the web or the CLI;
  impersonated sessions see the candidate's access page read-only.

### F8. Removal of the "Recruiters" visibility

- The candidate page offers only Private and Public.
- Profiles on "Recruiters" become Private. Recruiters who read them without a
  grant start getting 404.
- Affected candidates see a notice in the Recruiter access section of the
  account page pointing to the invitation (F1).

### Interactions

- F1 creates either a grant (F3 opens to the recruiter) or an invitation (F2),
  and every step writes to F6's history.
- F2 depends on #464's sign-up screen and verified-email rules.
- F4 depends on an active grant to create suggestions. The candidate can still
  decide on them after F5 ends the grant.
- F7 uses F5's end-of-access rules.

## Business Rules

### Ownership and consent

- Only the candidate, in their own non-impersonated session, creates a grant or
  an invitation. The candidate is always the one in the session, never an id
  from the request (G25, G39/G40).
- A grant names one recruiter email. It is consent for that address only.
- Sign-up alone never creates access. Access exists only through a grant or a
  completed invitation from the candidate.
- At most one active grant or pending invitation per (candidate, normalized
  email).
- A candidate cannot grant access to their own account.

### Matching the recruiter

- Emails are compared after trimming and lower-casing; no provider-specific
  rewriting (dots, plus tags).
- Immediate grant requires an enabled account with the recruiter role whose
  email is verified. Every other case becomes an invitation. The screen shows
  only "Active" or "Invitation sent", never why.
- An invitation completes only when an account with the recruiter role is
  confirmed (or signed in) with the invited email, verified, while the
  invitation is valid and the candidate's account is enabled.

### Scope of access

- Visible to a recruiter with an active grant: candidate display name and
  headline; funnel counts and entries (job title, company, status, applied
  date, closed/archived marker); the current CV version as uploaded (view and
  download); their own suggestions and their states.
- Never visible to recruiters: candidate notes, salary floor, profile contact
  fields, score explanations, fit analyses, dossiers, interview preparation,
  mail suggestions, earlier CV versions, other recruiters' suggestions, and the
  candidate's access list or history.
- Job pages reached from the recruiter view show the job as in the catalog,
  never the followed candidate's score, notes or analyses.
- Recruiters never write candidate data: no funnel moves, no notes, no CV or
  profile edits.
- Public profile rules (`/p/[slug]`, G21–G23) are unchanged.

### Profile visibility

- Profile visibility has two values: Private and Public. "Recruiters" no
  longer exists and is not offered on the candidate page.
- Profiles set to "Recruiters" become Private. Public profiles do not change.
- No visibility grants recruiters anything. A recruiter reads a non-public
  candidate only through an active grant. Without one, the recruiter gets the
  same 404 as for an unknown candidate. Any recruiter, like anyone else, can
  read a Public profile through `/p/[slug]`.
- A stored or requested `recruiters` value after the change is treated as
  Private, never as Public.
- Each candidate moved from "Recruiters" to Private sees a notice on the
  account page, in the Recruiter access section, until dismissed. The notice
  says the profile is now Private and recruiters get access by invitation. No
  email is sent about this change.

### Lifecycle

- Invitation states: pending → accepted | expired | cancelled (by candidate or
  administrator) | superseded (by a resend). Only pending can change.
- Grant states: active → revoked (by candidate or administrator) | expired |
  ended by account removal. Ended grants never reactivate. Granting again
  creates a new grant.
- Access is evaluated on every request: only active, unexpired grants of
  enabled recruiter accounts count. A grant whose recruiter loses the role or
  is disabled stops working at once, and the candidate's list shows it.
- Revocation, expiry and removal are forward-only. Data already seen is not
  recalled. Suggestions stay with the candidate. The recruiter stops seeing
  suggestions from an ended grant.

### Values and limits

- Invitation link: single use, valid **7 days**. A resend restarts the period
  and voids the previous link.
- End date: optional, a calendar date strictly after today and at most **5
  years** ahead. Access ends at 23:59 of that date in the time zone shown next
  to the field when it was set. Editable while active.
- Per candidate: at most **10** grants, invitations and resends together per
  rolling 24 hours; at most **20** pending invitations.
- Per recruiter: at most **20** suggestions per candidate per rolling 24 hours.
- Suggestion note: optional, plain text, up to **500** characters.
- Suggestion email to the candidate: at most one per recruiter per hour,
  grouping the suggestions of that hour.

### Suggestions

- A suggestion references one job, one candidate and the suggesting
  recruiter(s). A second recruiter suggesting the same pending job joins the
  same suggestion.
- States: pending → accepted | declined. Final.
- Accept: if the job is not in the funnel, it enters at Backlog marked "suggested
  by a recruiter". If it already is, the status stays as it is. Decline: no
  funnel change.
- The same recruiter cannot suggest a job that is pending or already decided
  for that candidate. Closed or archived jobs cannot be suggested.
- The candidate can decide on suggestions whose recruiter lost access.

### Permissions per persona

- Candidate: grant, invite, resend, cancel, set or change end date, revoke,
  see list and history, accept or decline suggestions, all on their own
  candidate only.
- Recruiter: read granted candidates within scope; suggest jobs; see own
  suggestions. Nothing else on candidates.
- Administrator: see grants and invitations; revoke; cancel. Never grant,
  invite, resend or change end dates. In impersonation, the candidate's access
  page and suggestions are read-only (G24).
- CLI operator: may list and revoke under the same rules; never grants or
  invites.

### Emails

- Recruiter: invitation, access granted, end date changed, access ended (with
  cause: candidate, administration, expiry). Candidate: new suggestion(s).
- Language: the recipient account's language, or the candidate's language for
  invitations to people without an account.
- Emails carry names, the action, dates and one link. They never carry the CV,
  funnel contents, notes or other private data.
- Delivery failure never blocks the action and is recorded for administrators.
  Outside production, emails go to the development sink (#464).
- Links in emails use the configured public origin. Invitation tokens are
  stored only as hashes, burned before access is created, and never logged in
  deployments (G17/G18).

### History and audit

- Recorded, append-only, per candidate: invitation sent, resent, cancelled (by
  whom), expired, accepted; grant created; end date set or changed; access
  revoked (by whom), expired, ended by account removal; suggestion received,
  accepted, declined. Each entry has time, recruiter email and actor.
- Last access per grant: the last time the recruiter opened that candidate's
  funnel or CV.
- History survives revocation and recruiter account removal (email kept). It
  is removed only with the candidate's account.

## User Experience

### Personas and goals

- Candidate: share with a trusted recruiter in a minute, know what is shared,
  take it back in one click.
- Invited recruiter without an account: go from email to the candidate's page
  in one sign-up.
- Recruiter with an account: see each candidate's state and CV, bring jobs.
- Administrator: cut an abusive or mistaken access.

### Primary flows

1. **Grant to an existing recruiter:** account page → Recruiter access → email
   (+ optional end date) → Grant → entry "Active" → recruiter gets email →
   recruiter opens `/recruiter` → candidate page.
2. **Invite a new recruiter:** account page → email → Grant → "Invitation
   sent" → recruiter opens the email → sign-up screen (Recruiter preselected,
   "Invited by <candidate>") → Google, LinkedIn or email + code with the same
   address → candidate page.
3. **Suggest and decide:** recruiter on candidate page → Suggest a job → pick
   or register job, note → candidate gets email → Suggestions → Accept (job in
   Backlog) or Decline → recruiter sees the state.
4. **Revoke:** account page → Revoke → confirm → entry leaves the list →
   recruiter gets email, next request 404.
5. **Expiry:** end date passes → access ends → recruiter email → history entry.
6. **Administrator:** administration → grants of a candidate → Revoke → both
   sides see it.

### UI considerations

- The scope statement is visible before the first grant and next to the form.
  It names what is shared, what never is, and that the CV goes as uploaded,
  including any contact written in it.
- Destructive actions (revoke, cancel invitation) ask for confirmation. Grant
  does not.
- Status words are always text, never color alone: Active, Invitation sent,
  Expired, Account disabled.
- Candidate names, recruiter names, emails and notes are user content,
  rendered as text.
- All text from the dictionary in Portuguese and English. Every screen works
  at 375 px, by keyboard and with screen readers. Controls carry test ids.
  New routes enter the E2E route list.

### Onboarding and discoverability

- The account page shows the Recruiter access section to every candidate,
  with an empty state explaining the feature.
- The #464 recruiter empty state keeps saying that candidates grant access,
  and now names the email the recruiter should give the candidate (their
  account email).
- The candidate's navigation shows the pending-suggestions count.

## High-Level Technical Constraints

- **G25:** only the candidate creates links; sign-up never points a new
  account at an existing candidate. Administrator revocation stays,
  administrator granting never exists (ADR-008).
- **Rules 14/15, G39/G40:** every new page and action requires a session and
  calls the guard first. The candidate comes from the session. Access is
  derived from the session's linked candidates, which include only active,
  unexpired grants. Invitation pages are public entries registered in the
  inventory and reveal nothing about invitations that are not valid.
- **G24:** impersonated sessions cannot grant, revoke, resend, cancel, change
  end dates, or accept or decline suggestions.
- **Rule 2:** suggestions never write the funnel. Only the candidate's accept
  does.
- **G16:** per-role end-to-end scenarios: candidate grants, revokes and
  decides; invited recruiter signs up; recruiter with account reads and
  suggests; recruiter after revocation gets 404; administrator revokes.
- **G17/G18, rule 16:** invitation tokens hashed, single use, burned before use,
  never logged in deployments. Email links use the configured origin.
- **G21–G23:** public profile unchanged. Funnel, contacts and salary floor
  never public.
- **G20:** any new relation declares its deletion behavior. History must
  survive recruiter removal.
- **Email:** reuse the #464 Resend channel and its localized builders and
  development sink.
- **Privacy (LGPD arts. 8 and 18 VII):** consent per recipient and scope,
  recorded; withdrawal as easy as consent and effective on the next request;
  the subject can see with whom data was shared.
- **Responsiveness:** a revocation or expiry is enforced on the recruiter's
  next request, never after a background delay.
- **Rules 9/10/11:** dictionary text, theme tokens, 375 px.
- **Visibility removal (ADR-010):** `can()` stops granting reads for the
  `recruiters` visibility. The visibility type, the candidate page options and
  the dictionary keys for "Recruiters" are removed together. Moving existing
  profiles from "Recruiters" to Private is a non-additive data migration: it
  is not applied automatically and waits for human review at promotion (ADR
  0028).
- **Docs (rule 23, ADR-009):** when the feature ships, `docs/product/vision.md`
  and `docs/product/personas.md` describe the recruiter as a user invited by
  the candidate (P2 is no longer "not a user"). `docs/qa/personas.md`
  ("Recrutadora convidada") and the QA journeys cover the invitation, the
  suggestion and the revocation.

## Non-Goals (Out of Scope)

- Recruiter-initiated access requests or searching for candidates.
- Per-recruiter permission levels or custom scopes. Every grant has the same
  scope.
- Recruiters editing the funnel, notes, profile or CV, or commenting on funnel
  entries.
- Showing notes, salary floor, profile contacts, private analyses or earlier CV
  versions to recruiters.
- Shareable links that grant access without a named email.
- Recruiter organizations, teams or agency-owned candidate records.
- A candidate switcher in the header. The `/recruiter` list is the switcher.
- Messaging between candidate and recruiter inside the product.
- Recalling data the recruiter already viewed or downloaded.
- Self-service role change from candidate to recruiter (a #464 non-goal).
- Changes to the public profile.

## Architecture Decision Records

- [ADR-001: Candidates grant access by the recruiter's email, with an invitation for people without an account](adrs/adr-001.md) — consent tied to a verified address.
- [ADR-002: Access scope is read-only funnel, current CV and job suggestions](adrs/adr-002.md) — what recruiters see and never see.
- [ADR-003: Job suggestions are pending proposals that only the candidate turns into funnel entries](adrs/adr-003.md) — rule 2 preserved; suggestions survive revocation.
- [ADR-004: Access has no end by default, takes an optional end date, and ends immediately on revocation or expiry](adrs/adr-004.md) — forward-only withdrawal.
- [ADR-005: Both parties are notified by email, and the candidate sees who has access and the full history](adrs/adr-005.md) — LGPD art. 18 VII.
- [ADR-006: Invitation links last 7 days and are single use; caps on invitations and suggestions](adrs/adr-006.md) — decided by the agent.
- [ADR-007: Re-granting needs new consent, and revoking a pending invitation kills it](adrs/adr-007.md) — decided by the agent.
- [ADR-008: Administrators can revoke access but never grant it](adrs/adr-008.md) — decided by the agent.
- [ADR-009: Recruiters become users invited by candidates, working from the existing candidate list](adrs/adr-009.md) — product positioning and docs update.
- [ADR-010: Remove the "Recruiters" profile visibility; access to recruiters is by invitation only](adrs/adr-010.md) — owner decision; non-additive migration reviewed at promotion.

## Open Questions

- **Time zone of the end date:** this PRD uses the time zone shown at the
  moment of setting it. The TechSpec should confirm whether the candidate's
  account has a stored time zone to use instead.
