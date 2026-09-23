// Política das proteções remotas (#196), sem rede: o estado efetivo é conferido
// pela CLI contra o GitHub; aqui fica o que a política permite e recusa.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  ADMIN_ROLE_ID, DESIRED_ENVIRONMENT, GITHUB_ACTIONS_APP_ID, REAL_BRANCHES, compareEnvironment,
  compareRulesets, desiredRulesets, probeBranches, type Ruleset,
} from "../scripts/github/verify-protections.ts";

const desired = desiredRulesets(REAL_BRANCHES);
const covering = (branch: string, type: string) => desired.filter((set) =>
  set.conditions.ref_name.include.includes(`refs/heads/${branch}`) && set.rules.some((rule) => rule.type === type));
const clone = (): Ruleset[] => structuredClone(desired);

describe("política desejada", () => {
  it.each(["main", "staging", "dev"])("%s não aceita exclusão nem force-push de ninguém", (branch) => {
    for (const type of ["deletion", "non_fast_forward"]) {
      const sets = covering(branch, type);
      expect(sets).toHaveLength(1);
      expect(sets[0]!.bypass_actors).toEqual([]);
    }
  });

  it("o GITHUB_TOKEN não tem bypass em nenhuma regra de main", () => {
    const main = desired.filter((set) => set.conditions.ref_name.include.includes("refs/heads/main"));
    expect(main.flatMap((set) => set.bypass_actors).filter((actor) => actor.actor_type !== "RepositoryRole")).toEqual([]);
  });

  it("main exige PR com aprovação, e o admin só a dispensa dentro de uma PR", () => {
    const [review] = covering("main", "pull_request");
    expect(review!.rules[0]!.parameters!.required_approving_review_count).toBe(1);
    expect(review!.bypass_actors).toEqual([{ actor_id: ADMIN_ROLE_ID, actor_type: "RepositoryRole", bypass_mode: "pull_request" }]);
  });

  it("o CI de main não tem bypass, nem para o admin", () => {
    const [checks] = covering("main", "required_status_checks");
    expect(checks!.bypass_actors).toEqual([]);
  });

  it("checks exigidos são os jobs do CI, emitidos pelo GitHub Actions, sem modo estrito", () => {
    const ci = YAML.parse(readFileSync(".github/workflows/ci.yml", "utf8")) as { jobs: Record<string, unknown> };
    for (const branch of ["main"]) {
      const [set] = covering(branch, "required_status_checks");
      const parameters = set!.rules.find((rule) => rule.type === "required_status_checks")!.parameters!;
      expect(parameters.strict_required_status_checks_policy).toBe(false);
      const checks = parameters.required_status_checks as Array<{ context: string; integration_id: number }>;
      expect(checks.map((check) => check.context)).toEqual(["qualidade", "schema-e-migracao"]);
      for (const check of checks) {
        expect(check.integration_id).toBe(GITHUB_ACTIONS_APP_ID);
        expect(Object.keys(ci.jobs)).toContain(check.context);
      }
    }
  });

  it("dev e staging não recebem regra que recuse o push da promoção sem bypass possível", () => {
    // A API recusa o GitHub Actions como bypass em repositório de conta
    // pessoal; PR, CI ou update nessas branches travariam a promoção.
    for (const branch of ["dev", "staging"]) {
      for (const type of ["pull_request", "required_status_checks", "update"]) {
        expect(covering(branch, type)).toEqual([]);
      }
    }
    expect(desired.flatMap((set) => set.bypass_actors).some((actor) => actor.actor_type === "Integration")).toBe(false);
  });

  it("o ambiente de produção só aceita main e não tem bypass de admin", () => {
    expect(DESIRED_ENVIRONMENT.branch_policies).toEqual(["main"]);
    expect(DESIRED_ENVIRONMENT.can_admins_bypass).toBe(false);
  });

  it("a sonda reproduz as mesmas regras em outros nomes e recusa prefixo que alcance branch real", () => {
    const probe = desiredRulesets(probeBranches("sonda/protecoes-"), " [sonda]");
    expect(probe.map((set) => set.rules)).toEqual(desired.map((set) => set.rules));
    expect(probe.flatMap((set) => set.conditions.ref_name.include).every((ref) => ref.startsWith("refs/heads/sonda/protecoes-"))).toBe(true);
    expect(() => probeBranches("")).toThrow();
    expect(() => probeBranches("sonda")).toThrow();
  });
});

describe("comparação com o estado efetivo", () => {
  it("estado igual não diverge, mesmo com parâmetros extras que a API acrescenta", () => {
    const actual = clone();
    actual[2]!.rules[0]!.parameters!.automatic_copilot_code_review_enabled = false;
    actual[1]!.rules[0]!.parameters!.required_status_checks =
      [...(actual[1]!.rules[0]!.parameters!.required_status_checks as unknown[])].reverse();
    expect(compareRulesets(desired, actual)).toEqual([]);
  });

  it("ruleset ausente ou duplicado diverge", () => {
    expect(compareRulesets(desired, clone().slice(1))[0]).toMatch(/encontrado 0/);
    expect(compareRulesets(desired, [...clone(), clone()[0]!])[0]).toMatch(/encontrado 2/);
  });

  it.each([
    ["enforcement desligado", (sets: Ruleset[]) => { sets[0]!.enforcement = "evaluate"; }, /enforcement/],
    ["bypass a mais", (sets: Ruleset[]) => { sets[1]!.bypass_actors.push({ actor_id: GITHUB_ACTIONS_APP_ID, actor_type: "Integration", bypass_mode: "always" }); }, /bypass/],
    ["branch a menos", (sets: Ruleset[]) => { sets[0]!.conditions.ref_name.include.pop(); }, /branches/],
    ["exclusão de branch", (sets: Ruleset[]) => { sets[0]!.conditions.ref_name.exclude.push("refs/heads/main"); }, /branches/],
    ["regra removida", (sets: Ruleset[]) => { sets[0]!.rules.pop(); }, /regras/],
    ["check removido", (sets: Ruleset[]) => {
      const parameters = sets[1]!.rules[0]!.parameters!;
      parameters.required_status_checks = (parameters.required_status_checks as unknown[]).slice(1);
    }, /parâmetros/],
    ["modo estrito ligado", (sets: Ruleset[]) => { sets[1]!.rules[0]!.parameters!.strict_required_status_checks_policy = true; }, /parâmetros/],
    ["aprovação zerada", (sets: Ruleset[]) => { sets[2]!.rules[0]!.parameters!.required_approving_review_count = 0; }, /parâmetros/],
  ])("%s diverge", (_label, mutate, expected) => {
    const actual = clone();
    mutate(actual);
    expect(compareRulesets(desired, actual).join("\n")).toMatch(expected);
  });

  it("ambiente conforme, ausente, sem política de branch ou com bypass de admin", () => {
    expect(compareEnvironment(DESIRED_ENVIRONMENT, structuredClone(DESIRED_ENVIRONMENT))).toEqual([]);
    expect(compareEnvironment(DESIRED_ENVIRONMENT, null)).toEqual(["Production: ambiente ausente"]);
    const open = { ...structuredClone(DESIRED_ENVIRONMENT), can_admins_bypass: true, deployment_branch_policy: null, protection_rules: [], branch_policies: [] };
    expect(compareEnvironment(DESIRED_ENVIRONMENT, open)).toHaveLength(4);
    const reviewer = { ...structuredClone(DESIRED_ENVIRONMENT), protection_rules: [{ type: "branch_policy" }, { type: "required_reviewers" }] };
    expect(compareEnvironment(DESIRED_ENVIRONMENT, reviewer)).toEqual(["Production: regras branch_policy,required_reviewers"]);
  });
});
