---
name: a11y-testing
description: Automated accessibility testing with axe-core and the project's existing hermetic Playwright runner. Use when adding or validating a11y tests, running WCAG checks, or auditing UI accessibility.
context: fork
agent: test-generator
version: 1.1.0-master-jobs
tags: [accessibility, testing, axe-core, playwright, wcag, a11y]
allowed-tools: [Read, Write, Bash, Grep, Glob]
author: SkillForge
user-invocable: false
---

# Accessibility Testing

Use the existing hermetic Playwright runner in `tests/e2e/`; never create a
second Jest, Playwright, server, database, or CI stack. Project rules in
`AGENTS.md` and `DESIGN.md` are the source of truth.

## Workflow

1. Read the existing browser checks in `tests/e2e/ui.mjs`, the axe lane in
   `tests/e2e/a11y.mjs`, and its orchestration in `tests/e2e/run-isolated.mjs`.
2. Add page or state coverage to those files. Reuse the isolated build, seeded
   SQLite database, loopback server and real authentication path.
3. Scan the cumulative WCAG 2.2 AA tag set:
   `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, and `wcag22aa`.
4. Confirm the requested route returned a successful response and that the
   final pathname is the intended surface before accepting axe output.
5. Test interactive states, keyboard behavior, focus, mobile width, all six
   theme/mode combinations and computed contrast where the change can affect
   them. Axe supplements these checks; it does not replace them.
6. Run `rtk pnpm test:e2e`. Never disable a rule globally, exclude the page, or
   weaken the gate to make a violation disappear.

## Project pattern

```javascript
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const response = await page.goto(url, { waitUntil: "networkidle" });

if (!response?.ok() || new URL(page.url()).pathname !== expectedPath) {
  throw new Error(`a11y did not reach ${expectedPath}`);
}

const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
if (result.violations.length > 0) throw new Error(JSON.stringify(result.violations));
```

Third-party widgets may be excluded only when the exclusion is narrow,
documented and owned outside the project. Manual checks remain required for
issues automation cannot prove, such as task clarity and assistive-technology
experience.
