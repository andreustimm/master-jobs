import { expect, it } from "vitest";
import { checkTaskPullRequest } from "../scripts/tasks/check-pr.ts";
import type { PullRequestEvidence, TaskSnapshot } from "../scripts/tasks/types.ts";

const now = new Date("2026-09-22T12:00:00.000Z");
function task(number = 10): TaskSnapshot {
  return {
    issue: { id: `I_${number}`, number, url: `https://github.com/owner/repo/issues/${number}`, title: `Task ${number}`, body: "<!-- task-delivery:dev -->", state: "OPEN", updatedAt: now.toISOString(), assignees: ["owner"] },
    projectId: "PVT_3", itemId: `ITEM_${number}`, status: "QA", priority: "Alta", type: "feat", startedAt: "2026-09-22", finishedAt: null,
    parent: null, dependencies: [], subIssues: [], linkedPullRequests: [20], coordinationCommentId: 30, manualEpoch: 0,
    coordination: { protocolVersion: 1, revision: 1, generation: 2, lastOperation: "22222222-2222-4222-8222-222222222222", execution: {
      executionId: "11111111-1111-4111-8111-111111111111", publicKey: "public-key", actor: "owner", branch: "feat/task", worktreeId: "task", generation: 2,
      acquiredAt: "2026-09-22T10:00:00.000Z", heartbeatAt: "2026-09-22T11:59:00.000Z", expiresAt: "2026-09-22T13:00:00.000Z",
    } },
    revision: "d".repeat(64), fetchedAt: now.toISOString(),
  };
}

function pullRequest(): PullRequestEvidence {
  return { number: 20, url: "https://github.com/owner/repo/pull/20", state: "OPEN", base: "dev", head: "feat/task", headSha: "a".repeat(40), mergeSha: null, mergedAt: null, linkedIssues: [10], checksSuccessful: true };
}

it("allows an assigned task PR only with matching native issue and current branch claim", () => {
  expect(checkTaskPullRequest(pullRequest(), [task()], ["owner"], now)).toEqual([]);
  expect(checkTaskPullRequest(pullRequest(), [task()], [], now)).toContain("PR needs an assignee");
});

it("rejects a claim from another branch, another generation or a non-assignee actor", () => {
  const issue = task(); const pr = pullRequest();
  issue.coordination!.execution!.branch = "feat/other";
  expect(checkTaskPullRequest(pr, [issue], ["owner"], now).join(" ")).toContain("valid claim");
  issue.coordination!.execution!.branch = pr.head; issue.coordination!.execution!.generation = 1;
  expect(checkTaskPullRequest(pr, [issue], ["owner"], now).join(" ")).toContain("valid claim");
  issue.coordination!.execution!.generation = 2; issue.coordination!.execution!.actor = "another-owner";
  expect(checkTaskPullRequest(pr, [issue], ["owner"], now).join(" ")).toContain("valid claim");
});

it("rejects expired and unparseable leases instead of treating NaN as authorization", () => {
  const issue = task(); const pr = pullRequest();
  issue.coordination!.execution!.expiresAt = now.toISOString();
  expect(checkTaskPullRequest(pr, [issue], ["owner"], now).join(" ")).toContain("valid claim");
  issue.coordination!.execution!.expiresAt = "invalid-timestamp";
  expect(checkTaskPullRequest(pr, [issue], ["owner"], now).join(" ")).toContain("valid claim");
});

it("matches native linked issue IDs rather than accepting another issue with the same count", () => {
  const issue = task(); const pr = pullRequest(); pr.linkedIssues = [11];
  expect(checkTaskPullRequest(pr, [issue], ["owner"], now).join(" ")).toMatch(/native|link/i);
});

it("requires the native PR link in the issue's independent remote snapshot", () => {
  const issue = task(); issue.linkedPullRequests = [];
  expect(checkTaskPullRequest(pullRequest(), [issue], ["owner"], now).join(" ")).toMatch(/native|link/i);
});

it("blocks incomplete dependencies even when their GitHub issue is closed", () => {
  const issue = task(); issue.dependencies = [{ number: 9, state: "CLOSED", status: "Cancelado" }];
  expect(checkTaskPullRequest(pullRequest(), [issue], ["owner"], now).join(" ")).toContain("unfinished dependencies");
  issue.dependencies[0]!.status = "Concluído";
  expect(checkTaskPullRequest(pullRequest(), [issue], ["owner"], now)).toEqual([]);
});

it("allows parent and child integration together when each linked issue has a valid claim", () => {
  const parent = task(10), child = task(11), pr = pullRequest();
  parent.subIssues = [11]; child.parent = 10; pr.linkedIssues = [10, 11];
  expect(checkTaskPullRequest(pr, [parent, child], ["owner"], now)).toEqual([]);
  child.coordination = null;
  expect(checkTaskPullRequest(pr, [parent, child], ["owner"], now).join(" ")).toContain("#11 lacks a valid claim");
});

it("rejects missing Project membership and blocked, canceled, concluded or closed issues", () => {
  const issue = task(), pr = pullRequest(); issue.itemId = "";
  expect(checkTaskPullRequest(pr, [issue], ["owner"], now).join(" ")).toContain("outside the Project");
  issue.itemId = "ITEM_10";
  for (const status of ["Bloqueado", "Cancelado", "Concluído"] as const) {
    issue.status = status;
    expect(checkTaskPullRequest(pr, [issue], ["owner"], now).join(" ")).toContain("not available for integration");
  }
  issue.status = "QA"; issue.issue.state = "CLOSED";
  expect(checkTaskPullRequest(pr, [issue], ["owner"], now).join(" ")).toContain("not available for integration");
});

it("preserves explicit promotion/return exceptions without allowing task branches into main", () => {
  const pr = pullRequest(); pr.base = "main";
  expect(checkTaskPullRequest(pr, [task()], ["owner"], now)).toContain("Task PRs must target dev");
  pr.head = "staging"; pr.linkedIssues = [];
  expect(checkTaskPullRequest(pr, [], ["owner"], now)).toEqual([]);
  expect(checkTaskPullRequest(pr, [], [], now)).toContain("PR needs an assignee");
  pr.base = "dev"; pr.head = "main";
  expect(checkTaskPullRequest(pr, [], ["owner"], now)).toEqual([]);
});
