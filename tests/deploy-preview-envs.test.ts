// Suite: Fase 1 da contingência de CI e deploy (#351) — deploy só em `main`.
// vercel.json é o mecanismo real; DEPLOY_PREVIEW_ENVS é o registro
// documentado, e este contrato prova que os dois nunca divergem.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  InvalidDeployPreviewEnvs,
  compareDeploymentEnabled,
  expectedDeploymentEnabled,
  parseDeployPreviewEnvs,
  verifyDeployPreviewEnvs,
} from "../scripts/github/verify-deploy-preview-envs.ts";

const vercelConfig = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  git: { deploymentEnabled: { "**": boolean; main: boolean; dev: boolean; staging: boolean } };
};

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

  it("** é sempre false — branch de tarefa nunca deploya", () => {
    expect(expectedDeploymentEnabled([]).main).toBe(true);
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
});

describe("verifyDeployPreviewEnvs — detecta divergência com um fake de gh api (F1-04)", () => {
  it("acusa quando a variável religa dev, mas vercel.json continua com dev:false", () => {
    const fakeRead = () => "dev";
    const { problems } = verifyDeployPreviewEnvs(
      "andreustimm/master-jobs",
      vercelConfig.git.deploymentEnabled,
      fakeRead,
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it("sem divergência quando a variável está ausente e vercel.json é o padrão desta entrega", () => {
    const fakeRead = () => undefined;
    const { problems, envs } = verifyDeployPreviewEnvs(
      "andreustimm/master-jobs",
      vercelConfig.git.deploymentEnabled,
      fakeRead,
    );
    expect(envs).toEqual([]);
    expect(problems).toEqual([]);
  });

  it("acusa quando o mapa está totalmente errado (dev e staging religados sem a variável)", () => {
    const fakeRead = () => undefined;
    const { problems } = verifyDeployPreviewEnvs(
      "andreustimm/master-jobs",
      { "**": false, main: true, dev: true, staging: true },
      fakeRead,
    );
    expect(problems).toHaveLength(2);
  });

  it("propaga erro de valor inválido na variável, em vez de mascarar como ok", () => {
    const fakeRead = () => "producao";
    expect(() =>
      verifyDeployPreviewEnvs("andreustimm/master-jobs", vercelConfig.git.deploymentEnabled, fakeRead),
    ).toThrow(InvalidDeployPreviewEnvs);
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
