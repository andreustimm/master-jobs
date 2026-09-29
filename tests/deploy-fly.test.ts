// Suite: plano B de deploy no Fly.io (Fase 4 da #351, issue #369, ADR 0030)
// Invariant: a imagem do contêiner nunca roda como root, a exceção de bind
//   amplo (G36) mora só dentro da imagem — nunca num script local — e o
//   workflow que publica/implanta é estritamente manual.
// Boundary IN: Dockerfile, fly.toml, package.json e o workflow, lidos como
//   texto/YAML — o mesmo contrato que o Fly e o GHCR realmente aplicam.
// Boundary OUT: a execução real do build (docker build/run), verificada à
//   parte, e o deploy no Fly, que só o dono aciona.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

const DOCKERFILE = readFileSync("Dockerfile", "utf8");
const DOCKERIGNORE = readFileSync(".dockerignore", "utf8");
const FLY_TOML = readFileSync("fly.toml", "utf8");
const PACKAGE_JSON = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};

/**
 * A última diretiva `USER` antes do último `CMD`, DENTRO DO ÚLTIMO ESTÁGIO
 * (`FROM`), decide quem roda o processo — é como o Docker resolve um build
 * multi-stage: só o último estágio é exportado por padrão, e um `USER`
 * definido num estágio anterior (o `builder`, por exemplo) não decide nada
 * sobre a imagem final. É o que este contrato precisa espelhar para não
 * aprovar um Dockerfile que troca de volta para root depois de um `USER
 * nextjs` de fachada, ou que só declara o usuário no estágio errado.
 *
 * `USER usuario:grupo` (ou `uid:gid`) é sintaxe válida do Docker — a parte
 * antes de `:` é quem decide o processo; `USER root:root` e `USER 0:0` são
 * root, do mesmo jeito que `USER root`/`USER 0` sem grupo.
 */
function runsAsNonRootBeforeCmd(dockerfile: string): boolean {
  const estagios = [...dockerfile.matchAll(/^FROM\s+/gm)];
  const ultimoEstagio = dockerfile.slice(estagios.at(-1)?.index ?? 0);

  const cmdIndex = ultimoEstagio.lastIndexOf("CMD");
  if (cmdIndex < 0) return false;
  const before = ultimoEstagio.slice(0, cmdIndex);
  const users = [...before.matchAll(/^USER\s+(\S+)\s*$/gm)];
  const last = users.at(-1)?.[1];
  if (last === undefined) return false;

  const nome = last.split(":")[0];
  return nome !== "root" && nome !== "0";
}

describe("Dockerfile — o contêiner nunca roda como root", () => {
  it("cria um usuário não-root dedicado e o adota antes do CMD", () => {
    expect(DOCKERFILE).toMatch(/useradd\s+--uid\s+1101\s+--gid\s+nextjs/);
    expect(runsAsNonRootBeforeCmd(DOCKERFILE)).toBe(true);
  });

  it("nunca troca de volta para root depois de adotar o usuário da aplicação", () => {
    const afterUser = DOCKERFILE.slice(DOCKERFILE.lastIndexOf("USER nextjs"));
    expect(afterUser).not.toMatch(/USER\s+root/);
    expect(afterUser).not.toMatch(/USER\s+0\b/);
  });

  describe("runsAsNonRootBeforeCmd — a função da checagem, contra fixtures que ela precisa pegar", () => {
    it("Dockerfile sem nenhuma diretiva USER roda como root", () => {
      const fixture = "FROM node:24-slim\nWORKDIR /app\nCOPY . .\nCMD [\"node\", \"server.js\"]\n";
      expect(runsAsNonRootBeforeCmd(fixture)).toBe(false);
    });

    it("USER root explícito também conta como root", () => {
      const fixture = "FROM node:24-slim\nUSER root\nCMD [\"node\", \"server.js\"]\n";
      expect(runsAsNonRootBeforeCmd(fixture)).toBe(false);
    });

    it("USER 0 (o uid de root) conta como root, mesmo sem o nome", () => {
      const fixture = "FROM node:24-slim\nUSER 0\nCMD [\"node\", \"server.js\"]\n";
      expect(runsAsNonRootBeforeCmd(fixture)).toBe(false);
    });

    it("USER root:root (sintaxe usuário:grupo) também conta como root", () => {
      const fixture = "FROM node:24-slim\nUSER root:root\nCMD [\"node\", \"server.js\"]\n";
      expect(runsAsNonRootBeforeCmd(fixture)).toBe(false);
    });

    it("USER 0:0 (uid:gid de root) também conta como root", () => {
      const fixture = "FROM node:24-slim\nUSER 0:0\nCMD [\"node\", \"server.js\"]\n";
      expect(runsAsNonRootBeforeCmd(fixture)).toBe(false);
    });

    it("USER não-root:grupo (sintaxe usuário:grupo) passa, comparando só a parte antes de ':'", () => {
      const fixture = "FROM node:24-slim\nUSER nextjs:nextjs\nCMD [\"node\", \"server.js\"]\n";
      expect(runsAsNonRootBeforeCmd(fixture)).toBe(true);
    });

    it("USER não-root depois do CMD não conta — o Docker já decidiu antes dele", () => {
      const fixture = "FROM node:24-slim\nCMD [\"node\", \"server.js\"]\nUSER nextjs\n";
      expect(runsAsNonRootBeforeCmd(fixture)).toBe(false);
    });

    it("USER não-root antes do CMD passa", () => {
      const fixture = "FROM node:24-slim\nUSER nextjs\nCMD [\"node\", \"server.js\"]\n";
      expect(runsAsNonRootBeforeCmd(fixture)).toBe(true);
    });

    it("USER só num estágio anterior (multi-stage) não conta — só o último FROM é exportado", () => {
      // O `builder` adota `nextjs` só para ilustrar um caso real (uma
      // instalação que não deveria rodar como root durante o build), mas o
      // estágio final (`runner`) nunca declara USER — o contêiner exportado
      // roda como root, mesmo com um `USER` "correto" mais acima no arquivo.
      const fixture = [
        "FROM node:24-slim AS builder",
        "USER nextjs",
        "RUN pnpm build",
        "FROM node:24-slim AS runner",
        "COPY --from=builder /app/.next/standalone ./",
        'CMD ["node", "server.js"]',
        "",
      ].join("\n");
      expect(runsAsNonRootBeforeCmd(fixture)).toBe(false);
    });

    it("USER no último estágio conta, mesmo que um estágio anterior nunca tenha declarado nenhum", () => {
      const fixture = [
        "FROM node:24-slim AS builder",
        "RUN pnpm build",
        "FROM node:24-slim AS runner",
        "USER nextjs",
        'CMD ["node", "server.js"]',
        "",
      ].join("\n");
      expect(runsAsNonRootBeforeCmd(fixture)).toBe(true);
    });
  });
});

describe("Dockerfile e .dockerignore — nenhum segredo de produção na imagem", () => {
  it("não copia nem declara variável de ambiente com valor de segredo", () => {
    expect(DOCKERFILE).not.toMatch(/COPY\s+\.env/);
    expect(DOCKERFILE).not.toMatch(/ENV\s+(DATABASE_URL|RESEND_API_KEY|SENTRY_AUTH_TOKEN|CRON_SECRET|BLOB_READ_WRITE_TOKEN)\s*=/);
  });

  it("exclui .env* do contexto de build", () => {
    expect(DOCKERIGNORE).toMatch(/^\.env$/m);
    expect(DOCKERIGNORE).toMatch(/^\.env\.\*$/m);
  });

  it("espelha os padrões sensíveis do .gitignore (o que o Git nunca versiona)", () => {
    const gitignore = readFileSync(".gitignore", "utf8");
    for (const pattern of ["*.token.json", ".linkedin-session.json", "*.db"]) {
      expect(gitignore, ".gitignore").toContain(pattern);
      expect(DOCKERIGNORE, ".dockerignore").toContain(pattern);
    }
  });
});

describe("Dockerfile — reprodutibilidade e diretiva de sintaxe (minors da revisão)", () => {
  it("a diretiva # syntax é a primeira linha", () => {
    expect(DOCKERFILE.split("\n")[0]).toBe("# syntax=docker/dockerfile:1");
  });

  it("a imagem base é pinada por digest, não por tag flutuante", () => {
    expect(DOCKERFILE).toMatch(/node:24-slim@sha256:[0-9a-f]{64}/);
  });

  it("recebe o SHA do commit como build-arg para o marcador de versão do service worker", () => {
    // Sem isto, `scripts/sw-version.mjs` cairia sempre em "sem-revisao" dentro
    // da imagem (sem .git no contexto — .dockerignore o exclui), e o PWA
    // nunca detectaria uma atualização entre deploys do plano B.
    expect(DOCKERFILE).toMatch(/ARG\s+GIT_REVISION=/);
    expect(DOCKERFILE).toMatch(/ENV\s+VERCEL_GIT_COMMIT_SHA=\$\{?GIT_REVISION\}?/);
  });
});

describe("Dockerfile e fly.toml — JHO_ENV=production (CRITICAL C1 da revisão)", () => {
  it("o Dockerfile declara o deployment explicitamente", () => {
    // Sem JHO_ENV a varredura recusaria por não se reconhecer como produção.
    // Até a #378, a ausência também fazia isLocalProcess() devolver true no
    // contêiner; hoje ela nega por omissão (tests/auth-session.test.ts), e
    // esta linha segue como declaração explícita do ambiente.
    expect(DOCKERFILE).toMatch(/ENV\s+JHO_ENV=production/);
  });

  it("fly.toml declara o mesmo, por defesa em profundidade", () => {
    expect(FLY_TOML).toMatch(/JHO_ENV\s*=\s*"production"/);
  });
});

describe("fly.toml — JHO_PUBLIC_URL fixada (MAJOR M1 da revisão)", () => {
  it("o Fly não tem equivalente às variáveis de sistema da Vercel, então JHO_PUBLIC_URL vem fixada", () => {
    // Sem isto, resolvePublicOrigin() (src/contexts/auth/domain/public-origin.ts)
    // falharia fechado no plano B: o Fly nunca declara VERCEL_PROJECT_PRODUCTION_URL
    // nem VERCEL_URL, e o Host da requisição não é confiável fora da máquina do dono.
    expect(FLY_TOML).toMatch(/JHO_PUBLIC_URL\s*=\s*"https:\/\/jobs\.mastertimm\.com\.br"/);
  });
});

describe("#378: a máquina do dono se declara local, e só o `dev` faz isso sozinho", () => {
  it("`pnpm dev` passa por scripts/dev.ts, que só declara local na ausência de declaração", () => {
    // `isLocalProcess()` exige o sinal positivo. `next dev` só roda na máquina
    // de quem desenvolve, então é o único script que pode declará-lo sozinho —
    // e sem passar por cima do `.env` (tests/dev-env.test.ts).
    expect(PACKAGE_JSON.scripts.dev).toMatch(/\bscripts\/dev\.ts\s+next dev\b/);
  });

  it("nenhum script embute JHO_ENV — `start`, build e CLI dependem do ambiente real", () => {
    // `pnpm start` e `pnpm jho` também rodam fora do laptop (varredura no
    // Actions com JHO_ENV=production): um `JHO_ENV=local` embutido ali
    // transformaria deployment em máquina do dono. Um `JHO_ENV=` no próprio
    // `dev` passaria por cima do `.env`.
    for (const [name, command] of Object.entries(PACKAGE_JSON.scripts)) {
      expect(command, `scripts.${name}`).not.toMatch(/JHO_ENV=/);
    }
  });
});

describe("regra 12 (G36) continua intacta para dev/start locais", () => {
  it("dev e start seguem presos a 127.0.0.1 — a mesma trava de tests/security.test.ts", () => {
    expect(PACKAGE_JSON.scripts.dev).toMatch(/--hostname\s+(127\.0\.0\.1|localhost)/);
    expect(PACKAGE_JSON.scripts.start).toMatch(/--hostname\s+(127\.0\.0\.1|localhost)/);
  });

  it("não existe script local que abra o bind amplo do contêiner", () => {
    // A exceção de contêiner (HOSTNAME=0.0.0.0) mora só no Dockerfile. Um
    // `pnpm start:container` (ou qualquer script com esse HOSTNAME) recriaria,
    // no laptop do dono, exatamente o bind que a regra 12 existe para proibir.
    for (const [name, command] of Object.entries(PACKAGE_JSON.scripts)) {
      expect(command, `scripts.${name}`).not.toMatch(/HOSTNAME=0\.0\.0\.0/);
      expect(name).not.toBe("start:container");
    }
  });

  it("a exceção de contêiner existe, e só dentro da imagem", () => {
    expect(DOCKERFILE).toMatch(/ENV\s+HOSTNAME=0\.0\.0\.0/);
    // A mesma linha nunca aparece em package.json — reprovaria a regressão
    // simétrica: alguém "corrigindo" o Dockerfile ao copiar o padrão errado.
    expect(JSON.stringify(PACKAGE_JSON.scripts)).not.toContain("0.0.0.0");
  });
});

describe("fly.toml — região gru e health check", () => {
  it("fixa a região em gru, a mais próxima do Supabase de produção", () => {
    expect(FLY_TOML).toMatch(/^primary_region\s*=\s*"gru"$/m);
  });

  it("declara um health check contra uma rota pública, sem depender do banco", () => {
    expect(FLY_TOML).toMatch(/path\s*=\s*"\/manifest\.json"/);
    expect(FLY_TOML).toMatch(/internal_port\s*=\s*3000/);
  });
});

describe("workflow do plano B — estritamente manual", () => {
  const raw = readFileSync(".github/workflows/publicar-imagem-fly.yml", "utf8");
  type Step = { name?: string; run?: string; uses?: string; with?: Record<string, unknown> };
  type Job = {
    if?: string;
    environment?: string;
    permissions?: Record<string, string>;
    steps: Step[];
  };
  const workflow = YAML.parse(raw) as {
    on: Record<string, unknown>;
    permissions: Record<string, string>;
    jobs: Record<string, Job>;
  };

  it("só workflow_dispatch aciona — nenhum push, PR ou agendamento", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  });

  it("uma fixture com push ou schedule reprovaria — a regressão que o teste pega", () => {
    const comPush = YAML.parse(raw.replace("on:\n  workflow_dispatch:", "on:\n  push:\n    branches: [main]\n  workflow_dispatch:")) as {
      on: Record<string, unknown>;
    };
    expect(Object.keys(comPush.on)).not.toEqual(["workflow_dispatch"]);
  });

  it("permissões mínimas no topo — packages:write só existe no job publicar, nunca em implantar", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.publicar?.permissions).toEqual({ contents: "read", packages: "write" });
    expect(workflow.jobs.implantar?.permissions).toEqual({ contents: "read" });
  });

  it("mesmo manual, só publica a partir de main — disparo de outra branch não publica nada", () => {
    expect(workflow.jobs.publicar?.if).toBe("github.ref == 'refs/heads/main'");
  });

  it("o job de implantação no Fly só roda quando o dono marca deploy no disparo", () => {
    expect(workflow.jobs.implantar?.if).toBe("${{ inputs.deploy }}");
    expect(workflow.jobs.implantar?.environment).toBe("production");
  });

  it("setup-flyctl é pinado por SHA de commit, nunca @master (branch flutuante)", () => {
    const passo = workflow.jobs.implantar?.steps.find((step) => step.uses?.startsWith("superfly/flyctl-actions/setup-flyctl@"));
    expect(passo?.uses, "passo setup-flyctl ausente").toBeDefined();
    expect(passo?.uses).toMatch(/setup-flyctl@[0-9a-f]{40}/);
    expect(passo?.uses).not.toContain("@master");
  });

  it("a tag de entrada passa por variável de ambiente e por uma allowlist de caracteres, nunca interpolada direto no shell", () => {
    const passo = workflow.jobs.publicar?.steps.find((step) => step.name === "Resolver e validar a tag");
    expect(passo?.run, "passo de resolução da tag ausente").toBeDefined();
    // A entrada do disparo vira variável de ambiente do passo — nunca
    // `${{ inputs.tag }}` interpolado direto dentro do `run:` — e o script
    // recusa qualquer caractere fora de [a-zA-Z0-9._-] antes de usar o valor.
    expect(passo?.run).not.toContain("${{ inputs.tag }}");
    expect((passo as unknown as { env?: Record<string, string> }).env).toEqual({
      TAG_ENTRADA: "${{ inputs.tag }}",
    });
    expect(passo?.run).toMatch(/\[a-zA-Z0-9._-\]/);
  });

  it("MAJOR M2: a imagem é inspecionada (docker run) ANTES de qualquer login ou push no GHCR", () => {
    const nomes = workflow.jobs.publicar?.steps.map((step) => step.name ?? "") ?? [];
    const build = nomes.findIndex((nome) => nome.includes("Build local"));
    const inspecao = nomes.findIndex((nome) => nome.toLowerCase().includes("inspecionar"));
    const login = nomes.findIndex((nome) => nome.includes("Login no GHCR"));
    const push = nomes.findIndex((nome) => nome.includes("Publicar a imagem"));
    for (const indice of [build, inspecao, login, push]) expect(indice).toBeGreaterThanOrEqual(0);
    expect(build).toBeLessThan(inspecao);
    expect(inspecao).toBeLessThan(login);
    expect(login).toBeLessThan(push);
  });

  it("o build local carrega no daemon (load) sem publicar (push) — a inspeção roda sobre ele", () => {
    const build = workflow.jobs.publicar?.steps.find((step) => step.name?.includes("Build local"));
    expect(build?.with?.push).toBe(false);
    expect(build?.with?.load).toBe(true);
  });

  it("o build passa o SHA do commit como build-arg, para o marcador de versão do PWA", () => {
    const build = workflow.jobs.publicar?.steps.find((step) => step.name?.includes("Build local"));
    expect(String(build?.with?.["build-args"])).toContain("GIT_REVISION=${{ github.sha }}");
  });

  it("a inspeção procura arquivo sensível e padrão de segredo no sistema de arquivos, não só nos metadados", () => {
    const inspecao = workflow.jobs.publicar?.steps.find((step) => step.name?.toLowerCase().includes("inspecionar"));
    expect(inspecao?.run).toContain("docker run");
    expect(inspecao?.run).toContain("find");
    expect(inspecao?.run).toContain(".env");
  });

  it("confere, na própria publicação, que nenhuma camada carrega um valor com formato de segredo", () => {
    expect(raw).toContain("docker history --no-trunc");
  });
});
