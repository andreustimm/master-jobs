import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const writer = parse(readFileSync(new URL("../.github/workflows/tasks-project.yml", import.meta.url), "utf8"));
const gate = parse(readFileSync(new URL("../.github/workflows/tasks-check.yml", import.meta.url), "utf8"));
describe("trusted task automation", () => {
  it("serializes every writer trigger without canceling active work", () => {
    expect(writer.concurrency).toEqual({ group: "tasks-project-PVT_kwHOAAxgXs4Bj8-V", queue: "max", "cancel-in-progress": false });
    expect(Object.keys(writer.on)).toEqual(expect.arrayContaining(["issue_comment", "issues", "pull_request_target", "workflow_run", "deployment_status", "schedule", "workflow_dispatch"]));
  });
  it("keeps automatic writers off until enabled and permits explicit bootstrap dispatches", () => {
    expect(writer.jobs.writer.if.trim()).toBe([
      "github.repository == 'andreustimm/master-jobs' &&",
      "(vars.TASKS_WRITER_ENABLED == 'true' || github.event_name == 'workflow_dispatch') &&",
      "(github.event_name != 'pull_request_target' || github.event.pull_request.head.repo.full_name == github.repository) &&",
      "(github.event_name != 'issue_comment' ||",
      "(github.event.issue.number == 207 && startsWith(github.event.comment.body, '<!-- tasks-command:v1 -->')))",
    ].join(" "));
    expect(writer.on.workflow_dispatch.inputs.mode.options).toEqual(["reconcile", "initialize"]);
    expect(writer.jobs.writer.if).not.toContain("TASKS_ENFORCEMENT");
  });
  it("never checks out privileged PR code or runs its install scripts", () => {
    for (const workflow of [writer, gate]) {
      const job = Object.values(workflow.jobs)[0] as { steps: { uses?: string; with?: Record<string, unknown>; run?: string }[] };
      expect(job.steps.find(s => s.uses?.startsWith("actions/checkout@"))?.with).toEqual({ ref: "main", "persist-credentials": false });
      expect(job.steps.find(s => s.run?.startsWith("pnpm install"))?.run).toContain("--ignore-scripts");
      expect(job.steps.map(s => s.run ?? "").join("\n")).not.toContain("${{");
    }
  });
  it("does not silently substitute the repository token for Projects privilege", () => {
    const step = writer.jobs.writer.steps.find((s: { env?: unknown }) => s.env);
    expect(step.env.GH_TOKEN).toBe("${{ secrets.PROJECTS_TOKEN }}");
    expect(step.env.TASKS_WRITER_PRIVATE_KEY).toBe("${{ secrets.TASKS_WRITER_PRIVATE_KEY }}");
    expect(gate.jobs["canonical-task"].if).toBe("vars.TASKS_ENFORCEMENT == 'true'");
  });
});
