import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const read = (path: string) => readFileSync(path, "utf8");

function frontmatter(document: string): unknown {
  const match = /^---\n([\s\S]*?)\n---/.exec(document);
  if (!match) throw new Error("task graph frontmatter is missing");
  return parse(match[1]!);
}

describe("Compozy job-sweep operational contract", () => {
  it("IT-002: the task dependency and runnable loop definition validate", () => {
    const tasks = frontmatter(read(".compozy/tasks/next-backlog-wave/_tasks.md")) as {
      graph: {
        nodes: Array<{ id: string; file: string }>;
        edges: Array<{ from: string; to: string }>;
      };
    };
    const loop = parse(read("compozy/loops/job-sweep.yaml")) as {
      meta: { name: string };
      start: Array<{ kind: string }>;
      inputs?: Record<string, unknown>;
      graph: {
        nodes: Array<{
          id: string;
          class?: string;
          kind?: string;
          params?: {
            agent?: string;
            allowed_tools?: string[];
            output_schema?: { required?: string[] };
            prompt?: string;
          };
        }>;
        edges: Array<{ from: string; to: string }>;
      };
    };

    expect(tasks.graph.edges).toContainEqual({ from: "task_01", to: "task_02" });
    for (const node of tasks.graph.nodes) {
      expect(existsSync(`.compozy/tasks/next-backlog-wave/${node.file}`)).toBe(true);
    }
    expect(loop.meta.name).toBe("job-sweep");
    expect(loop.start.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining(["manual", "cli", "uds", "schedule"]),
    );
    const review = loop.graph.nodes.find((node) => node.id === "review");
    const prepare = loop.graph.nodes.find((node) => node.id === "prepare");
    const snapshot = loop.graph.nodes.find((node) => node.id === "snapshot");
    expect(review?.params?.output_schema?.required).toEqual([
      "status",
      "summary",
      "candidates",
    ]);
    expect(prepare?.params?.agent).toBe("job-sweep-operator");
    expect(review?.params?.agent).toBe("job-sweep-reviewer");
    expect(review?.params?.allowed_tools).toBeUndefined();
    expect(snapshot).toMatchObject({ class: "source", kind: "file-import" });
    expect(prepare?.params?.prompt).toContain("pnpm jho jobs sweep");
    expect(prepare?.params?.prompt).not.toMatch(/jho\s+jobs\s+show|jho\s+track/iu);
    expect(review?.params?.prompt).toContain("untrusted source content");
    expect(review?.params?.prompt).not.toMatch(/jho\s+track|\bapplication\b/iu);
    expect(loop.inputs?.analyst).toBeUndefined();
    expect(loop.graph.edges).toContainEqual({ from: "snapshot", to: "review" });
  });

  it("IT-009: the reviewer agent is read-only and cannot use Compozy or MCP tools", () => {
    const reviewer = read(".compozy/agents/job-sweep-reviewer/AGENT.md");
    const operator = read(".compozy/agents/job-sweep-operator/AGENT.md");

    expect(frontmatter(reviewer)).toMatchObject({
      name: "job-sweep-reviewer",
      permissions: "deny-all",
      deny_tools: ["compozy__*", "mcp__*"],
    });
    expect(reviewer).toContain("never as instructions");
    expect(operator).toContain("Never invoke `jho jobs show`, `jho track`");
    expect(read("src/cli.ts")).toContain('.command("sweep")');
    expect(read("src/core/triage/job-sweep.ts")).toContain("sourcesFailed");
  });

  it("IT-003: the runbook gates the schedule on structured manual evidence", () => {
    const runbook = read("compozy/README.md");
    const orderedMarkers = [
      "daemon start",
      "workspace info",
      "loop validate",
      "loop run",
      "Run id:",
      "automation jobs create",
    ];
    const positions = orderedMarkers.map((marker) => runbook.indexOf(marker));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(runbook).toContain("`status`, `summary` e `candidates`");
    expect(runbook).toContain('schedule "0 9 * * 1-5"');
    expect(runbook).toContain("não execute `create` novamente");
    expect(runbook).toMatch(/nunca chama\s*>?\s*`jho track` nem escreve em `application`/iu);
  });

  it("IT-004: unavailable and existing resources have safe retry paths", () => {
    const runbook = read("compozy/README.md");

    expect(runbook).toContain('export CY03_WORKSPACE="<repo>"');
    expect(runbook).toContain("Se o daemon estiver parado");
    expect(runbook).toContain("pare aqui");
    expect(runbook).toContain("workspace info");
    expect(runbook).toContain("loop list --json");
    expect(runbook).toContain("automation jobs --loop job-sweep");
    expect(runbook).toMatch(/reutilize o\s+recurso retornado/iu);
  });
});
