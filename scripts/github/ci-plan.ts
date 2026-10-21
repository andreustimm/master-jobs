/**
 * O plano do CI de PR (issue #535): quais jobs pesados uma PR para `dev` paga.
 *
 * Decisão do dono, 13/10/2026, que afrouxou a G57 só em PR: o E2E roda quando
 * a tabela de impacto (`config/validation-impact.json`, `planGates`) pede o
 * gate `e2e` para o diff — não em toda PR. Diagnóstico do mesmo dia: o
 * `e2e-navegador` era 41,6% dos minutos do `ci.yml` (15,3 min por execução), e
 * 18 de 50 PRs não tocavam nada que a tabela mande testar em navegador.
 *
 * Falha fechada: tudo o que não for PR para `dev` com diff legível e
 * conhecido recebe o plano completo. Evento que não é `pull_request` (push em
 * `dev`, `staging` e `main`, `workflow_dispatch`), a chamada da promoção
 * (`target-sha`), PR de outra base (a de produção é `staging → main`), diff
 * vazio ou ilegível, e qualquer PR que mude o próprio plano — o plano não
 * relaxa a si mesmo. O que a PR deixa de rodar, o push em `dev` roda.
 *
 * O script lê o diff do commit de merge que o `pull_request` testa, contra o
 * primeiro pai, que é a base. Escreve `e2e=<true|false>` na saída padrão (o
 * passo a redireciona para `$GITHUB_OUTPUT`) e o motivo na saída de erro.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { planGates, validateImpactMap, type ImpactMap } from "../gates/impact.ts";

export const IMPACT_FILE = "config/validation-impact.json";

/**
 * Arquivos que decidem o plano. PR que muda um deles recebe o plano completo:
 * o plano antigo não pode aprovar o relaxamento que a própria PR escreveu.
 */
export const PLAN_SELF_PATHS: readonly string[] = [
  ".github/workflows/ci.yml",
  "scripts/github/ci-plan.ts",
  "scripts/gates/impact.ts",
  IMPACT_FILE,
];

/** A base cujas PRs recebem o plano recortado. As outras (produção) rodam tudo. */
export const PLANNED_BASE = "dev";

export type PlanInput = {
  /** `github.event_name` */
  event: string | undefined;
  /** `github.base_ref`, só existe em `pull_request` */
  baseRef: string | undefined;
  /** `inputs.target-sha`, só existe na chamada reutilizável da promoção */
  targetSha: string | undefined;
};

export type CiPlan = {
  /** Roda o job `e2e-navegador`. */
  e2e: boolean;
  motivo: string;
};

const full = (motivo: string): CiPlan => ({ e2e: true, motivo: `${motivo}: plano completo` });
const firstLine = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0];

/**
 * Os caminhos que a PR muda: o commit de merge contra o primeiro pai.
 * `--no-renames` lista origem e destino de um arquivo movido, e `-z` não deixa
 * o Git escapar nome com acento. Um HEAD que não é commit de merge não tem
 * "primeiro pai = base", então não prova nada sobre o diff e lança.
 */
export function changedPaths(git: (args: string[]) => string): string[] {
  try {
    git(["rev-parse", "--verify", "--quiet", "HEAD^2"]);
  } catch {
    throw new Error("HEAD não é um commit de merge de PR");
  }
  return git(["diff", "--name-only", "--no-renames", "-z", "HEAD^1", "HEAD", "--"])
    .split("\0")
    .filter((path) => path !== "");
}

/** Pura: o mapa e o diff chegam prontos, e o Git é injetado. */
export function ciPlan(input: PlanInput, map: ImpactMap, diff: () => string[]): CiPlan {
  if (input.event !== "pull_request") return full(`evento ${input.event ?? "ausente"}`);
  if (input.targetSha) return full("chamada da promoção (target-sha)");
  if (input.baseRef !== PLANNED_BASE) return full(`PR com base ${input.baseRef ?? "ausente"}, não ${PLANNED_BASE}`);
  let paths: string[];
  try {
    paths = diff();
  } catch (error) {
    return full(`diff ilegível (${firstLine(error)})`);
  }
  if (paths.length === 0) return full("diff vazio");
  const self = paths.find((path) => PLAN_SELF_PATHS.includes(path));
  if (self !== undefined) return full(`${self} muda o próprio plano`);
  let gates: string[];
  try {
    gates = planGates(map, paths).gates.map((gate) => gate.id);
  } catch (error) {
    return full(`caminho inválido (${firstLine(error)})`);
  }
  const e2e = gates.includes("e2e");
  return {
    e2e,
    motivo: `${paths.length} arquivo(s); a tabela de impacto ${e2e ? "pede" : "não pede"} o gate e2e`,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const map = validateImpactMap(JSON.parse(readFileSync(IMPACT_FILE, "utf8")));
  const plan = ciPlan(
    { event: process.env.EVENTO, baseRef: process.env.BASE_REF, targetSha: process.env.TARGET_SHA },
    map,
    () => changedPaths((args) => execFileSync("git", args, { encoding: "utf8" })),
  );
  console.error(`plano: ${plan.motivo}`);
  console.log(`e2e=${plan.e2e}`);
}
