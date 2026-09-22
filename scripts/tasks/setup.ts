import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProjectConfig } from "./cli.ts";
import { createGitHubGateway, requestGitHub } from "./github.ts";
import { parseControl } from "./protocol.ts";
import { STATUSES } from "./types.ts";
import type { ProjectField } from "./types.ts";

export const STATUS_COLORS = ["PURPLE", "GRAY", "RED", "BLUE", "ORANGE", "YELLOW", "PINK", "PURPLE", "GREEN", "GRAY"];
export const TASK_TYPES = ["feat", "fix", "docs", "chore", "refactor", "test", "perf", "ci", "build", "style", "revert"];
type Option = { id?: string; name: string; color: string; description: string };
export interface FieldPlan { action: "create" | "update"; id?: string; name: string; dataType: string; options?: Option[] }

export function planFields(fields: ProjectField[]): FieldPlan[] {
  const definitions = [
    { name: "Status", dataType: "SINGLE_SELECT", options: STATUSES.map((name, i) => ({ name, color: STATUS_COLORS[i]!, description: name === "Concluído" ? "Entrega exigida pela issue cumprida e verificada" : name })) },
    { name: "Prioridade", dataType: "SINGLE_SELECT", options: ["Crítica", "Alta", "Média", "Baixa"].map((name, i) => ({ name, color: ["RED", "ORANGE", "YELLOW", "GRAY"][i]!, description: name })) },
    { name: "Tipo", dataType: "SINGLE_SELECT", options: TASK_TYPES.map(name => ({ name, color: "GRAY", description: `Tipo Conventional Commits: ${name}` })) },
    { name: "Iniciado em", dataType: "DATE" }, { name: "Concluído em", dataType: "DATE" },
  ];
  const plan: FieldPlan[] = [];
  for (const definition of definitions) {
    const matches = fields.filter(f => f.name === definition.name);
    if (matches.length > 1) throw new Error(`Duplicate field ${definition.name}; reconcile manually`);
    const existing = matches[0];
    if (!existing) { plan.push({ action: "create", ...definition }); continue; }
    if (existing.dataType !== definition.dataType) throw new Error(`Field ${definition.name} has a different type; no destructive replacement is allowed`);
    if (!definition.options) continue;
    const options = definition.options.map(option => {
      const found = existing.options?.filter(o => o.name === option.name) ?? [];
      if (found.length > 1) throw new Error(`Ambiguous option ${option.name}`);
      return found[0] ? { ...found[0], color: option.color } : option;
    });
    // Unknown options may have live items; never prune or regenerate their IDs.
    options.push(...(existing.options ?? []).filter(o => !definition.options!.some(d => d.name === o.name)));
    if (JSON.stringify(existing.options) !== JSON.stringify(options)) plan.push({ action: "update", id: existing.id, ...definition, options });
  }
  return plan;
}

async function main(): Promise<void> {
  if (process.argv.slice(2).some(arg => !["--apply", "--bootstrap"].includes(arg))) throw new Error("Usage: node scripts/tasks/setup.ts [--apply --bootstrap]");
  const config = await loadProjectConfig(process.cwd());
  if (config.repository !== "andreustimm/master-jobs" || config.owner !== "andreustimm" || config.number !== 3 || config.projectId !== "PVT_kwHOAAxgXs4Bj8-V") throw new Error("Setup may only target master-jobs Project 3; Project 2 is read-only");
  const gateway = createGitHubGateway(config);
  const before = await gateway.fields();
  const plan = planFields(before);
  console.log(JSON.stringify({ project: config.projectId, before, plan, apply: process.argv.includes("--apply") }, null, 2));
  if (!process.argv.includes("--apply") || !plan.length) return;
  if (await gateway.permission(await gateway.identity()) !== "admin") throw new Error("Setup requires repository administrator");
  const controls = (await gateway.comments(config.controlIssue)).filter(c => c.author === config.writerLogin).flatMap(c => { const state = parseControl(c.body); return state ? [state] : []; });
  if (controls.length > 1 || (controls.length === 1 && !controls[0]!.paused) || (!controls.length && !process.argv.includes("--bootstrap"))) throw new Error("Pause and drain the writer, or explicitly select bootstrap before initialization");
  for (const change of plan) {
    const update = change.action === "update";
    const input = update ? { fieldId: change.id, name: change.name, singleSelectOptions: change.options } : { projectId: config.projectId, dataType: change.dataType, name: change.name, ...(change.options ? { singleSelectOptions: change.options } : {}) };
    const response = await requestGitHub("POST", "graphql", { query: update ? "mutation TaskSetup($input:UpdateProjectV2FieldInput!){updateProjectV2Field(input:$input){projectV2Field{... on ProjectV2SingleSelectField{id}}}}" : "mutation TaskSetup($input:CreateProjectV2FieldInput!){createProjectV2Field(input:$input){projectV2Field{... on ProjectV2Field{id} ... on ProjectV2SingleSelectField{id}}}}", variables: { input } }) as { errors?: unknown[]; data?: unknown };
    if (response.errors?.length || !response.data) throw new Error("Field mutation returned GraphQL errors; inspect current fields before retry");
  }
  const after = await gateway.fields();
  if (planFields(after).length) throw new Error("Configuration read-back differs from plan");
  console.log(JSON.stringify({ confirmed: true, fields: after }, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main().catch(error => { console.error(error instanceof Error ? error.message : "Setup failed"); process.exitCode = 1; });
