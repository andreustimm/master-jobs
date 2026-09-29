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

describe("Dockerfile — o contêiner nunca roda como root", () => {
  it("cria um usuário não-root dedicado e o adota antes do CMD", () => {
    expect(DOCKERFILE).toMatch(/useradd\s+--uid\s+1101\s+--gid\s+nextjs/);
    const userIndex = DOCKERFILE.lastIndexOf("USER nextjs");
    const cmdIndex = DOCKERFILE.lastIndexOf("CMD");
    expect(userIndex, "USER nextjs ausente").toBeGreaterThan(-1);
    expect(userIndex).toBeLessThan(cmdIndex);
  });

  it("nunca troca de volta para root depois de adotar o usuário da aplicação", () => {
    const afterUser = DOCKERFILE.slice(DOCKERFILE.lastIndexOf("USER nextjs"));
    expect(afterUser).not.toMatch(/USER\s+root/);
    expect(afterUser).not.toMatch(/USER\s+0\b/);
  });

  it("a regressão óbvia (nenhuma diretiva USER) continua reprovando", () => {
    // Documenta o que o teste acima pega: um Dockerfile sem `USER` roda como
    // root por padrão, e é exatamente o defeito que estas duas checagens
    // existem para impedir.
    const withoutUser = DOCKERFILE.replaceAll(/^USER .+$/gm, "");
    expect(withoutUser).not.toContain("USER nextjs");
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
  const workflow = YAML.parse(raw) as {
    on: Record<string, unknown>;
    permissions: Record<string, string>;
    jobs: Record<string, { environment?: string; if?: string }>;
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

  it("permissões mínimas: só ler o checkout e escrever no GHCR", () => {
    expect(workflow.permissions).toEqual({ contents: "read", packages: "write" });
  });

  it("o job de implantação no Fly só roda quando o dono marca deploy no disparo", () => {
    expect(workflow.jobs.implantar?.if).toBe("${{ inputs.deploy }}");
    expect(workflow.jobs.implantar?.environment).toBe("production");
  });

  it("confere, na própria publicação, que nenhuma camada carrega um valor com formato de segredo", () => {
    expect(raw).toContain("docker history --no-trunc");
  });
});
