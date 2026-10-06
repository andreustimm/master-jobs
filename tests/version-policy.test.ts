// Suite: política de versões (issue #468, docs/engineering/versions.md)
// Invariant: toda versão de SO, runtime, Action e imagem está escrita no
//   repositório — nada de etiqueta flutuante que troca por fora do CI — e a
//   major do Node é a mesma em todas as fontes. O Renovate lê essas versões
//   e abre a PR que as sobe; o gate garante que existe o que ele subir.
// Boundary IN: workflows, Dockerfiles, Compose, package.json, .nvmrc e
//   renovate.json, lidos como texto/YAML/JSON.
// Boundary OUT: qual é a versão mais nova (rede) — papel do Renovate.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  checkRepository,
  composeViolations,
  dockerfileViolations,
  imageViolation,
  nodeAlignmentViolations,
  workflowViolations,
} from "../scripts/versions/check.ts";
import { ciWorkflow, gatedJobWithStep } from "./support/ci-workflow.ts";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
  packageManager: string;
};

describe("imagem com versão explícita", () => {
  it("aceita tag fixa, digest e scratch", () => {
    for (const image of [
      "node:24-trixie-slim",
      "node:24-trixie-slim@sha256:" + "a".repeat(64),
      "postgres:18",
      "registry.local:5000/equipe/app:1.2.3",
      "scratch",
    ]) {
      expect(imageViolation(image), image).toBeNull();
    }
  });

  it("reprova imagem sem tag, com `latest` ou com digest malformado", () => {
    for (const image of ["postgres", "node:latest", "registry.local:5000/equipe/app", "node@sha256:curto"]) {
      expect(imageViolation(image), image).not.toBeNull();
    }
  });
});

describe("workflows", () => {
  const workflow = `
jobs:
  literal:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
  expressao:
    runs-on: \${{ github.event_name == 'pull_request' && 'ubuntu-latest' || fromJSON(vars.CI_RUNS_ON || '"ubuntu-26.04"') }}
    steps:
      - run: echo
  lista:
    runs-on: [self-hosted, macos-latest]
    steps:
      - uses: actions/setup-node
      - uses: actions/cache@main
      - uses: docker://alpine
      - uses: ./.github/actions/local
      - uses: superfly/flyctl-actions/setup-flyctl@${"e".repeat(40)}
  servicos:
    runs-on: ubuntu-26.04
    container: node:latest
    services:
      banco:
        image: postgres
    steps:
      - run: echo
  reutilizavel:
    uses: ./.github/workflows/ci.yml
`;

  it("reprova cada referência flutuante, e só elas", () => {
    const messages = workflowViolations("ci.yml", workflow).map((violation) => violation.message);
    expect(messages).toEqual([
      expect.stringContaining("job `literal`: `runs-on` usa etiqueta flutuante (`ubuntu-latest`)"),
      expect.stringContaining("job `expressao`: `runs-on` usa etiqueta flutuante (`ubuntu-latest`)"),
      expect.stringContaining("job `lista`: `runs-on` usa etiqueta flutuante (`macos-latest`)"),
      expect.stringContaining("`uses: actions/setup-node` sem versão"),
      expect.stringContaining("`uses: actions/cache@main` aponta para `main`"),
      expect.stringContaining("imagem `alpine` sem tag nem digest"),
      expect.stringContaining("job `servicos`: imagem `node:latest` com tag flutuante"),
      expect.stringContaining("job `servicos`: imagem `postgres` sem tag nem digest"),
    ]);
  });
});

describe("Dockerfile", () => {
  it("resolve o ARG padrão, ignora estágio reaproveitado e reprova imagem sem versão", () => {
    const dockerfile = [
      "ARG BASE=node:24-trixie-slim",
      "FROM ${BASE} AS deps",
      "FROM deps AS builder",
      "FROM node AS solta",
      "FROM ${SEM_PADRAO}",
      "FROM --platform=linux/amd64 debian:latest",
    ].join("\n");
    expect(dockerfileViolations("Dockerfile", dockerfile).map((violation) => violation.message)).toEqual([
      "imagem `node` sem tag nem digest",
      "`FROM ${SEM_PADRAO}` usa ARG sem valor padrão",
      "imagem `debian:latest` com tag flutuante",
    ]);
  });
});

describe("Compose", () => {
  it("confere o padrão de `${VAR:-imagem}`, que é o que roda sem a variável", () => {
    const compose = `
services:
  db:
    image: \${LOCAL_POSTGRES_IMAGE:-supabase/postgres}
  ok:
    image: \${LOCAL_MINIO_IMAGE:-pgsty/minio:RELEASE.2026-08-04T00-00-00Z}
  cru:
    image: redis:latest
`;
    expect(composeViolations("docker-compose.yml", compose).map((violation) => violation.message)).toEqual([
      "serviço `db`: imagem `supabase/postgres` sem tag nem digest",
      "serviço `cru`: imagem `redis:latest` com tag flutuante",
    ]);
  });
});

describe("major do Node em todas as fontes", () => {
  const alinhado = {
    engines: "^24.21.0",
    nvmrc: "24.21.0\n",
    typesNode: "^24.19.1",
    nodeImages: [{ file: "Dockerfile", image: "node:24-trixie-slim" }],
  };

  it("passa quando engines, .nvmrc, @types/node e as imagens concordam", () => {
    expect(nodeAlignmentViolations(alinhado)).toEqual([]);
  });

  it("aponta cada fonte que ficou para trás ou foi à frente", () => {
    const files = nodeAlignmentViolations({
      ...alinhado,
      nvmrc: "22.0.0",
      typesNode: "^26.6.4",
      nodeImages: [{ file: "scripts/runner/Dockerfile", image: "node:22-bookworm-slim" }],
    }).map((violation) => violation.file);
    expect(files).toEqual([".nvmrc", "package.json", "scripts/runner/Dockerfile"]);
  });
});

describe("o repositório cumpre a política", () => {
  it("sem etiqueta flutuante, imagem sem versão nem major de Node divergente", () => {
    expect(checkRepository(process.cwd())).toEqual([]);
  });

  it("roda no `pnpm check` e num job que o agregador do CI exige", () => {
    expect(pkg.scripts["check:versions"]).toBe(
      "node --experimental-strip-types --no-warnings scripts/versions/check.ts",
    );
    expect(pkg.scripts.check?.split(" && ")).toContain("pnpm check:versions");
    expect(() => gatedJobWithStep(ciWorkflow(), (step) => step.run === "pnpm check:versions")).not.toThrow();
  });
});

describe("renovate.json", () => {
  const renovate = JSON.parse(readFileSync("renovate.json", "utf8")) as Record<string, unknown> & {
    packageRules: { matchPackageNames?: string[]; matchUpdateTypes?: string[]; automerge?: boolean }[];
    customManagers: { managerFilePatterns: string[]; datasourceTemplate: string; matchStrings: string[] }[];
  };

  it("abre PR para dev, sobe para o mais novo e só mescla com o CI verde", () => {
    expect(renovate.baseBranchPatterns).toEqual(["dev"]);
    expect(renovate.rangeStrategy).toBe("bump");
    expect(renovate.automerge).toBe(true);
    // Sem proteção de branch em `dev`, o auto-merge nativo do GitHub não
    // espera check nenhum; é o próprio Renovate que confere os checks.
    expect(renovate.platformAutomerge).toBe(false);
    expect(renovate.ignoreTests).toBe(false);
  });

  it("espera o mesmo dia que o pnpm 11+ exige de quarentena", () => {
    // Com `minimumReleaseAge` do pnpm (1440 min) e sem esta espera, o
    // Renovate tentaria uma versão que o `pnpm install` se recusa a resolver.
    expect(renovate.minimumReleaseAge).toBe("1 day");
  });

  it("commit de manutenção, para não exigir fragmento de changelog nem disparar release", () => {
    expect(renovate.semanticCommitType).toBe("chore");
    expect(renovate.branchPrefix).toMatch(/^chore\//);
  });

  it("major do Node e de @types/node não entram sozinhas: a Vercel precisa aceitar a major antes", () => {
    const rule = renovate.packageRules.find(
      (entry) => entry.matchUpdateTypes?.includes("major") && entry.matchPackageNames?.includes("node"),
    );
    expect(rule?.matchPackageNames).toContain("@types/node");
    expect(rule?.automerge).toBe(false);
  });

  it("acompanha as versões que moram fora dos gerenciadores padrão", () => {
    const covered = renovate.customManagers.flatMap((manager) => manager.managerFilePatterns).join(" ");
    for (const file of ["ci\\.yml", "ci-workflow\\.ts", "postgres-global\\.ts", "rehearse-production\\.ts", "docker-compose\\.local\\.yml", "scripts/runner/Dockerfile"]) {
      expect(covered, file).toContain(file);
    }
    expect(renovate.customManagers.map((manager) => manager.datasourceTemplate)).toContain("github-runners");
  });

  it("a regex do runner alcança toda etiqueta `ubuntu-NN.NN` dos arquivos que o teste do CI compara", () => {
    // Se o Renovate subir só parte das ocorrências, a expressão de `ci.yml`
    // deixa de ser a canônica e o CI da própria PR reprova.
    const manager = renovate.customManagers.find((entry) => entry.datasourceTemplate === "github-runners")!;
    const regex = new RegExp(manager.matchStrings[0]!, "g");
    for (const file of [".github/workflows/ci.yml", "tests/support/ci-workflow.ts", "tests/fixtures/ci-runner-selection/job-com-literal.yml"]) {
      const text = readFileSync(file, "utf8");
      const labels = text.match(/ubuntu-\d+\.\d+/g) ?? [];
      expect(labels.length, file).toBeGreaterThan(0);
      expect([...text.matchAll(regex)].length, file).toBe(labels.length);
    }
  });

  it("o pnpm declarado é exato, para o Renovate e o corepack lerem a mesma versão", () => {
    expect(pkg.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
  });
});
