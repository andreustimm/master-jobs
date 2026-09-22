# Independent Evaluator Protocol

This reference codifies the stance `agent-output-audit` takes when auditing AI-implemented work. It exists because the agent that wrote the code interprets its own output charitably — and a self-report is not evidence.

## Principle

> The agent that wrote the implementation and the agent doing this audit are distinct evaluation contexts. The auditor never accepts the implementer's self-report as evidence.

This is not about distrust of the model. It is about how context affects evaluation: an agent that just spent two hours building a feature reads ambiguous output as success. An auditor reading the exit code, the diff, and the test file at its current state does not.

## What counts as evidence

- Fresh re-execution of the smallest public proof (CLI invocation, HTTP request, browser flow, worker job) against the current state of the repository.
- Direct read of the test file at its current commit, matched against the literal acceptance criterion using the Requirement → Test mapping defined by the AI Implementation Audit reference (loaded separately from SKILL.md, not via this file).
- Static analysis of the diff since the task baseline (`rtk git log --follow <test_file>`, `rtk git diff <baseline_sha>..HEAD -- <test_file>`).
- Successful exit codes from canonical commands recorded with timestamps in `audit-report.md`.

## What does NOT count as evidence

- The implementing agent's transcript or chat log claiming success.
- A "done" or "all green" message in `memory/<phase>.md`.
- A checkbox marked `[x]` in `task_NN.md` body or `_techspec.md`.
- The frontmatter `status: completed` field by itself.
- A test run whose output was discarded or summarized by the implementing agent.
- A PR description or commit message asserting that tests pass.

## Sequence

When auditing a task under `.compozy/tasks/<slug>/`:

1. **Read the implementer's artifacts before forming a judgment.** Open every `memory/<phase>.md` file the implementing agent wrote during `cy-codex-loop`. Read for: tools the agent used to bypass blockers, errors it "fixed" by deleting an assertion, fallback paths it took when the real path failed, ambiguity it resolved unilaterally.
2. **Classify anomalies** found in the transcript into one of:
   - `genuine-failure` — the agent encountered a real problem and did not resolve it.
   - `grader-bug` — the agent encountered a test or check that was wrong; the resolution may be legitimate.
   - `ambiguous-task` — the requirement was unclear and the agent picked an interpretation.
   - `bypass-exploit` — the agent found a path that satisfies the literal test but not the requirement (e.g., hardcoded an expected value, skipped a step the test did not enforce).
3. **Record classifications in `memory/qa-execution.md` → `Errors / Corrections` section.** Link the canonical issue and remote revision. This evidence precedes any request for reconciliation by the authorized owning execution; it never authorizes a local task-status flip.
4. **Then** apply the audit's normal verification — re-execute the smallest proof, read the diff, and run the AI test-hygiene Red Flag scans (RF-1..RF-6) defined in the AI Implementation Audit reference (Step 4 of SKILL.md).
5. **Then** decide the `qa_verdict`. If transcript classification surfaced a `bypass-exploit` or `genuine-failure` not addressed by the implementation, the verdict cannot be `PASS` regardless of green tests.

## Why this matters in Compozy mode

Generic Compozy loops may self-report completion through `state.yaml` and task frontmatter. In Master Jobs, AGENTS rule 24 overrides that operational model: read the issue/Project remotely and treat those files only as history or identified projections. The independent evaluator checks actual implementation and required delivery; neither a local completion claim nor a remote status is proof that the work is correct.

## Sources

- Anthropic — [Demystifying Evals for AI Agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents): "you won't know if your graders are working well unless you read the transcripts and grades from many trials… when a task fails, the transcript tells you whether the agent made a genuine mistake or whether your graders rejected a valid solution."
- Florian Bruniaux — [Claude Code Ultimate Guide: TDD with Claude](https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/main/guide/workflows/tdd-with-claude.md): "the agent that writes the code must not be the same invocation that certifies it done. This is not about distrust of the model; it is about how context affects evaluation."
- InfoQ — [Evaluating AI Agents in Practice: Benchmarks, Frameworks, and Lessons Learned](https://www.infoq.com/articles/evaluating-ai-agents-lessons-learned): "An agent that works perfectly in a sandbox but silently misreports a failed refund in production hasn't passed any evaluation that counts."
