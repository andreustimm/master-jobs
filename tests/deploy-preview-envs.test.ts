// Suite: Fase 1 da contingência de CI e deploy (#351) — deploy só em `main`.
// vercel.json é o mecanismo real, aplicado pelo commit de cada branch, e
// DEPLOY_PREVIEW_ENVS é o registro documentado. Este contrato prova que os
// dois nunca divergem, em nenhuma das três branches, e que a leitura da
// variável nunca finge normalidade quando a API não responde o que se espera.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  ALLOWED_DEPLOYMENT_KEYS,
  InvalidDeployPreviewEnvs,
  RELEVANT_BRANCHES,
  RepositoryNotFound,
  assertRepositoryExists,
  compareDeploymentEnabled,
  compareEffectiveDeploymentEnabled,
  expectedDeploymentEnabled,
  httpStatusOf,
  parseDeployPreviewEnvs,
  readRepositoryVariable,
  readVariableFromEnv,
  runCli,
  verifyDeployPreviewEnvs,
  verifyDeployPreviewEnvsAcrossBranches,
  type ReadVariable,
} from "../scripts/github/verify-deploy-preview-envs.ts";

const vercelConfig = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  git: { deploymentEnabled: { "**": boolean; main: boolean; dev: boolean; staging: boolean } };
};

function ghError(httpStatus: number): Error & { stderr: string } {
  const error = new Error(`Command failed`) as Error & { stderr: string };
  error.stderr = `gh: ${httpStatus === 404 ? "Not Found" : "Forbidden"} (HTTP ${httpStatus})\n`;
  return error;
}

describe("vercel.json — deploy só em main (F1-01, F1-02)", () => {
  it("F1-01: main deploya e dev/staging não", () => {
    expect(vercelConfig.git.deploymentEnabled.main).toBe(true);
    expect(vercelConfig.git.deploymentEnabled.dev).toBe(false);
    expect(vercelConfig.git.deploymentEnabled.staging).toBe(false);
  });

  it("F1-02: nenhuma branch de tarefa deploya", () => {
    expect(vercelConfig.git.deploymentEnabled["**"]).toBe(false);
  });
});

describe("parseDeployPreviewEnvs (F1-03)", () => {
  it.each([
    ["", []],
    ["dev", ["dev"]],
    ["dev,staging", ["dev", "staging"]],
    [" dev , staging ", ["dev", "staging"]],
  ] as const)("aceita %j", (raw, expected) => {
    expect(parseDeployPreviewEnvs(raw)).toEqual(expected);
  });

  it("ausente conta como nenhum ambiente religado", () => {
    expect(parseDeployPreviewEnvs(undefined)).toEqual([]);
    expect(parseDeployPreviewEnvs(null)).toEqual([]);
  });

  it("recusa main na lista — main nunca depende da variável", () => {
    expect(() => parseDeployPreviewEnvs("main")).toThrow(InvalidDeployPreviewEnvs);
    expect(() => parseDeployPreviewEnvs("dev,main")).toThrow(InvalidDeployPreviewEnvs);
  });

  it("recusa valor desconhecido", () => {
    expect(() => parseDeployPreviewEnvs("producao")).toThrow(InvalidDeployPreviewEnvs);
  });

  it("recusa duplicata", () => {
    expect(() => parseDeployPreviewEnvs("dev,dev")).toThrow(InvalidDeployPreviewEnvs);
  });
});

describe("expectedDeploymentEnabled / compareDeploymentEnabled", () => {
  it("main é sempre true, com qualquer lista de ambientes", () => {
    expect(expectedDeploymentEnabled([]).main).toBe(true);
    expect(expectedDeploymentEnabled(["dev", "staging"]).main).toBe(true);
  });

  it("** é sempre false — branch de tarefa nunca deploya, mesmo com a lista vazia", () => {
    expect(expectedDeploymentEnabled([])["**"]).toBe(false);
    expect(expectedDeploymentEnabled(["dev", "staging"])["**"]).toBe(false);
  });

  it("religa exatamente o que a lista pede, e mais nada", () => {
    expect(expectedDeploymentEnabled(["dev"])).toEqual({ "**": false, main: true, dev: true, staging: false });
  });

  it("compareDeploymentEnabled não acusa nada quando os mapas casam", () => {
    const expected = expectedDeploymentEnabled([]);
    expect(compareDeploymentEnabled(expected, vercelConfig.git.deploymentEnabled)).toEqual([]);
  });

  it("compareDeploymentEnabled acusa cada chave que diverge", () => {
    const expected = expectedDeploymentEnabled(["dev"]);
    const problems = compareDeploymentEnabled(expected, { "**": false, main: true, dev: false, staging: false });
    expect(problems).toEqual(["git.deploymentEnabled.dev: esperado true, encontrado false"]);
  });

  it("MAJOR 3: acusa chave fora da lista de permissão, mesmo com as quatro conhecidas corretas", () => {
    const expected = expectedDeploymentEnabled([]);
    const actual = { ...expected, "release/*": true };
    const problems = compareDeploymentEnabled(expected, actual);
    expect(problems).toEqual([
      `git.deploymentEnabled.release/*: chave fora da lista de permissão {${ALLOWED_DEPLOYMENT_KEYS.join(", ")}} — valor true`,
    ]);
  });

  it("MAJOR 3: a lista de permissão é exatamente {**, main, dev, staging}", () => {
    expect(ALLOWED_DEPLOYMENT_KEYS).toEqual(["**", "main", "dev", "staging"]);
  });
});

describe("verifyDeployPreviewEnvs — detecta divergência com um fake de gh api (F1-04)", () => {
  it("acusa quando a variável religa dev, mas vercel.json continua com dev:false", () => {
    const fakeRead: ReadVariable = () => "dev";
    const { problems } = verifyDeployPreviewEnvs(
      "andreustimm/master-jobs",
      vercelConfig.git.deploymentEnabled,
      fakeRead,
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it("sem divergência quando a variável está ausente e vercel.json é o padrão desta entrega", () => {
    const fakeRead: ReadVariable = () => undefined;
    const { problems, envs } = verifyDeployPreviewEnvs(
      "andreustimm/master-jobs",
      vercelConfig.git.deploymentEnabled,
      fakeRead,
    );
    expect(envs).toEqual([]);
    expect(problems).toEqual([]);
  });

  it("propaga erro de valor inválido na variável, em vez de mascarar como ok", () => {
    const fakeRead: ReadVariable = () => "producao";
    expect(() =>
      verifyDeployPreviewEnvs("andreustimm/master-jobs", vercelConfig.git.deploymentEnabled, fakeRead),
    ).toThrow(InvalidDeployPreviewEnvs);
  });
});

describe("MAJOR 2 — verifyDeployPreviewEnvsAcrossBranches confere a ponta de cada branch, não o checkout local", () => {
  it("sem divergência quando as três branches casam com a variável ausente", () => {
    const readVariable: ReadVariable = () => undefined;
    const readVercelConfigAt = () => vercelConfig.git.deploymentEnabled;
    const { problems } = verifyDeployPreviewEnvsAcrossBranches(
      "andreustimm/master-jobs",
      RELEVANT_BRANCHES,
      readVariable,
      readVercelConfigAt,
    );
    expect(problems).toEqual([]);
  });

  it("acusa só a branch divergente, prefixada pelo nome, quando dev foi editado sem passar por main", () => {
    const readVariable: ReadVariable = () => undefined;
    const perBranch: Record<string, Record<string, unknown>> = {
      main: vercelConfig.git.deploymentEnabled,
      // dev foi editado direto, religando o próprio ambiente sem tocar a
      // variável — exatamente o cenário que checar só o checkout de main não pega.
      dev: { "**": false, main: true, dev: true, staging: false },
      staging: vercelConfig.git.deploymentEnabled,
    };
    const readVercelConfigAt = (_repo: string, ref: string) => perBranch[ref]!;
    const { problems } = verifyDeployPreviewEnvsAcrossBranches(
      "andreustimm/master-jobs",
      RELEVANT_BRANCHES,
      readVariable,
      readVercelConfigAt,
    );
    expect(problems).toEqual(["dev: git.deploymentEnabled.dev: esperado false, encontrado true"]);
  });

  it("MAJOR (re-revisão): não acusa main pela chave dev/staging erradas — só o que decide o deploy de main", () => {
    // As três branches têm o mesmo mapa errado (dev/staging religados sem a
    // variável). Antes da correção, comparar o mapa inteiro acusava main
    // também, por causa de chaves que main nunca usa para decidir o próprio
    // deploy — 6 problemas em vez de 2.
    const readVariable: ReadVariable = () => undefined;
    const readVercelConfigAt = () => ({ "**": false, main: true, dev: true, staging: true });
    const { problems } = verifyDeployPreviewEnvsAcrossBranches(
      "andreustimm/master-jobs",
      RELEVANT_BRANCHES,
      readVariable,
      readVercelConfigAt,
    );
    expect(problems).toEqual([
      "dev: git.deploymentEnabled.dev: esperado false, encontrado true",
      "staging: git.deploymentEnabled.staging: esperado false, encontrado true",
    ]);
  });

  it("estado de transição do runbook de religar: dev/staging já com dev:true, main ainda não mesclou — sem falso positivo", () => {
    // Cenário exato da re-revisão: DEPLOY_PREVIEW_ENVS já diz "dev"; a PR que
    // religou dev já foi mesclada e promovida a staging; main ainda não. Isso
    // não é uma divergência real — nada no deploy de main depende da chave
    // dev do arquivo de main.
    const readVariable: ReadVariable = () => "dev";
    const perBranch: Record<string, Record<string, unknown>> = {
      main: { "**": false, main: true, dev: false, staging: false },
      dev: { "**": false, main: true, dev: true, staging: false },
      staging: { "**": false, main: true, dev: true, staging: false },
    };
    const readVercelConfigAt = (_repo: string, ref: string) => perBranch[ref]!;
    const { problems } = verifyDeployPreviewEnvsAcrossBranches(
      "andreustimm/master-jobs",
      RELEVANT_BRANCHES,
      readVariable,
      readVercelConfigAt,
    );
    expect(problems).toEqual([]);
  });
});

describe("compareEffectiveDeploymentEnabled — só a chave própria da branch, ** e chaves extras (re-revisão)", () => {
  it("não acusa a branch pela chave de outra branch", () => {
    const expected = expectedDeploymentEnabled(["dev"]); // {**:false, main:true, dev:true, staging:false}
    // O arquivo de main ainda não religou dev, mas main:true está certo — só
    // isso importa para decidir o deploy de main.
    const actual = { "**": false, main: true, dev: false, staging: false };
    expect(compareEffectiveDeploymentEnabled("main", expected, actual)).toEqual([]);
  });

  it("acusa quando a própria chave da branch diverge", () => {
    const expected = expectedDeploymentEnabled(["dev"]);
    const actual = { "**": false, main: true, dev: false, staging: false };
    expect(compareEffectiveDeploymentEnabled("dev", expected, actual)).toEqual([
      "git.deploymentEnabled.dev: esperado true, encontrado false",
    ]);
  });

  it("acusa ** true, em qualquer branch — protege contra deploy de branch de tarefa", () => {
    const expected = expectedDeploymentEnabled([]);
    const actual = { "**": true, main: true, dev: false, staging: false };
    expect(compareEffectiveDeploymentEnabled("main", expected, actual)).toEqual([
      "git.deploymentEnabled.**: esperado false, encontrado true",
    ]);
  });

  it("acusa chave fora da lista de permissão, mesmo com a chave própria e ** corretas", () => {
    const expected = expectedDeploymentEnabled([]);
    const actual = { "**": false, main: true, dev: false, staging: false, "release/*": true };
    expect(compareEffectiveDeploymentEnabled("main", expected, actual)).toEqual([
      `git.deploymentEnabled.release/*: chave fora da lista de permissão {${ALLOWED_DEPLOYMENT_KEYS.join(", ")}} — valor true`,
    ]);
  });
});

describe("MAJOR 8/9 — readRepositoryVariable distingue 404 de variável ausente, 404 de repositório ausente e 403 (gh injetável)", () => {
  it("404 na variável, repositório existe → variável ausente (undefined)", () => {
    const api = vi
      .fn()
      .mockImplementationOnce(() => {
        throw ghError(404);
      })
      .mockImplementationOnce(() => ({})); // GET repos/{repo} responde 200
    expect(readRepositoryVariable("andreustimm/master-jobs", "DEPLOY_PREVIEW_ENVS", api)).toBeUndefined();
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("404 na variável, e o repositório também não existe → RepositoryNotFound, nunca 'ausente'", () => {
    const api = vi.fn().mockImplementation(() => {
      throw ghError(404);
    });
    expect(() => readRepositoryVariable("andreustimm/repo-que-nao-existe", "DEPLOY_PREVIEW_ENVS", api)).toThrow(
      RepositoryNotFound,
    );
  });

  it("403 na variável propaga o erro — nunca finge que a variável está ausente", () => {
    const api = vi.fn().mockImplementation(() => {
      throw ghError(403);
    });
    expect(() => readRepositoryVariable("andreustimm/master-jobs", "DEPLOY_PREVIEW_ENVS", api)).toThrow();
    expect(api).toHaveBeenCalledTimes(1); // nunca chega a checar o repositório
  });

  it("httpStatusOf lê o código do stderr do gh, e undefined quando não há um", () => {
    expect(httpStatusOf(ghError(404))).toBe(404);
    expect(httpStatusOf(ghError(403))).toBe(403);
    expect(httpStatusOf(new Error("sem stderr"))).toBeUndefined();
    expect(httpStatusOf("não é um Error")).toBeUndefined();
  });

  it("assertRepositoryExists não lança quando a API responde", () => {
    const api = vi.fn().mockReturnValue({});
    expect(() => assertRepositoryExists("andreustimm/master-jobs", api)).not.toThrow();
  });

  it("assertRepositoryExists propaga erro que não é 404 (ex.: 403) sem reclassificar", () => {
    const api = vi.fn().mockImplementation(() => {
      throw ghError(403);
    });
    let thrown: unknown;
    try {
      assertRepositoryExists("andreustimm/master-jobs", api);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    expect(thrown).not.toBeInstanceOf(RepositoryNotFound);
  });
});

describe("readVariableFromEnv — leitura de process.env no job de CI (MAJOR 1)", () => {
  it("presente, mesmo vazia, é usada — nunca cai para gh api", () => {
    const read = readVariableFromEnv({ DEPLOY_PREVIEW_ENVS: "" });
    expect(read("andreustimm/master-jobs", "DEPLOY_PREVIEW_ENVS")).toBe("");
  });

  it("presente com valor não vazio", () => {
    const read = readVariableFromEnv({ DEPLOY_PREVIEW_ENVS: "dev" });
    expect(read("andreustimm/master-jobs", "DEPLOY_PREVIEW_ENVS")).toBe("dev");
  });

  it("ausente do env vira undefined (distinto de string vazia)", () => {
    const read = readVariableFromEnv({});
    expect(read("andreustimm/master-jobs", "DEPLOY_PREVIEW_ENVS")).toBeUndefined();
  });
});

describe("runCli — código de saída do CLI, sem subprocesso nem rede real (MAJOR 9)", () => {
  it("0 quando as três branches casam com a variável", () => {
    const logs: string[] = [];
    const code = runCli([], {
      readVariable: () => undefined,
      readVercelConfigAt: () => vercelConfig.git.deploymentEnabled,
      log: (line) => logs.push(line),
    });
    expect(code).toBe(0);
    expect(logs[0]).toMatch(/^ok\s+DEPLOY_PREVIEW_ENVS/);
  });

  it("1 e lista o problema quando alguma branch diverge", () => {
    const errors: string[] = [];
    const code = runCli([], {
      readVariable: () => undefined,
      readVercelConfigAt: (_repo, ref) => (ref === "dev" ? { "**": false, main: true, dev: true, staging: false } : vercelConfig.git.deploymentEnabled),
      logError: (line) => errors.push(line),
    });
    expect(code).toBe(1);
    expect(errors.some((line) => line.startsWith("DIVERGE"))).toBe(true);
    expect(errors.some((line) => line.includes("dev:"))).toBe(true);
  });

  it("1 quando a variável é inválida — erro propagado, não engolido", () => {
    const errors: string[] = [];
    const code = runCli([], {
      readVariable: () => "producao",
      readVercelConfigAt: () => vercelConfig.git.deploymentEnabled,
      logError: (line) => errors.push(line),
    });
    expect(code).toBe(1);
    expect(errors[0]).toMatch(/DEPLOY_PREVIEW_ENVS/);
  });

  it("--repo passa o repositório para os leitores injetados", () => {
    const seenRepos = new Set<string>();
    const code = runCli(["--repo", "outra/org"], {
      readVariable: (repo) => {
        seenRepos.add(repo);
        return undefined;
      },
      readVercelConfigAt: (repo) => {
        seenRepos.add(repo);
        return vercelConfig.git.deploymentEnabled;
      },
    });
    expect(code).toBe(0);
    expect(seenRepos).toEqual(new Set(["outra/org"]));
  });
});

describe("docs não prometem deploy automático de dev/staging (F1-05)", () => {
  it("deploy.md não afirma que dev e staging geram deployments automáticos", () => {
    const text = readFileSync("docs/engineering/deploy.md", "utf8");
    expect(text).not.toMatch(/main.*dev.*e.*staging.*geram deployments automáticos/i);
  });

  it("promotion.md não afirma que a promoção gera deploy de staging", () => {
    const text = readFileSync("docs/engineering/promotion.md", "utf8");
    expect(text).not.toMatch(/gera deploy de `staging`/);
  });
});
