# Exploring a PR's documentation & artifact impact

## Contents

1. Why this step matters
2. Compute the diff scope
3. Launch parallel Explore subagents
4. Aggregate the findings
5. Common impact patterns
6. Pitfalls

## 1. Why this step matters

A feature is not shippable until the artifacts that depend on it — README, docs site, examples, CHANGELOG, `.env.example`, `.github/` workflows — reflect the new reality. Reviewers expect either matching updates in the same PR or an explicit follow-up note in the description. This step produces the input for both the PR description's **Changes** section and the release-notes generator.

## 2. Compute the diff scope

Use one scope that includes committed, staged and unstaged work. The status line
also exposes untracked files, which `git diff` cannot show until staging:

```bash
BASE="$(rtk gh pr view --json baseRefName -q .baseRefName 2>/dev/null || echo dev)"
MERGE_BASE="$(rtk git merge-base HEAD "${BASE}")"
rtk git status --short
rtk git diff --name-only "${MERGE_BASE}"
rtk git diff --stat "${MERGE_BASE}"
rtk git log --oneline "${MERGE_BASE}..HEAD"
```

The downstream file list is the union of `git status --short` and
`git diff --name-only`; the diff/stat and log share the same merge base. Never
choose between committed and uncommitted work — a mixed branch must include both.

## 3. Launch parallel Explore subagents

Fan out **up to 3** Explore agents in a single message (parallel tool calls). Use fewer when the change is narrow. Each agent gets a distinct slice of the impact surface so they don't duplicate work.

**Agent A — Docs site & top-level docs.** Prompt:

> Search the repository for documentation that references any of the following symbols/paths, then report exact files and line numbers that mention them but do not match the new behavior on this branch:
>
> Changed files: `<paste git diff --name-only output>`
> Changed exported symbols / CLI flags / config keys / env vars: `<extract from the diff>`
>
> Scope: `docs/`, `site/`, `apps/docs/`, top-level `*.md` (README, CONTRIBUTING, CHANGELOG), any `mdx` files. Report under 250 words as a bullet list grouped by file. Do not propose edits — only locate stale references.

**Agent B — Examples & integration tests.** Prompt:

> Search `examples/`, `e2e/`, `tests/integration/`, `fixtures/` for usages of the same symbols/flags/env vars as Agent A. Report which examples will fail or need updating, with file paths and line numbers. Under 250 words.

**Agent C — `.github/`, CI, and release artifacts.** Prompt:

> Inspect `.github/workflows/`, `.github/PULL_REQUEST_TEMPLATE.md`, `.release-notes/`, `cliff.toml`, and any release scripts. Flag CI changes in the diff that reviewers will want highlighted, and confirm whether `.github/PULL_REQUEST_TEMPLATE.md` exists (so the PR body can match its sections). Under 150 words.

When the change is small (≤ 5 files, no public API change), drop to **one** agent covering Slice A and skip B/C.

## 4. Aggregate the findings

Merge the three reports into a single bullet list, grouped by impact area, e.g.:

```markdown
- **Docs site:** `apps/docs/content/cli.mdx:42` references the old `--name` flag spelling.
- **README:** quick-start example uses removed `compozy.init` API.
- **Examples:** `examples/auth/basic/README.md` no longer compiles after the auth refactor.
- **.github:** `release.yml` now runs `go-test-with-coverage`; reviewers will want a note.
```

This list feeds:

- **Release notes (step 2 of the operating loop):** one note per user-visible bullet.
- **PR description Changes section (step 4):** the same grouping, possibly with links.

## 5. Common impact patterns

| Change kind                              | Where to look                                              |
| ---------------------------------------- | ---------------------------------------------------------- |
| New / renamed public API symbol          | README quick-start, `apps/docs/content/`, examples, `apps/site/`  |
| New / renamed CLI flag                   | help text in code, docs site CLI page, README, `examples/` |
| New env var or config key                | `.env.example`, deployment guides, infra READMEs, helm/k8s manifests |
| New UI route or component                | screenshots in README, marketing site, storybook stories   |
| Schema or migration change               | `migrations/`, ORM docs, ADRs                              |
| Removed / deprecated feature             | every doc that mentioned it (search by old name)           |

## 6. Pitfalls

- **Do not propose edits during exploration.** This step is read-only — it only locates stale references. Edits belong inside the implementation that produced the diff.
- **Do not skip the diff-scope step.** Agents without a concrete file/symbol list will return generic "doc-quality" feedback that wastes review cycles.
- **Do not assume the absence of evidence is good news.** A new feature with zero hits in `docs/` usually means the docs are missing, not that no update is needed.
