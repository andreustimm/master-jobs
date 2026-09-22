import { describe, expect, it } from "vitest";
import { planFields } from "../scripts/tasks/setup.ts";
import type { ProjectField } from "../scripts/tasks/types.ts";

describe("Project configuration dry-run", () => {
  it("preserves option IDs and unknown options with live history", () => {
    const existing: ProjectField[] = [{ id: "S", name: "Status", dataType: "SINGLE_SELECT", options: [{ id: "DONE", name: "Concluído", color: "GREEN", description: "Historic" }, { id: "CUSTOM", name: "Other live option", color: "GRAY", description: "Preserve" }] }];
    const status = planFields(existing).find(f => f.name === "Status")!;
    expect(status.options?.find(o => o.name === "Concluído")?.id).toBe("DONE");
    expect(status.options?.at(-1)?.id).toBe("CUSTOM");
    expect(existing[0]!.options).toHaveLength(2);
  });
  it("is idempotent after applying a plan, without adding synthetic dates", () => {
    const fields = planFields([]).map((f,i) => ({ id: String(i), name: f.name, dataType: f.dataType, ...(f.options ? { options: f.options.map((o,j)=>({ ...o, id: String(j) })) } : {}) }));
    expect(planFields(fields)).toEqual([]);
    expect(fields.filter(f=>f.dataType === "DATE").map(f=>f.name)).toEqual(["Iniciado em", "Concluído em"]);
  });
  it("refuses replacing a field with a destructive incompatible type", () => {
    expect(() => planFields([{ id: "S", name: "Status", dataType: "TEXT" }])).toThrow("no destructive replacement");
  });
});
