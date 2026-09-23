/**
 * Proteções remotas das branches permanentes e do ambiente de produção.
 *
 * O estado desejado é dado, e a comparação é pura: o teste cobre a política
 * sem rede, e a CLI só busca pela API e imprime a divergência. Verificar é
 * somente leitura; `--write-bodies` grava os corpos que `gh api --input`
 * aplica, para que aplicar e conferir partam da mesma definição.
 *
 * Contrato e reversão: docs/engineering/github-protections.md.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { REQUIRED_CI_JOBS } from "../release/promotion-ci.ts";

/** App "GitHub Actions": o GITHUB_TOKEN dos workflows age como esta integração. */
export const GITHUB_ACTIONS_APP_ID = 15368;
/** Papel de repositório "admin" na API de rulesets. */
export const ADMIN_ROLE_ID = 5;
export const PRODUCTION_ENVIRONMENT = "Production";

export type BypassActor = {
  actor_id: number | null;
  actor_type: string;
  bypass_mode: string;
};
export type Rule = { type: string; parameters?: Record<string, unknown> };
export type Ruleset = {
  name: string;
  target: "branch";
  enforcement: string;
  conditions: { ref_name: { include: string[]; exclude: string[] } };
  bypass_actors: BypassActor[];
  rules: Rule[];
};
export type Branches = { main: string; staging: string; dev: string };
export type Environment = {
  can_admins_bypass: boolean;
  deployment_branch_policy: { protected_branches: boolean; custom_branch_policies: boolean } | null;
  protection_rules: Array<{ type: string }>;
  branch_policies: string[];
};

export const REAL_BRANCHES: Branches = { main: "main", staging: "staging", dev: "dev" };

/** Mesmas regras sobre outros nomes: é assim que a sonda testa sem tocar em main. */
export function probeBranches(prefix: string): Branches {
  if (!/^[a-z0-9][a-z0-9./-]*-$/.test(prefix)) throw new Error("Prefixo de sonda inválido.");
  return { main: `${prefix}main`, staging: `${prefix}staging`, dev: `${prefix}dev` };
}

const ref = (branch: string) => `refs/heads/${branch}`;

// Modo estrito (branch atualizada antes do merge) fica desligado: em `main`
// exigiria mesclar `main` dentro de `staging`, e nada nasce em `staging`. Em
// `dev`, quando houver CI obrigatório, ele refaria ~15 min de CI por PR a cada
// merge em sequência — decisão registrada na documentação.
const requiredChecks: Rule = {
  type: "required_status_checks",
  parameters: {
    strict_required_status_checks_policy: false,
    do_not_enforce_on_create: false,
    required_status_checks: REQUIRED_CI_JOBS.map((context) => ({
      context, integration_id: GITHUB_ACTIONS_APP_ID,
    })),
  },
};

// Um novo push na PR de produção (a promoção seguinte move `staging`) invalida
// a aprovação: o que foi aprovado precisa ser o que entra.
const approvedPullRequest: Rule = {
  type: "pull_request",
  parameters: {
    required_approving_review_count: 1,
    dismiss_stale_reviews_on_push: true,
    require_code_owner_review: false,
    require_last_push_approval: false,
    required_review_thread_resolution: false,
    allowed_merge_methods: ["merge", "squash", "rebase"],
  },
};

function ruleset(name: string, branches: string[], bypass: BypassActor[], rules: Rule[]): Ruleset {
  return {
    name,
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: branches.map(ref), exclude: [] } },
    bypass_actors: bypass,
    rules,
  };
}

export function desiredRulesets(branches: Branches, suffix = ""): Ruleset[] {
  return [
    // Ninguém apaga nem reescreve branch permanente: nem robô, nem admin.
    ruleset(`permanentes: sem exclusão nem force-push${suffix}`,
      [branches.main, branches.staging, branches.dev], [],
      [{ type: "deletion" }, { type: "non_fast_forward" }]),
    // O CI de main não tem bypass para ninguém.
    ruleset(`main: CI obrigatório${suffix}`, [branches.main], [], [requiredChecks]),
    // A PR de produção é aberta pelo robô, então a aprovação humana é válida
    // (não é autoaprovação). O admin só dispensa a aprovação DENTRO de uma PR,
    // para o hotfix que ele mesmo abriu; push direto continua recusado. O
    // GITHUB_TOKEN não tem bypass: não publica main sozinho.
    ruleset(`main: produção por PR aprovada${suffix}`, [branches.main],
      [{ actor_id: ADMIN_ROLE_ID, actor_type: "RepositoryRole", bypass_mode: "pull_request" }],
      [approvedPullRequest]),
    // Sem PR/CI obrigatório em dev e staging: a promoção empurra o commit de
    // release para dev e faz fast-forward de staging com o GITHUB_TOKEN, e num
    // repositório de conta pessoal a API recusa o GitHub Actions como bypass
    // (422 "must be part of the ruleset source or owner organization").
    // O desenho pendente está em docs/engineering/github-protections.md.
  ];
}

export const DESIRED_ENVIRONMENT: Environment = {
  can_admins_bypass: false,
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
  // Sem revisor obrigatório: a varredura diária e a manutenção semanal usam
  // este ambiente por cron e parariam à espera de aprovação. Ver a doc.
  protection_rules: [{ type: "branch_policy" }],
  branch_policies: ["main"],
};

function canonicalRule(rule: Rule): string {
  if (rule.type !== "required_status_checks" || !rule.parameters) return JSON.stringify(sortKeys(rule));
  const checks = [...(rule.parameters.required_status_checks as Array<{ context: string }>)]
    .sort((a, b) => a.context.localeCompare(b.context));
  return JSON.stringify(sortKeys({ ...rule, parameters: { ...rule.parameters, required_status_checks: checks } }));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, inner]) => [key, sortKeys(inner)]));
  }
  return value;
}

const actorKey = (actor: BypassActor) => `${actor.actor_type}:${actor.actor_id}:${actor.bypass_mode}`;

/** Lista cada diferença; vazio significa estado efetivo igual ao desejado. */
export function compareRulesets(desired: Ruleset[], actual: Ruleset[]): string[] {
  const problems: string[] = [];
  for (const want of desired) {
    const found = actual.filter((item) => item.name === want.name);
    const have = found[0];
    if (found.length !== 1 || !have) {
      problems.push(`${want.name}: esperado 1 ruleset, encontrado ${found.length}`);
      continue;
    }
    if (have.enforcement !== "active") problems.push(`${want.name}: enforcement ${have.enforcement}`);
    if (have.target !== want.target) problems.push(`${want.name}: alvo ${have.target}`);
    const wantRefs = [...want.conditions.ref_name.include].sort().join(",");
    const haveRefs = [...(have.conditions?.ref_name?.include ?? [])].sort().join(",");
    if (wantRefs !== haveRefs || (have.conditions?.ref_name?.exclude ?? []).length > 0) {
      problems.push(`${want.name}: branches ${haveRefs || "(nenhuma)"}`);
    }
    const wantActors = want.bypass_actors.map(actorKey).sort().join(",");
    const haveActors = (have.bypass_actors ?? []).map(actorKey).sort().join(",");
    if (wantActors !== haveActors) problems.push(`${want.name}: bypass ${haveActors || "(nenhum)"}`);
    const haveRules = have.rules ?? [];
    const wantTypes = want.rules.map((rule) => rule.type).sort().join(",");
    const haveTypes = haveRules.map((rule) => rule.type).sort().join(",");
    if (wantTypes !== haveTypes) {
      problems.push(`${want.name}: regras ${haveTypes || "(nenhuma)"}`);
      continue;
    }
    for (const rule of want.rules) {
      // A API acrescenta parâmetros novos com o tempo; só os declarados aqui
      // formam a política, e cada um precisa ter exatamente o valor desejado.
      const found = haveRules.find((item) => item.type === rule.type)!;
      const projected: Rule = { type: found.type };
      if (rule.parameters) {
        projected.parameters = Object.fromEntries(Object.keys(rule.parameters)
          .map((key) => [key, found.parameters?.[key]]));
      }
      if (canonicalRule(rule) !== canonicalRule(projected)) problems.push(`${want.name}: parâmetros de ${rule.type} divergem`);
    }
  }
  return problems;
}

export function compareEnvironment(desired: Environment, actual: Environment | null): string[] {
  if (!actual) return [`${PRODUCTION_ENVIRONMENT}: ambiente ausente`];
  const problems: string[] = [];
  if (actual.can_admins_bypass !== desired.can_admins_bypass) problems.push(`${PRODUCTION_ENVIRONMENT}: can_admins_bypass ${actual.can_admins_bypass}`);
  if (JSON.stringify(actual.deployment_branch_policy) !== JSON.stringify(desired.deployment_branch_policy)) {
    problems.push(`${PRODUCTION_ENVIRONMENT}: deployment_branch_policy ${JSON.stringify(actual.deployment_branch_policy)}`);
  }
  const ruleTypes = (environment: Environment) => environment.protection_rules.map((rule) => rule.type).sort().join(",");
  if (ruleTypes(actual) !== ruleTypes(desired)) problems.push(`${PRODUCTION_ENVIRONMENT}: regras ${ruleTypes(actual) || "(nenhuma)"}`);
  if ([...actual.branch_policies].sort().join(",") !== [...desired.branch_policies].sort().join(",")) {
    problems.push(`${PRODUCTION_ENVIRONMENT}: branches ${actual.branch_policies.join(",") || "(nenhuma)"}`);
  }
  return problems;
}

function gh<T>(path: string): T {
  return JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8" })) as T;
}

function readRulesets(repo: string): Ruleset[] {
  const summaries = gh<Array<{ id: number; source_type: string }>>(`repos/${repo}/rulesets?per_page=100`);
  return summaries.filter((item) => item.source_type === "Repository")
    .map((item) => gh<Ruleset>(`repos/${repo}/rulesets/${item.id}`));
}

function readEnvironment(repo: string): Environment | null {
  let environment: Omit<Environment, "branch_policies">;
  try {
    environment = gh(`repos/${repo}/environments/${PRODUCTION_ENVIRONMENT}`);
  } catch {
    return null;
  }
  const policies = environment.deployment_branch_policy?.custom_branch_policies
    ? gh<{ branch_policies: Array<{ name: string }> }>(`repos/${repo}/environments/${PRODUCTION_ENVIRONMENT}/deployment-branch-policies`)
      .branch_policies.map((policy) => policy.name)
    : [];
  return { ...environment, branch_policies: policies };
}

function option(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} exige um valor`);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const repo = option(args, "--repo") ?? "andreustimm/master-jobs";
  const prefix = option(args, "--probe-prefix");
  const branches = prefix ? probeBranches(prefix) : REAL_BRANCHES;
  const desired = desiredRulesets(branches, prefix ? ` [sonda ${prefix}]` : "");
  const bodies = option(args, "--write-bodies");
  if (bodies) {
    mkdirSync(bodies, { recursive: true });
    desired.forEach((body, index) => writeFileSync(join(bodies, `ruleset-${index + 1}.json`), `${JSON.stringify(body, null, 2)}\n`));
    console.log(`${desired.length} corpos gravados em ${bodies}`);
  } else {
    const problems = compareRulesets(desired, readRulesets(repo));
    if (!prefix) problems.push(...compareEnvironment(DESIRED_ENVIRONMENT, readEnvironment(repo)));
    for (const set of desired) console.log(`${problems.some((p) => p.startsWith(set.name)) ? "DIVERGE" : "ok     "} ${set.name}`);
    if (!prefix) console.log(`${problems.some((p) => p.startsWith(PRODUCTION_ENVIRONMENT)) ? "DIVERGE" : "ok     "} ambiente ${PRODUCTION_ENVIRONMENT}`);
    for (const problem of problems) console.error(`- ${problem}`);
    process.exitCode = problems.length ? 1 : 0;
  }
}
