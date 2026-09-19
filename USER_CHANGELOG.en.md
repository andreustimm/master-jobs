# What's New

What changes in Master Jobs with each release, explained in plain language.
This is the edition shown in the footer when the interface is in English.

For the complete technical history—module names, architecture decisions, and
the exact defect addressed by each fix—see `CHANGELOG.md`.

> **What does not belong here.** File paths, table names, database addresses,
> and environment variable names. Anyone with access to the system can open
> this history, so it describes the outcome for users, not how the system is
> assembled internally.

<!-- sem-nota-usuario: 1.0.1 internal change with no user-visible effect -->
<!-- sem-nota-usuario: 1.1.1 - 2026-08-22 internal change with no user-visible effect -->

<!-- sem-nota-usuario: 1.7.0 - 2026-09-16T17:56:44.121Z -->

## [Unreleased]

## [1.15.0] - 2026-09-19T18:03:52.117Z

### New

- On the jobs screen, choose which track the scores come from — the primary,
  an accepted track or all of them, with the track's name on each job.
- A minimum pay filter in any currency and period, with the conversion beside
  the original amount. Jobs with no pay disclosed or pay that cannot be
  compared appear marked, after the ones that reach the minimum, and can be
  hidden; the screen says how many fell below the minimum.
- The jobs screen search looks for the whole word in the title, company and
  description: "java" no longer brings "JavaScript". When it finds little, the
  screen offers to search the platforms for the term.
- A "brought by term" filter that shows the jobs a saved term brought and
  marks the new ones since your last visit.

- A new Searches screen: save a term, such as "Laravel", under a track, and
  the system looks for jobs with it on the registered platforms and repeats the
  search every day. The screen shows what each platform brought and how many
  jobs are new; pause, move, re-run or delete the term whenever you like.
- Create a track from the suggestion for a term and adjust its titles,
  keywords, seniority and pay ranges. If one field is refused, what you typed in
  the others stays in the form. Any track can become the primary, and an
  archived track can be restored.
- On a job's page, the score for each track appears side by side.
- Administrators follow the health of the searches per platform without seeing
  terms or candidates.

- Each person asks for up to 40 searches a day from the screen; past that, the
  term is saved and searches in the daily sweep. A paused term does not search,
  not even by hand.

- A "not interested" button on every job in the list and on the job page: the
  job leaves your lists and stays under "Archived". As long as you have not
  applied, you can restore it from there.

- Jobs from three new platforms: Jobicy, Workable (remote jobs in Brazil) and
  Hacker News' monthly "Who is hiring?" thread, written by the companies
  themselves. The terms saved in Searches look there too.

- Jobs straight from 28 companies that post on Lever and hire remotely from
  Brazil, such as CI&T, Oowlish, BriteCore, Ubiminds and Yuno.

### Improved

- Groundwork for searching more than one kind of job, each with its own
  yardstick. Fit scores are recalculated once in this version; the score you
  see is still the one for your main goal.

### Fixed

- An archived job that is posted again shows up in the job list again. Before,
  it counted as open but stayed hidden.

- Jobs that only accept applicants from certain countries, such as "United
  States only" or "Spain only", now show a blocker and leave "Worth applying
  today". Jobs whose list includes Brazil or Latin America stay as they were.

## [1.14.2] - 2026-09-19T13:44:44.288Z

### Fixed

- Hardening of failure alerting: the filter that keeps your data out of an
  error report now covers three fields that previously slipped through.
  Nothing changes on screen.

## [1.14.1] - 2026-09-19T13:22:18.417Z

### Fixed

- Internal hardening of the failure alerting added in this release: a problem
  in the alerting mechanism itself can no longer stop the system from
  starting. Nothing changes on screen.

## [1.14.0] - 2026-09-19T03:29:37.809Z

### Added

- When a screen fails, the system now alerts the people who maintain it on its
  own. Until now a failure was only discovered when someone tried to use the
  product and could not. The alert carries what is needed to find the problem —
  the screen where it happened and the technical error — and does **not** carry
  what you typed, what you searched for, your sign-in details, or the contents
  of your résumé.

## [1.13.2] - 2026-09-19T02:38:58.911Z

### Fixed

- After the latest update, every screen showing jobs, the pipeline, or the
  sign-in form stopped opening and returned an error. The database connection
  was being refused by a safety requirement that was too rigid: it also
  rejected settings that **raise** protection, not only those that lower it.
  It now rejects only what genuinely weakens security. The screens are back,
  and no data was lost or changed during the outage.

## [1.13.1] - 2026-09-18T19:54:03.273Z

### Fixed

- Opening the pipeline on a page that does not exist no longer claims you have
  no applications. The list now falls back to the last page with content.

## [1.13.0] - 2026-09-18T19:00:08.565Z

### New

- Recruiters now have an area of their own, listing the people who authorised
  them to follow a pipeline. That authorisation is created by the candidate, and
  a recruiter sees only the progress — never the pipeline of someone who did not
  authorise them.

## [1.12.0] - 2026-09-18T18:01:07.970Z

### Improved

- Publishing the system now uses the database configuration the provider
  already maintains, instead of requiring a manual copy that goes stale. When
  the database password is rotated on the provider's side, the system stays up
  without anyone updating anything by hand.
### Fixed

- Preparing a test version failed when a sample résumé was already stored under
  a different name. The preparation now updates the résumé that is there instead
  of trying to create a second one.
### New

- The pipeline now shows when a job was closed or left the board, next to your
  application's stage. One does not touch the other: a job closing does not move
  you to another stage.
- You can filter the pipeline by stage and page through the history. The total
  stays the same while you navigate, and the filter lives in the address — a
  reload or a back button does not lose what you were looking at.
### New

- Corpus cleanup gained a reversible step: jobs closed long ago can leave the
  active list without being deleted, and they come back on their own if the
  posting reopens. Nothing you recorded about an application — the stage, the
  notes, the dates — is touched by that step. The command shows what it would
  do before changing anything.

## [1.11.1] - 2026-09-18T16:55:28.948Z

### Fixed

- Preparing a test version with sample data could fail when two releases
  happened at the same time. The preparation now settles on its own and ends
  with the same set of samples, with nothing duplicated.

## [1.11.0] - 2026-09-18T15:58:18.484Z

### Improved

- Automatic job fetching now runs only on the published system. Test versions no
  longer trigger fetches or consume the job boards' quota, even if they share
  some configuration by mistake.

## [1.10.0] - 2026-09-18T15:23:04.431Z

### Improved

- Test versions of the system now ship with a small set of sample jobs and
  accounts, covering remote, hybrid, on-site and already-closed postings. Anyone
  trying one of those versions sees the screens working without depending on
  real data.

## [1.9.0] - 2026-09-18T15:01:18.066Z

### Improved

- The system's test environments no longer fetch real jobs: they work on sample
  data only. Anyone using the published system sees no difference; anyone trying
  a test version no longer consumes the job boards' quota or mixes real data
  into a rehearsal.

## [1.8.0] - 2026-09-18T02:18:09.098Z

### Added

- The job detail now shows the application's history: every stage change with
  its date and the note you wrote at that moment.

## [1.7.2] - 2026-09-18T02:01:07.561Z

### Fixed

- When you move an application, the list now shows only the stages it can reach
  from where it is.
- If the change is refused, the note you typed stays on screen, and the message
  says which stage cannot lead to which.
- After a refusal, the screen now shows the application's current stage and the
  options that actually lead somewhere, with no reload needed.
- A note written without changing the stage is no longer discarded on save.

## [1.7.1] - 2026-09-16T22:56:50.789Z

### Fixed

- Compensation values with cents are now imported correctly.

## [1.6.0] - 2026-09-16T05:24:04.621Z

### Improved

- Maintenance now checks that your jobs and decisions remain preserved before a
  database change.

## [1.5.0] - 2026-09-16T02:16:17.210Z

### Improved

- Job sourcing now automatically discards technical copies that are no longer
  needed after processing, keeping the database smaller and reducing quota
  outage risk.
- Cockpit counters now query the corpus with fewer reads without changing the
  filters or displayed results.

## [1.4.1] - 2026-09-15T23:55:25.383Z

### Fixed

- Recruiters and administrators can now find open jobs on the board even when
  no candidate profile is linked to their account, open their details, and
  export the list without accessing another person's pipeline.
- An account that is no longer a candidate cannot regain its private pipeline
  by signing in again.

## [1.4.0] - 2026-09-15T18:14:00.754Z

### Fixed

- Clearing search now empties the field; browser history restores the text that
  matches the results.

### New

- Filter jobs by Remote, Hybrid or On-site in the dashboard and job list.
  Choose All to include jobs with no stated work mode.
- View all keeps your filters, and pagination preserves your selected page size.

## [1.3.10] - 2026-08-28T03:09:49.668Z

### Fixed

- When the installed app rotates to landscape, the header returns to its normal height
  while keeping the portrait protection from the clock, signal, and battery.

## [1.3.9] - 2026-08-27T20:34:24.046Z

### Fixed

- The installed app now checks for updates when it returns to the foreground
  and automatically switches to the new version instead of continuing to show
  the previous release's styling.
- The header once again spans the full screen on phones, tablets, and desktops.
  Mobile content uses 95% of the screen, and navigation links stay visible in
  the header whenever they fit.
- The **What's New** window now appears only after signing in.

## [1.3.8] - 2026-08-27T14:52:18.260Z

### Fixed

- In the app installed on a phone, the header now starts below the system
  bar: clock, signal, and battery no longer sit on top of the **Master Jobs**
  name or its buttons, in portrait or landscape.

### Improved

- The header has breathing room again: slightly taller, with inner margin at
  the top and bottom at every screen size.
- Content now spans the full screen width with equal side margins, from phone
  to desktop.

## [1.3.7] - 2026-08-26T20:06:11.585Z

### Fixed

- The header no longer shows stacked links alongside the menu button during an
  update. At every screen size, only the appropriate navigation mode remains
  visible.
- Long account names no longer widen the page or misalign the header controls.

## [1.3.6] - 2026-08-26T16:50:32.312Z

### Improved

- The **Master Jobs** logo now links to the home screen, and the menu no longer
  repeats the **Cockpit** option.
- On mobile, the menu button opens and closes the list every time it is tapped,
  without getting stuck open.

## [1.3.5] - 2026-08-26T13:25:10.198Z

### Fixed

- On mobile, the system clock and status indicators no longer cover the brand
  or header controls, including in landscape. Content uses 95% of the screen,
  and the full menu appears whenever there is room for every link.

## [1.3.4] - 2026-08-26T03:36:26.414Z

### Fixed

- On phones and tablets in landscape, the header now keeps the compact menu
  until there is room for every link. An open menu also stays below the header
  when the screen rotates, without clipping its content.

## [1.3.3] - 2026-08-25T19:02:27.543Z

### Improved

- Actions that save, change, delete, or update data now show a confirmation or
  an error in the active language. The message disappears automatically after
  five seconds.
- When switching screens, loading stays centered across the full page,
  including on mobile, and application statuses are translated and sorted
  alphabetically.

### Fixed

- The account editing dialog now closes after changes are saved successfully.

## [1.3.2] - 2026-08-25T12:11:42.279Z

### Fixed

- In the installed mobile app, the brand, menu, and header controls now remain
  below the system status bar in both portrait and landscape orientation.

## [1.3.1] - 2026-08-25T05:09:18.271Z

### Fixed

- When opening or reloading a missing or restricted page, the startup screen no
  longer gets stuck. The correct message appears and lets you return to an
  available area of the application.

## [1.3.0] - 2026-08-24T20:02:56.775Z

### New

- When switching screens through menus, links, filters, or browser history,
  Master Jobs now shows the same branded opening used at app startup.
- If the installed app opens without internet access, a safe screen explains
  the situation and lets you retry without storing account data on the device.

## [1.2.0] - 2026-08-23T20:57:34.519Z

### Fixed

- Screen readers now identify the résumé editor correctly, and disabled-account
  details remain readable with sufficient contrast.

## [1.1.4] - 2026-08-23T19:19:40.742Z

### Fixed

- The **Cockpit** and **Jobs** pages, the **What's New** window, and
  account-management dialogs now use spacing consistent with the rest of the
  interface.
- When editing an account, **Save changes** now closes the dialog after a
  successful save and shows a confirmation. If saving fails, the dialog stays
  open and explains the problem.

## [1.1.3] - 2026-08-23T14:37:30.883Z

### Fixed

- The **What's New** window now uses the available phone height. On some
  iPhones, only the header appeared while the release cards were clipped,
  preventing users from opening and reading their descriptions.

## [1.1.2] - 2026-08-23T04:48:48.209Z

### New

- The **What's New** window now separates each version into a card, opens only
  the newest one initially, and lets you compare two or more open versions at
  the same time.
- New releases also show the **local time on your device**: Portuguese uses
  `dd/mm/yyyy HH:mm`, while English uses `mm/dd/yyyy HH:mm`. Older dates without
  a trustworthy time continue to show the date only.
- Descriptions now render **bold text**, lists, headings, safe links, quotes,
  and code blocks instead of showing Markdown markers.

### Improved

- More interior spacing, easier reading on mobile, scrolling inside the window,
  and complete keyboard and screen-reader navigation.

## [1.1.0] - 2026-08-21

### New

- Ranking now considers **the résumé of the person who is signed in**. Previously,
  every job was ordered using the same profile; now each person sees a list
  shaped around their own skills.
- On mobile, the **menu no longer scrolls out of sight**. A button opens the full
  list with items large enough to tap comfortably.

### Fixed

- Under load, entering the **correct password** could be rejected as incorrect
  and still count against the attempt limit. This has been fixed.

### Faster

- The daily job refresh is now **much faster**: what used to require thousands
  of conversations with the database now takes only a few.

## [1.0.0] - 2026-08-21

### New

- The system received its own name and address: **Master Jobs**, at
  `jobs.mastertimm.com.br`.
- Your account now has a **full name**, which appears at the top after you sign
  in instead of your email address.
- Administrators can now **edit and delete accounts** in a dedicated window
  without leaving the list. Before deletion, it explains what will be removed
  and what will remain.
- Jobs are now **collected automatically every night**. Previously, someone had
  to start the search from a computer.
- Reloading the page now shows an **opening screen** with the application name
  instead of flashing white while content loads.
- This **What's New history** in the footer.

### Fixed

- In the installed mobile application, the **top of the screen is no longer
  hidden** behind the clock and battery indicator.
- After an update, the application now **loads the new version reliably**.
  Previously, it could continue serving files saved from the older version.
- Pages are now **faster** because the system and its database are closer
  together, so each query no longer crosses a continent.
- Closed jobs are **checked more often**, so the list contains fewer links that
  no longer open.
- On the command line, entering an invalid number for `job`, `task`, or `skill`
  now produces a short explanation instead of a long technical message, and
  commands that previously said they were done without changing anything now
  warn you.
