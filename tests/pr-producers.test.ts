// Suite: produtores de PR (#203, V09-03)
// Invariant: toda PR aberta ou reaproveitada por automação tem responsável e base
//   nomeada; a PR de trabalho, aberta por agente, segue o mesmo contrato na skill
// Boundary IN: passos `gh pr create` de .github/workflows/*.yml, o texto de
//   .claude/skills/ship-pr/SKILL.md e o modelo de PR
// Boundary OUT: a execução dos passos, provada com `gh` falso em
//   tests/promotion-provenance.test.ts (reuso da promoção, criação do retorno)
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

/**
 * Cada cabeça de automação e a única base para a qual ela abre PR (G43).
 * PR de trabalho não está aqui: ela nasce de pessoa ou agente, sempre para `dev`.
 */
const BASE_BY_HEAD: Record<string, string> = {
  staging: "main", // promoção: PR humana para produção (G46)
  main: "dev", // retorno depois de main (G52)
};

type Step = { name?: string; run?: string };
type Workflow = { jobs: Record<string, { steps?: Step[] }> };

function producers(): { where: string; run: string }[] {
  const found: { where: string; run: string }[] = [];
  for (const file of readdirSync(".github/workflows").filter((name) => name.endsWith(".yml")).sort()) {
    const workflow = YAML.parse(readFileSync(`.github/workflows/${file}`, "utf8")) as Workflow;
    for (const [job, { steps = [] }] of Object.entries(workflow.jobs)) {
      steps.forEach((step, index) => {
        if (!step.run?.includes("gh pr create")) return;
        found.push({ where: `${file}:${job}:${step.name ?? `passo ${index + 1}`}`, run: step.run });
      });
    }
  }
  return found;
}

/**
 * Problemas de um passo que produz PR. A atribuição por REST cobre a PR
 * reaproveitada; se ela vem ANTES da criação (ramo de reuso que sai cedo), a
 * própria criação precisa carregar `--assignee`.
 */
function producerProblems(run: string): string[] {
  const problems: string[] = [];
  const create = run.slice(run.indexOf("gh pr create"));
  const base = /--base\s+(\S+)/.exec(create)?.[1];
  const head = /--head\s+(\S+)/.exec(create)?.[1];
  if (!base || !head) problems.push("`gh pr create` sem --base e --head explícitos");
  else if (BASE_BY_HEAD[head] !== base) problems.push(`base ${base} para ${head} não é exceção nomeada`);
  const rest = run.indexOf("assignees[]=andreustimm");
  if (rest < 0) problems.push("sem atribuição por REST, que cobre a PR reaproveitada");
  else if (rest < run.indexOf("gh pr create") && !/--assignee\s+andreustimm/.test(create)) {
    problems.push("a PR criada fica sem responsável: a atribuição só vale para o reuso");
  }
  return problems;
}

describe("V09-03 — toda PR de automação tem responsável e base nomeada", () => {
  it("encontra os dois produtores conhecidos, e nenhum escondido", () => {
    expect(producers().map(({ where }) => where.split(":")[0])).toEqual([
      "promover-para-staging.yml",
      "sincronizar-apos-main.yml",
    ]);
  });

  it.each(producers())("$where atribui a PR criada e a reaproveitada, com base nomeada", ({ run }) => {
    expect(producerProblems(run)).toEqual([]);
  });

  it("reprova PR criada sem responsável quando só o reuso é atribuído", () => {
    const run = [
      'if [ -n "$ABERTA" ]; then gh api --method POST "repos/x/issues/$ABERTA/assignees" -f \'assignees[]=andreustimm\'; exit 0; fi',
      "gh pr create --base main --head staging --title t",
    ].join("\n");
    expect(producerProblems(run)).toEqual(["a PR criada fica sem responsável: a atribuição só vale para o reuso"]);
  });

  it("reprova reuso sem atribuição e base fora das exceções", () => {
    expect(producerProblems("gh pr create --base main --head dev --assignee andreustimm")).toEqual([
      "base main para dev não é exceção nomeada",
      "sem atribuição por REST, que cobre a PR reaproveitada",
    ]);
    expect(producerProblems("gh pr create --title t")[0]).toContain("sem --base e --head");
  });

  it("a PR de trabalho aberta por agente vai para dev e ganha responsável", () => {
    const skill = readFileSync(".claude/skills/ship-pr/SKILL.md", "utf8");
    expect(skill).toContain("PR with base `dev`");
    expect(skill).toContain("repos/andreustimm/master-jobs/issues/<n>/assignees");
    expect(skill).toContain("No PR is left without an assignee.");
  });
});

describe("V09-04 — a PR declara docs, QA e a revisão do diff atual", () => {
  const template = readFileSync(".github/PULL_REQUEST_TEMPLATE.md", "utf8");

  it("pede a linha de docs e a de QA, que podem ser justificativa", () => {
    expect(template).toMatch(/^- Docs:/m);
    expect(template).toMatch(/^- QA de jornada ou justificativa/m);
  });

  it("pede o veredito junto com o SHA revisado, e não trata campo preenchido como prova", () => {
    expect(template).toMatch(/^- Revisão profunda \(veredito e SHA revisado\):/m);
    expect(template.replace(/\s+/g, " ")).toContain("revisão de um SHA anterior a mudança relevante não aprova o diff atual");
    expect(template).toContain("FIX_BEFORE_SHIP");
  });
});
