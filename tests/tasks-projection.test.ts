import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { collectProjection, writeProjection } from "../scripts/tasks/projection.ts";
import type { ProjectConfig, TaskGateway, TaskSnapshot } from "../scripts/tasks/types.ts";

const config: ProjectConfig = { protocolVersion: 1, repository: "owner/repo", owner: "owner", number: 3, projectId: "PVT_3", controlIssue: 1, writerLogin: "writer", workflow: "tasks.yml" };
const directories: string[] = [];
async function directory() {
  // macOS /var and /tmp are symlinks; the writer intentionally rejects symlink paths.
  const path = await mkdtemp(join(await realpath(tmpdir()), "tasks-projection-"));
  directories.push(path);
  return path;
}
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

function task(number = 10): TaskSnapshot {
  return {
    issue: { id: `I_${number}`, number, url: `https://github.com/owner/repo/issues/${number}`, title: `Task ${number}`, body: "Authored scope\n", state: "OPEN", updatedAt: "2026-09-22T12:00:00.000Z", assignees: ["owner"] },
    projectId: config.projectId, itemId: `ITEM_${number}`, status: "Backlog", priority: "Alta", type: "Feature", startedAt: null, finishedAt: null,
    parent: null, dependencies: [], subIssues: [], linkedPullRequests: [], coordination: null, coordinationCommentId: null, manualEpoch: 0,
    revision: "a".repeat(64), fetchedAt: "2026-09-22T12:00:00.000Z",
  };
}

it("refreshes a disposable native sub-issue graph and records each remote revision", async () => {
  const root = task(); root.subIssues = [11];
  const child = task(11); child.parent = 10; child.dependencies = [{ number: 12, state: "OPEN", status: "QA" }];
  const reads: [number, number | undefined][] = [];
  const gateway = { readTask: async (number: number, epoch?: number) => { reads.push([number, epoch]); return number === 10 ? root : child; } } as TaskGateway;
  const snapshots = await collectProjection(gateway, 10, 7);
  const target = join(await directory(), "generated");
  await writeProjection(target, config, 10, snapshots);
  expect(reads).toEqual([[10, 7], [11, 7]]);
  const metadata = JSON.parse(await readFile(join(target, "projection.json"), "utf8"));
  expect(metadata.kind).toBe("github-task-projection");
  expect(metadata.issues.map((snapshot: TaskSnapshot) => snapshot.revision)).toEqual([root.revision, child.revision]);
  expect(await readFile(join(target, "issues/11/task.md"), "utf8")).toContain("issues/12");
  expect(await readFile(join(target, "task.md"), "utf8")).toContain("GitHub Project são a autoridade operacional");
  root.status = "Em execução"; root.subIssues = []; root.revision = "b".repeat(64);
  await writeProjection(target, config, 10, [root]);
  expect(await readdir(target)).toEqual(expect.arrayContaining(["task.md", "_tasks.md", "projection.json"]));
  expect(await readFile(join(target, "task.md"), "utf8")).toContain("Status observado: Em execução");
  await expect(readFile(join(target, "issues/11/task.md"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("never overwrites authored Compozy specs or treats their frontmatter as operational authority", async () => {
  const target = join(await directory(), "authored");
  await mkdir(target);
  const authored = "---\nstatus: in_progress\n---\n# Author specification\n";
  await writeFile(join(target, "task.md"), authored);
  await expect(writeProjection(target, config, 10, [task()])).rejects.toThrow("documentos autorais");
  expect(await readFile(join(target, "task.md"), "utf8")).toBe(authored);
  expect(await readdir(target)).toEqual(["task.md"]);
});

it("preserves local changes and foreign files even in an identified projection", async () => {
  const target = join(await directory(), "generated");
  await writeProjection(target, config, 10, [task()]);
  const original = await readFile(join(target, "task.md"), "utf8");
  await writeFile(join(target, "task.md"), `${original}\nUncommitted local note\n`);
  await expect(writeProjection(target, config, 10, [task()])).rejects.toThrow("editada localmente");
  expect(await readFile(join(target, "task.md"), "utf8")).toContain("Uncommitted local note");
  await writeFile(join(target, "task.md"), original);
  await writeFile(join(target, "spec.md"), "An authored document");
  await expect(writeProjection(target, config, 10, [task()])).rejects.toThrow("arquivos autorais");
  expect(await readFile(join(target, "spec.md"), "utf8")).toBe("An authored document");
});

it("refuses traversal, symlink destinations and a forged manifest path", async () => {
  const parent = await directory();
  await expect(writeProjection(join(parent, "generated") + "/../other", config, 10, [task()])).rejects.toThrow("'..'");
  const authored = join(parent, "authored"); await mkdir(authored); await writeFile(join(authored, "spec.md"), "keep");
  const alias = join(parent, "alias"); await symlink(authored, alias);
  await expect(writeProjection(alias, config, 10, [task()])).rejects.toThrow("link simbólico");
  const target = join(parent, "generated"); await writeProjection(target, config, 10, [task()]);
  const metadata = JSON.parse(await readFile(join(target, "projection.json"), "utf8"));
  metadata.files["../authored/spec.md"] = "f".repeat(64);
  await writeFile(join(target, "projection.json"), JSON.stringify(metadata));
  await expect(writeProjection(target, config, 10, [task()])).rejects.toThrow("manifesto inválido");
  expect(await readFile(join(authored, "spec.md"), "utf8")).toBe("keep");
});

it("does not publish a partial graph when a remote child read fails", async () => {
  const root = task(); root.subIssues = [11];
  const gateway = { readTask: async (number: number) => { if (number !== 10) throw new Error("network unavailable"); return root; } } as TaskGateway;
  await expect(collectProjection(gateway, 10, 0)).rejects.toThrow("network unavailable");
});
