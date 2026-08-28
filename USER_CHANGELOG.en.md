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

## [Unreleased]

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
