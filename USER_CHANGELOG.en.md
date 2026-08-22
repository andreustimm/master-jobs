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

## [Unreleased]

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
