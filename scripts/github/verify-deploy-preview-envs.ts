/**
 * Contrato entre a variável de repositório `DEPLOY_PREVIEW_ENVS` e o
 * `git.deploymentEnabled` de `vercel.json` (Fase 1 da #351).
 *
 * A Vercel não lê variável de ambiente dentro de `vercel.json` — o arquivo é
 * o mecanismo real, e ela o aplica pelo commit de **cada branch** (main, dev,
 * staging podem ter conteúdo diferente se algum dia divergirem). Por isso o
 * verificador confere o arquivo na ponta das três, nunca só o checkout local.
 * `DEPLOY_PREVIEW_ENVS` é só o registro documentado de qual ambiente de
 * preview está religado, para que exista "um lugar só" (princípio 1 do PRD da
 * #351) em vez de "abra o JSON e edite à mão".
 *
 * `GITHUB_TOKEN` não lê a API de variáveis de repositório (403, mesmo com
 * `actions: read` declarado) — só um PAT/CLI autenticado por humano lê. Por
 * isso o job de CI nunca chama `gh api .../variables/...`: ele recebe o valor
 * já resolvido pelo próprio motor de workflow (`env: DEPLOY_PREVIEW_ENVS: $
 * {{ vars.DEPLOY_PREVIEW_ENVS }}`), e o script lê `process.env`. `gh api` para
 * a variável só entra no uso manual, com a credencial de quem roda o comando.
 * Ler o `vercel.json` de cada branch (API de conteúdo) não tem essa restrição:
 * `contents: read` é suficiente para `GITHUB_TOKEN`, em CI e manual.
 *
 * Contrato: docs/engineering/deploy.md, seção "Branches que geram deploy".
 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { ghApi } from "../release/promotion-ci.ts";

/** Único subconjunto aceito na variável — `main` nunca depende dela. */
export const PREVIEW_BRANCHES = ["dev", "staging"] as const;
export type PreviewBranch = (typeof PREVIEW_BRANCHES)[number];

/** As três branches cujo `vercel.json` publicado precisa ser consultado. */
export const RELEVANT_BRANCHES = ["main", "dev", "staging"] as const;
export type RelevantBranch = (typeof RELEVANT_BRANCHES)[number];

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

/** Única lista de permissão de chaves — G27/G28: quem pede menos é recusado. */
export const ALLOWED_DEPLOYMENT_KEYS = ["**", "main", "dev", "staging"] as const;

/** `git.deploymentEnabled` esperado a partir da variável já interpretada. */
export function expectedDeploymentEnabled(envs: PreviewBranch[]): DeploymentEnabledMap {
  const enabled = new Set<PreviewBranch>(envs);
  return { "**": false, main: true, dev: enabled.has("dev"), staging: enabled.has("staging") };
}

/**
 * Lista cada diferença entre o mapa esperado e o `vercel.json` real —
 * inclusive uma chave fora da lista de permissão (ex.: `"release/*": true`),
 * que deployaria um padrão de branch sem que a variável documentada saiba.
 */
export function compareDeploymentEnabled(
  expected: DeploymentEnabledMap,
  actual: Record<string, unknown>,
): string[] {
  const problems: string[] = [];
  for (const key of ALLOWED_DEPLOYMENT_KEYS) {
    if (actual[key] !== expected[key]) {
      problems.push(
        `git.deploymentEnabled.${key}: esperado ${expected[key]}, encontrado ${JSON.stringify(actual[key])}`,
      );
    }
  }
  for (const key of Object.keys(actual)) {
    if (!(ALLOWED_DEPLOYMENT_KEYS as readonly string[]).includes(key)) {
      problems.push(
        `git.deploymentEnabled.${key}: chave fora da lista de permissão {${ALLOWED_DEPLOYMENT_KEYS.join(", ")}} — valor ${JSON.stringify(actual[key])}`,
      );
    }
  }
  return problems;
}

export type ReadVariable = (repo: string, name: string) => string | undefined;

export type VerifyResult = { raw: string | undefined; envs: PreviewBranch[]; problems: string[] };

/**
 * Une leitura interpretada da variável e comparação com um único mapa de
 * `vercel.json`. `readVariable` é injetado para que o teste use um fake, sem
 * `gh api` real. Ponto de partida simples; `verifyDeployPreviewEnvsAcrossBranches`
 * é o que o CLI usa de verdade, porque um mapa só (de um checkout local, por
 * exemplo) não prova nada sobre as outras branches.
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

export type ReadVercelConfigAt = (repo: string, ref: string) => Record<string, unknown>;

export type MultiBranchResult = { raw: string | undefined; envs: PreviewBranch[]; problems: string[] };

/**
 * Confere a variável contra o `vercel.json` publicado em cada branch de
 * `branches` (não o checkout local): a Vercel aplica o arquivo do commit de
 * cada branch, então só isso prova que nenhuma delas divergiu em silêncio
 * (ex.: alguém editou `vercel.json` direto em `dev`, sem passar por `main`).
 * Cada problema é prefixado com a branch em que apareceu.
 */
export function verifyDeployPreviewEnvsAcrossBranches(
  repo: string,
  branches: readonly string[],
  readVariable: ReadVariable,
  readVercelConfigAt: ReadVercelConfigAt,
): MultiBranchResult {
  const raw = readVariable(repo, "DEPLOY_PREVIEW_ENVS");
  const envs = parseDeployPreviewEnvs(raw);
  const expected = expectedDeploymentEnabled(envs);
  const problems: string[] = [];
  for (const branch of branches) {
    const actual = readVercelConfigAt(repo, branch);
    for (const problem of compareDeploymentEnabled(expected, actual)) {
      problems.push(`${branch}: ${problem}`);
    }
  }
  return { raw, envs, problems };
}

/** Assinatura mínima de `ghApi`, para injetar um fake nos testes. */
export type GhApi = <T>(path: string) => T;

/** O código HTTP embutido no erro do `gh api`, se houver um. */
export function httpStatusOf(error: unknown): number | undefined {
  const stderr = String((error as { stderr?: unknown } | undefined)?.stderr ?? "");
  const match = /HTTP (\d+)/.exec(stderr);
  return match ? Number(match[1]) : undefined;
}

/** Lançado só quando o próprio repositório não existe/não é alcançável. */
export class RepositoryNotFound extends Error {}

/**
 * Confirma a existência do repositório. Usado para distinguir "a variável
 * não existe" (404 do endpoint de variável, com o repositório presente) de
 * "o repositório é que não existe" (404 também, mas de outra causa) — os
 * dois chegam com a mesma mensagem genérica "Not Found" do `gh api`.
 */
export function assertRepositoryExists(repo: string, api: GhApi = ghApi): void {
  try {
    api(`repos/${repo}`);
  } catch (error) {
    if (httpStatusOf(error) === 404) throw new RepositoryNotFound(`repositório não encontrado: ${repo}`);
    throw error;
  }
}

/**
 * Lê `DEPLOY_PREVIEW_ENVS` pela API de variáveis — só para uso manual, com a
 * credencial de quem roda o comando (`GITHUB_TOKEN` não tem acesso a este
 * endpoint). 404 vira "variável ausente" **somente** depois de confirmar que
 * o repositório existe; qualquer outro código (403 incluído) propaga o erro
 * — dado indisponível nunca finge normalidade (mesmo espírito da regra 8).
 */
export function readRepositoryVariable(repo: string, name: string, api: GhApi = ghApi): string | undefined {
  try {
    return api<{ value: string }>(`repos/${repo}/actions/variables/${name}`).value;
  } catch (error) {
    if (httpStatusOf(error) !== 404) throw error;
    assertRepositoryExists(repo, api);
    return undefined;
  }
}

/** `readVariable` que lê só `process.env`, para o job de CI (nunca `gh api`). */
export function readVariableFromEnv(env: Record<string, string | undefined>): ReadVariable {
  return (_repo, name) => (Object.hasOwn(env, name) ? env[name] : undefined);
}

/**
 * `vercel.json` publicado na ponta de `ref`, pela API de conteúdo — não o
 * checkout local. `contents: read` basta para `GITHUB_TOKEN`, em CI e manual.
 */
export function readVercelConfigAtRef(repo: string, ref: string, api: GhApi = ghApi): Record<string, unknown> {
  const response = api<{ content: string; encoding: string }>(
    `repos/${repo}/contents/vercel.json?ref=${encodeURIComponent(ref)}`,
  );
  if (response.encoding !== "base64") {
    throw new Error(`vercel.json em ${ref}: codificação inesperada "${response.encoding}"`);
  }
  const decoded = Buffer.from(response.content, "base64").toString("utf8");
  const config = JSON.parse(decoded) as { git?: { deploymentEnabled?: Record<string, unknown> } };
  return config.git?.deploymentEnabled ?? {};
}

function option(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} exige um valor`);
  return value;
}

export type CliDeps = {
  readVariable: ReadVariable;
  readVercelConfigAt: ReadVercelConfigAt;
  log?: (line: string) => void;
  logError?: (line: string) => void;
};

/**
 * Corpo do CLI, sem `process.exit`: devolve o código de saída, para que o
 * teste chame direto, com dependências fake, sem subprocesso nem rede.
 */
export function runCli(argv: string[], deps: CliDeps): number {
  const repo = option(argv, "--repo") ?? "andreustimm/master-jobs";
  const log = deps.log ?? console.log;
  const logError = deps.logError ?? console.error;
  try {
    const { raw, problems } = verifyDeployPreviewEnvsAcrossBranches(
      repo,
      RELEVANT_BRANCHES,
      deps.readVariable,
      deps.readVercelConfigAt,
    );
    if (problems.length === 0) {
      log(`ok      DEPLOY_PREVIEW_ENVS="${raw ?? ""}" casa com vercel.json em ${RELEVANT_BRANCHES.join(", ")}`);
      return 0;
    }
    logError(`DIVERGE DEPLOY_PREVIEW_ENVS="${raw ?? ""}" não casa com vercel.json`);
    for (const problem of problems) logError(`- ${problem}`);
    return 1;
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // Em CI, o workflow injeta DEPLOY_PREVIEW_ENVS no env (`vars.…` resolvido
  // pelo próprio motor); GITHUB_TOKEN nunca chama a API de variáveis. Sem o
  // env (uso manual), cai para `gh api`, com a credencial de quem roda.
  const readVariable: ReadVariable = Object.hasOwn(process.env, "DEPLOY_PREVIEW_ENVS")
    ? readVariableFromEnv(process.env)
    : (repo, name) => readRepositoryVariable(repo, name);
  process.exitCode = runCli(process.argv.slice(2), { readVariable, readVercelConfigAt: readVercelConfigAtRef });
}
