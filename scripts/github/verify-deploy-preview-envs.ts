/**
 * Contrato entre a variável de repositório `DEPLOY_PREVIEW_ENVS` e o
 * `git.deploymentEnabled` de `vercel.json` (Fase 1 da #351).
 *
 * A Vercel não lê variável de ambiente dentro de `vercel.json` — o arquivo é
 * o mecanismo real. `DEPLOY_PREVIEW_ENVS` é só o registro documentado de qual
 * ambiente de preview está religado, para que exista "um lugar só" (princípio
 * 1 do PRD da #351) em vez de "abra o JSON e edite à mão". Este script prova
 * que o registro nunca mente sobre o que `vercel.json` realmente aplica.
 *
 * Contrato: docs/engineering/deploy.md, seção "Branches que geram deploy".
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ghApi } from "../release/promotion-ci.ts";

/** Único subconjunto aceito na variável — `main` nunca depende dela. */
export const PREVIEW_BRANCHES = ["dev", "staging"] as const;
export type PreviewBranch = (typeof PREVIEW_BRANCHES)[number];

export class InvalidDeployPreviewEnvs extends Error {}

/**
 * Interpreta o valor bruto da variável: `""`, `"dev"`, `"dev,staging"`.
 * Espaço em volta de cada item é tolerado; o resto (valor fora de
 * `{dev, staging}`, duplicata, `main` na lista) é recusado. Ausência conta
 * como string vazia — nenhum ambiente religado.
 */
export function parseDeployPreviewEnvs(raw: string | undefined | null): PreviewBranch[] {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return [];
  const items = trimmed.split(",").map((item) => item.trim());
  const seen = new Set<string>();
  const result: PreviewBranch[] = [];
  for (const item of items) {
    if (!(PREVIEW_BRANCHES as readonly string[]).includes(item)) {
      throw new InvalidDeployPreviewEnvs(
        `DEPLOY_PREVIEW_ENVS: valor fora de {${PREVIEW_BRANCHES.join(", ")}}: "${item}"`,
      );
    }
    if (seen.has(item)) {
      throw new InvalidDeployPreviewEnvs(`DEPLOY_PREVIEW_ENVS: item duplicado: "${item}"`);
    }
    seen.add(item);
    result.push(item as PreviewBranch);
  }
  return result;
}

export type DeploymentEnabledMap = { "**": boolean; main: boolean; dev: boolean; staging: boolean };

/** `git.deploymentEnabled` esperado a partir da variável já interpretada. */
export function expectedDeploymentEnabled(envs: PreviewBranch[]): DeploymentEnabledMap {
  const enabled = new Set<PreviewBranch>(envs);
  return { "**": false, main: true, dev: enabled.has("dev"), staging: enabled.has("staging") };
}

/** Lista cada diferença entre o mapa esperado e o `vercel.json` real. */
export function compareDeploymentEnabled(
  expected: DeploymentEnabledMap,
  actual: Record<string, unknown>,
): string[] {
  const problems: string[] = [];
  for (const key of ["**", "main", "dev", "staging"] as const) {
    if (actual[key] !== expected[key]) {
      problems.push(
        `git.deploymentEnabled.${key}: esperado ${expected[key]}, encontrado ${JSON.stringify(actual[key])}`,
      );
    }
  }
  return problems;
}

export type ReadVariable = (repo: string, name: string) => string | undefined;

export type VerifyResult = { raw: string | undefined; envs: PreviewBranch[]; problems: string[] };

/**
 * Une leitura interpretada da variável e comparação com `vercel.json`.
 * `readVariable` é injetado para que o teste use um fake, sem `gh api` real.
 */
export function verifyDeployPreviewEnvs(
  repo: string,
  vercelDeploymentEnabled: Record<string, unknown>,
  readVariable: ReadVariable,
): VerifyResult {
  const raw = readVariable(repo, "DEPLOY_PREVIEW_ENVS");
  const envs = parseDeployPreviewEnvs(raw);
  const expected = expectedDeploymentEnabled(envs);
  return { raw, envs, problems: compareDeploymentEnabled(expected, vercelDeploymentEnabled) };
}

function readRepositoryVariable(repo: string, name: string): string | undefined {
  try {
    return ghApi<{ value: string }>(`repos/${repo}/actions/variables/${name}`).value;
  } catch (error) {
    // Só a ausência da variável é "religamento nenhum"; credencial vencida ou
    // rede fora do ar não podem virar silenciosamente "sem divergência".
    if (String((error as { stderr?: unknown }).stderr ?? "").includes("HTTP 404")) return undefined;
    throw error;
  }
}

function readVercelDeploymentEnabled(path: string): Record<string, unknown> {
  const config = JSON.parse(readFileSync(path, "utf8")) as { git?: { deploymentEnabled?: Record<string, unknown> } };
  return config.git?.deploymentEnabled ?? {};
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
  try {
    const actual = readVercelDeploymentEnabled(resolve("vercel.json"));
    const { raw, problems } = verifyDeployPreviewEnvs(repo, actual, readRepositoryVariable);
    if (problems.length === 0) {
      console.log(`ok      DEPLOY_PREVIEW_ENVS="${raw ?? ""}" casa com vercel.json`);
      process.exitCode = 0;
    } else {
      console.error(`DIVERGE DEPLOY_PREVIEW_ENVS="${raw ?? ""}" não casa com vercel.json`);
      for (const problem of problems) console.error(`- ${problem}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
