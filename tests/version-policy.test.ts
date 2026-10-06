// Suite: política de versões (issue #468, docs/engineering/versions.md)
// Invariant: toda versão de SO, runtime, Action e imagem está escrita no
//   repositório — nada de etiqueta flutuante que troca por fora do CI — e a
//   major do Node é a mesma em todas as fontes. O Renovate lê essas versões
//   e abre a PR que as sobe; o gate garante que existe o que ele subir.
// Boundary IN: workflows, Dockerfiles, Compose, package.json, .nvmrc e
//   renovate.json, lidos como texto/YAML/JSON.
// Boundary OUT: qual é a versão mais nova (rede) — papel do Renovate.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  majorFromServerVersionNum,
  parseMajorRunOptions,
  parsePostgresMajors,
  postgresDependentTests,
  postgresMajorRunArgs,
  postgresTestImage,
  readPostgresMajors,
  testedPostgresMajors,
} from "../scripts/versions/postgres-majors.ts";
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

  it("o Python dos scripts tem a versão completa, que o Renovate sobe a cada patch", () => {
    // Só `3.14`, o `setup-python` aceita a que já estiver no cache do runner:
    // na primeira execução no ubuntu-26.04 ele pegou a 3.14.7 com a 3.14.8 já
    // publicada.
    expect(readFileSync(".python-version", "utf8").trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("roda no `pnpm check` e num job que o agregador do CI exige", () => {
    expect(pkg.scripts["check:versions"]).toBe(
      "node --experimental-strip-types --no-warnings scripts/versions/check.ts",
    );
    expect(pkg.scripts.check?.split(" && ")).toContain("pnpm check:versions");
    expect(() => gatedJobWithStep(ciWorkflow(), (step) => step.run === "pnpm check:versions")).not.toThrow();
  });
});

describe("majors do PostgreSQL testadas", () => {
  const majors = { latest: "18", production: "17" };

  it("o arquivo declara a da produção (Supabase 17) e a mais nova, nunca abaixo dela", () => {
    const declarado = readPostgresMajors();
    expect(declarado.production).toBe("17");
    expect(Number(declarado.latest)).toBeGreaterThanOrEqual(Number(declarado.production));
    expect(testedPostgresMajors(declarado)).toContain(declarado.production);
  });

  it("sem variável, a mais nova; com ela, a major pedida entre as declaradas", () => {
    expect(postgresTestImage({}, majors)).toBe("postgres:18");
    expect(postgresTestImage({ JHO_TEST_POSTGRES_MAJOR: "  " }, majors)).toBe("postgres:18");
    expect(postgresTestImage({ JHO_TEST_POSTGRES_MAJOR: "17" }, majors)).toBe("postgres:17");
  });

  it("major fora da lista, ou que não é major, recusa em vez de subir qualquer imagem", () => {
    for (const pedido of ["16", "19", "latest", "17.6", "postgres:17"]) {
      expect(() => postgresTestImage({ JHO_TEST_POSTGRES_MAJOR: pedido }, majors), pedido).toThrow("fora de config/postgres-majors.json");
    }
    expect(() => parsePostgresMajors('{"latest":"18"}')).toThrow("production");
    expect(() => parsePostgresMajors('{"latest":"latest","production":"17"}')).toThrow("latest");
  });

  it("produção primeiro e sem repetir quando as duas coincidem", () => {
    expect(testedPostgresMajors(majors)).toEqual(["17", "18"]);
    expect(testedPostgresMajors({ latest: "18", production: "18" })).toEqual(["18"]);
  });

  it("lê a major do `server_version_num`", () => {
    expect(majorFromServerVersionNum("170006")).toBe("17");
    expect(majorFromServerVersionNum(180001)).toBe("18");
  });

  it("todo teste que usa PostgreSQL real entra na suíte das majors", () => {
    // Leitura independente da seleção: quem importa o helper de banco ou lê a
    // URL do servidor de teste precisa estar na lista que roda em cada major.
    // A lista manual anterior deixava de fora candidatura, sessão e sugestão.
    // O nome da variável vai montado: escrito inteiro, este arquivo entraria.
    const urlVar = ["JHO", "TEST", "POSTGRES", "URL"].join("_");
    const selecionados = new Set(postgresDependentTests());
    const usamBanco = readdirSync("tests")
      .filter((name) => name.endsWith(".test.ts"))
      .map((name) => `tests/${name}`)
      .filter((file) => {
        const text = readFileSync(file, "utf8");
        return /["']\.\/support\/(?:db|postgres-global)(?:\.ts)?["']/.test(text) || text.includes(urlVar);
      });
    expect(usamBanco.length).toBeGreaterThan(0);
    expect(usamBanco.filter((file) => !selecionados.has(file))).toEqual([]);
    for (const file of ["tests/mail-suggestion.test.ts", "tests/repo.application.test.ts", "tests/auth-session.test.ts", "tests/production-selection.test.ts"]) {
      expect(selecionados.has(file), file).toBe(true);
    }
    // Teste puro fica fora. (O leitor é léxico: um import escrito dentro de
    // string, como nos arquivos sintéticos abaixo, conta — errar para dentro
    // custa só tempo.)
    expect(selecionados.has("tests/country.test.ts")).toBe(false);
    expect(postgresMajorRunArgs([...selecionados]).slice(3)).toEqual([...selecionados]);
    expect(() => postgresMajorRunArgs([])).toThrow("nenhum teste de PostgreSQL");
  });

  it("a seleção segue helper intermediário e ignora import só de tipo", () => {
    const root = mkdtempSync(join(tmpdir(), "jho-pg-suite-"));
    try {
      mkdirSync(join(root, "tests/support"), { recursive: true });
      writeFileSync(join(root, "tests/support/db.ts"), "export const useTestDb = 1;\n");
      writeFileSync(join(root, "tests/support/fixture.ts"), 'import { useTestDb } from "./db.ts";\nexport const x = useTestDb;\n');
      writeFileSync(join(root, "tests/direto.test.ts"), 'import { useTestDb } from "./support/db.ts";\n');
      writeFileSync(join(root, "tests/indireto.test.ts"), 'import { x } from "./support/fixture.ts";\n');
      writeFileSync(join(root, "tests/url.test.ts"), `const url = process.env.${["JHO", "TEST", "POSTGRES", "URL"].join("_")};\n`);
      writeFileSync(join(root, "tests/tipo.test.ts"), 'import type { TestDb } from "./support/db.ts";\n');
      writeFileSync(join(root, "tests/puro.test.ts"), 'import { x } from "../src/x.ts";\n');
      expect(postgresDependentTests(root)).toEqual(["tests/direto.test.ts", "tests/indireto.test.ts", "tests/url.test.ts"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("o CI escolhe major pela chave e fatia; o resto recusa", () => {
    expect(parseMajorRunOptions([], majors)).toEqual({ majors: ["17", "18"], shard: null });
    expect(parseMajorRunOptions(["--major=production", "--shard=1/2"], majors)).toEqual({ majors: ["17"], shard: "1/2" });
    expect(parseMajorRunOptions(["--major=latest"], majors)).toEqual({ majors: ["18"], shard: null });
    expect(postgresMajorRunArgs(["tests/a.test.ts"], "2/2")).toEqual(["exec", "vitest", "run", "--shard=2/2", "tests/a.test.ts"]);
    for (const errado of [["--major=17"], ["--major="], ["--shard=3/2"], ["--shard=0/2"], ["--shard=1"], ["17"]]) {
      expect(() => parseMajorRunOptions(errado, majors), errado.join(" ")).toThrow();
    }
  });

  it("o check obrigatório `schema-e-migracao` só passa com a suíte de banco aprovada em cada major e fatia", () => {
    expect(pkg.scripts["test:postgres-majors"]).toBe("node --no-warnings scripts/versions/postgres-majors.ts");
    const ci = ciWorkflow();
    const matrix = ci.jobs["banco-nas-majors"]!;
    expect(matrix.strategy?.matrix?.major).toEqual(["production", "latest"]);
    const fatias = matrix.strategy?.matrix?.fatia as number[];
    expect(fatias.length).toBeGreaterThan(0);
    expect(fatias).toEqual(fatias.map((_, index) => index + 1));
    expect(matrix.steps.filter((step) => step.run?.startsWith("pnpm test:postgres-majors")).map((step) => step.run)).toEqual([
      `pnpm test:postgres-majors --major=\${{ matrix.major }} --shard=\${{ matrix.fatia }}/${fatias.length}`,
    ]);

    // Pulado conta como aprovado na proteção de branch: o check obrigatório
    // roda sempre e reprova sozinho quando alguma fatia não passou.
    const gate = ci.jobs["schema-e-migracao"]!;
    expect(gate.if).toBe("${{ always() }}");
    expect(gate.needs).toEqual(["banco-nas-majors"]);
    const step = gate.steps.find((candidate) => candidate.env?.RESULTADOS === "${{ toJSON(needs) }}")!;
    const run = (needs: Record<string, { result: string }>) =>
      spawnSync("bash", ["-e", "-c", step.run!], { encoding: "utf8", env: { ...process.env, RESULTADOS: JSON.stringify(needs) } }).status;
    expect(run({ "banco-nas-majors": { result: "success" } })).toBe(0);
    for (const result of ["failure", "skipped", "cancelled"]) {
      expect(run({ "banco-nas-majors": { result } }), result).not.toBe(0);
    }
    expect(run({})).not.toBe(0);
  });

  it("workflow e docs citam as chaves; os números moram só em config/postgres-majors.json", () => {
    const declarado = readPostgresMajors();
    const numero = new RegExp(String.raw`postgres(?:ql)?(?::|\s+)(?:${declarado.production}|${declarado.latest})\b`, "i");
    for (const file of [".github/workflows/ci.yml", "docs/engineering/versions.md", "docs/qa/README.md"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(numero);
    }
  });
});

describe("renovate.json", () => {
  const renovate = JSON.parse(readFileSync("renovate.json", "utf8")) as Record<string, unknown> & {
    packageRules: { matchPackageNames?: string[]; matchDepTypes?: string[]; matchUpdateTypes?: string[]; automerge?: boolean; labels?: string[] }[];
    customManagers: { managerFilePatterns: string[]; datasourceTemplate: string; matchStrings: string[] }[];
  };

  it("abre PR para dev e sobe para o mais novo", () => {
    expect(renovate.baseBranchPatterns).toEqual(["dev"]);
    expect(renovate.rangeStrategy).toBe("bump");
  });

  it("nada mescla sozinho: a PR do Renovate segue o fluxo normal (regras 19 e 24)", () => {
    // Liberar automerge exige exceção às regras 19 e 24 decidida pelo dono
    // (docs/engineering/versions.md). Varre o arquivo inteiro: uma regra nova
    // com `automerge: true` reprova aqui, onde quer que esteja.
    expect(renovate.automerge).toBe(false);
    const ligados: string[] = [];
    const varrer = (valor: unknown, caminho: string) => {
      if (Array.isArray(valor)) valor.forEach((item, i) => varrer(item, `${caminho}[${i}]`));
      else if (valor && typeof valor === "object") {
        for (const [chave, filho] of Object.entries(valor)) {
          if (chave === "platformAutomerge" || (chave === "automerge" && filho !== false)) ligados.push(`${caminho}.${chave}`);
          varrer(filho, `${caminho}.${chave}`);
        }
      }
    };
    varrer(renovate, "renovate");
    expect(ligados).toEqual([]);
    // Explícito em cada regra, e não só herdado do topo: regra de preset em
    // `extends` que ligue automerge para os mesmos pacotes vem antes e perde
    // para a nossa.
    expect(renovate.packageRules.filter((rule) => rule.automerge !== false)).toEqual([]);
  });

  it("espera o mesmo dia que o pnpm exige de quarentena, e o pnpm declara a dele", () => {
    // Com `minimumReleaseAge` do pnpm (1440 min) e sem esta espera, o
    // Renovate tentaria uma versão que o `pnpm install` se recusa a resolver.
    expect(renovate.minimumReleaseAge).toBe("1 day");
    // Declarada, e não herdada do padrão do pnpm: um padrão que muda numa
    // major desligaria a quarentena sem diff nenhum aqui.
    const workspace = YAML.parse(readFileSync("pnpm-workspace.yaml", "utf8")) as { minimumReleaseAge?: unknown };
    expect(workspace.minimumReleaseAge).toBe(1440);
  });

  it("major do pnpm não entra sem a Vercel confirmar a major nova no build", () => {
    const rule = renovate.packageRules.find(
      (entry) => entry.matchDepTypes?.includes("packageManager") && entry.matchUpdateTypes?.includes("major"),
    );
    expect(rule?.automerge).toBe(false);
    expect(rule?.labels).toContain("confirmar-vercel");
  });

  it("subir a major mais nova do Postgres não tira a da produção do CI", () => {
    // O Renovate só alcança `latest`; `production` fica onde está, e os dois
    // continuam na lista que o job `schema-e-migracao` percorre.
    const manager = renovate.customManagers.find((entry) => entry.managerFilePatterns.some((p) => p.includes("postgres-majors")))!;
    const text = readFileSync("config/postgres-majors.json", "utf8");
    const majors = readPostgresMajors();
    const matches = [...text.matchAll(new RegExp(manager.matchStrings[0]!, "g"))];
    expect(matches.map((match) => match.groups?.currentValue)).toEqual([majors.latest]);
    const subido = text.replace(new RegExp(manager.matchStrings[0]!), `"latest": "${Number(majors.latest) + 1}"`);
    expect(testedPostgresMajors(parsePostgresMajors(subido))).toEqual([majors.production, String(Number(majors.latest) + 1)]);
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
    for (const file of ["ci\\.yml", "ci-workflow\\.ts", "config/postgres-majors\\.json", "docker-compose\\.local\\.yml", "scripts/runner/Dockerfile"]) {
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
