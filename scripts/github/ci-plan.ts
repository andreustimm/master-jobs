/**
 * O plano do CI de PR (issue #535): quais jobs pesados uma PR para `dev` paga.
 *
 * Decisão do dono, 13/10/2026, que afrouxou a G57 só em PR. Diagnóstico do
 * mesmo dia: o `e2e-navegador` era 41,6% dos minutos do `ci.yml` (15,3 min por
 * execução) e `banco-nas-majors` 13%. Uma saída por job recortado, cada uma
 * decidida por uma entrada de `DECISIONS`:
 *
 * - `e2e` (`e2e-navegador`): a tabela de impacto (`config/validation-impact.json`,
 *   `planGates`) pede o gate `e2e` para o diff.
 * - `banco` (`banco-nas-majors`): o diff toca `DATABASE_PATTERNS`.
 *
 * O item da decisão que pulava `testes`, `cobertura` e `build` em PR só de
 * documentação NÃO está aqui: o recorte de documentação é o do job `escopo`
 * (#528, `pr-scope.ts`), que mediu que o Vitest lê `DESIGN.md`, regras e skills
 * e que o Tailwind varre os `.md` — a fonte mais protetora vale (G62).
 *
 * Recorte novo entra como uma chave em `DECISIONS`, a saída de mesmo nome no
 * job `plano` e o pulo dela nos agregadores; o resto do plano não muda.
 *
 * Falha fechada: tudo o que não for PR para `dev` com diff legível e
 * conhecido recebe o plano completo. Evento que não é `pull_request` (push em
 * `dev`, `staging` e `main`, `workflow_dispatch`), a chamada da promoção
 * (`target-sha`), PR de outra base (a de produção é `staging → main`), diff
 * vazio ou ilegível, e qualquer PR que mude o próprio plano — o plano não
 * relaxa a si mesmo. O que a PR deixa de rodar, o push em `dev` roda.
 *
 * O script lê o diff do commit de merge que o `pull_request` testa, contra o
 * primeiro pai, que é a base. Escreve `<saída>=<true|false>` na saída padrão (o
 * passo a redireciona para `$GITHUB_OUTPUT`) e o motivo na saída de erro.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { globToRegex, planGates, validateImpactMap, type ImpactMap } from "../gates/impact.ts";

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

/**
 * Onde uma mudança pode quebrar o banco numa major do PostgreSQL. Fora disto,
 * `banco-nas-majors` só roda no push em `dev`.
 *
 * As cinco primeiras entradas são a decisão do dono de 13/10/2026. As outras
 * fecham o que a revisão do orquestrador achou fora dela, no mesmo dia:
 * dependência (`package.json`, `pnpm-lock.yaml`: um bump do driver do
 * PostgreSQL muda como as queries chegam ao banco, e é exatamente o PR que o
 * Renovate abre), a configuração do `drizzle-kit` (`drizzle.config.ts` só
 * reexporta `drizzle.postgres.config.ts`, que é a que vale) e o runner do
 * próprio `banco-nas-majors`.
 */
export const DATABASE_PATTERNS: readonly string[] = [
  "drizzle/**",
  "src/core/db/**",
  "supabase/**",
  "tests/support/**",
  "config/postgres-majors.json",
  "package.json",
  "pnpm-lock.yaml",
  "drizzle.config.ts",
  "drizzle.postgres.config.ts",
  "scripts/versions/postgres-majors.ts",
];

/** O que cada decisão recebe: os caminhos da PR e os gates que a tabela pede para eles. */
export type PlanFacts = { paths: readonly string[]; gates: readonly string[] };

const DATABASE_REGEXES = DATABASE_PATTERNS.map(globToRegex);

/** Uma entrada por saída do job `plano`: `true` roda o job, `false` o pula. */
export const DECISIONS = {
  e2e: ({ gates }: PlanFacts) => gates.includes("e2e"),
  banco: ({ paths }: PlanFacts) => paths.some((path) => DATABASE_REGEXES.some((pattern) => pattern.test(path))),
} as const satisfies Record<string, (facts: PlanFacts) => boolean>;

export type PlanOutput = keyof typeof DECISIONS;
export const PLAN_OUTPUTS = Object.keys(DECISIONS) as PlanOutput[];

export type CiPlan = Record<PlanOutput, boolean> & { motivo: string };

const decide = (facts: PlanFacts | null, motivo: string): CiPlan => {
  const plan = { motivo } as CiPlan;
  for (const output of PLAN_OUTPUTS) plan[output] = facts === null || DECISIONS[output](facts);
  return plan;
};
const full = (motivo: string): CiPlan => decide(null, `${motivo}: plano completo`);
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
  const facts = { paths, gates };
  const ran = PLAN_OUTPUTS.map((output) => `${output} ${DECISIONS[output](facts) ? "roda" : "pula"}`);
  return decide(facts, `${paths.length} arquivo(s); ${ran.join(", ")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const map = validateImpactMap(JSON.parse(readFileSync(IMPACT_FILE, "utf8")));
  const plan = ciPlan(
    { event: process.env.EVENTO, baseRef: process.env.BASE_REF, targetSha: process.env.TARGET_SHA },
    map,
    () => changedPaths((args) => execFileSync("git", args, { encoding: "utf8" })),
  );
  console.error(`plano: ${plan.motivo}`);
  for (const output of PLAN_OUTPUTS) console.log(`${output}=${plan[output]}`);
}
