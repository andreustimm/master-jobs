# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Complete the first-party navigation migration through typed Next adapters, canonical role/auth/entity journeys, architecture enforcement, browser QA, and all Task 04 gates while preserving valid work left by the cancelled run.

## Important Decisions

- Treat `_tests.md`, the machine-checkable TechSpec rules, and ADR-003 as canonical when reconciling the partial adapters; Tasks 01-03 remain untouched.
- Keep POST Server Action forms ordinary. In installed Next 16.3.2, the public router hook observes push/replace/traverse but the Server Action reducer commits its accepted redirect internally; the root commit observer bridges that runtime gap before paint without intercepting or retrying the mutation.
- Keep raw anchors only for explicit non-transition cases such as external destinations and downloads; internal GET navigation uses the stable adapters.

## Learnings

- The cancelled run left a coherent partial migration plus two new adapters, but no prior task-memory decisions.
- Fresh baseline on Node 24 after frozen install failed only in the generic typed-route signatures of `transition-link.tsx` and `transition-get-form.tsx`; both now match the installed Next declarations and targeted typecheck/tests pass.
- The reconciled feature corpus contains 16 files, including ADR-005, and no `analysis/`, `handoffs/`, `_qa.md`, or `_examples.md`; living QA must use the repository-level tracker.
- Browser evidence proved that Server Action redirects do not call `onRouterTransitionStart()` in Next 16.3.2. `NavigationCommitObserver` compares the prior and committed route in a layout effect and reconciles a missing generation while the store is idle or the prior generation has already committed; it never supersedes a newer uncommitted target, and ordinary navigations still coalesce through the authoritative hook. ADR-005 records the compatibility refinement.

## Files / Surfaces

- Global nav, candidate/auth/list/detail surfaces, filters, pagination, density controls, session links, architecture enforcement, assigned Vitest cases, and browser journeys are implemented.
- Living QA now tracks the complete first-party inventory and canonical auth/role boundaries under `J-switch-workspace-screen`.

## Errors / Corrections

- Restored `.compozy/tasks/loading-transicoes-tela/task_03.md` exactly from `HEAD` before proceeding; it is clean and remains completed.
- The initial TS2322/TS2345 errors were resolved against installed Next 16.3.2 declarations without weakening typed-route behavior.
- Three E2E iterations exposed grader issues rather than product regressions: an ambiguous `/login` selector, history replay against the wrong entry, and same-route/incorrect-role destination assumptions. Each test now uses a distinct public action and canonical response.
- Deep-review round 2 findings were remediated at their owning layers: adapters now match Next's empty submitter and non-NaN numeric query semantics, every contextual family proves its destination and query state, deterministic referrals make that route testable, and the finalizer deletes every browser-created job only after exact identity matching.

## Ready for Next Run

- Final Node 24.19.0 evidence is green: targeted 110/110, full browser 174/174 including zero leaked browser-created jobs, and `pnpm check` with 148/148 files, 2,081 passing tests, 2 pre-existing skips, and 97.45% line coverage.
- Independent re-audit passed after closing AF-001 through AF-004 with deterministic cardinality, rapid-history, token-race, entity, and pending-revocation proofs.
- Task tracking and living QA are complete. Deep-review evidence is stored under `.deep-review/task-04-worktree/`; automatic commit remains conditioned on a final SHIP verdict. Do not alter Tasks 01-03.
