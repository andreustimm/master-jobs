// Suite: `pnpm dev` declara `JHO_ENV=local` só quando ninguém declarou (#378)
// Invariant: a declaração existente — processo ou arquivo `.env*` que o Next
//   carregaria em dev — vence; só a ausência total vira `local`.
// Boundary IN: `declaredJhoEnv`/`devEnvironment` com leitor de arquivo falso;
//   `scripts/dev.ts` como processo real, com um filho que só dorme.
// Boundary OUT: o `next dev` de verdade.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { declaredJhoEnv, devEnvironment, type ReadFile } from "../src/core/dev-env.ts";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitDead(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!alive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !alive(pid);
}

const files = (map: Record<string, string>): ReadFile => (path) => map[path];

describe("scripts/dev.ts", () => {
  it("sem declaração nenhuma, declara local", () => {
    expect(declaredJhoEnv({}, files({}))).toBeUndefined();
    expect(devEnvironment({ OUTRA: "x" }, files({ ".env": "DATABASE_URL=postgres://x\n" }))).toEqual({
      OUTRA: "x",
      JHO_ENV: "local",
    });
  });

  it("REPRODUZ o Minor da revisão: JHO_ENV do .env não é sobrescrita", () => {
    // Com `JHO_ENV=${JHO_ENV:-local}` no script, o shell não lia o `.env` e
    // punha `local` no processo — que o Next nunca sobrescreve.
    const env = devEnvironment({}, files({ ".env": "JHO_ENV=preview\n" }));
    expect(env.JHO_ENV).toBeUndefined();
    expect(declaredJhoEnv({}, files({ ".env": "JHO_ENV=preview\n" }))).toBe("preview");
  });

  it("o processo vence os arquivos, e os arquivos seguem a ordem do Next em dev", () => {
    const all = files({
      ".env.development.local": "JHO_ENV=a\n",
      ".env.local": "JHO_ENV=b\n",
      ".env.development": "JHO_ENV=c\n",
      ".env": "JHO_ENV=d\n",
    });
    expect(declaredJhoEnv({ JHO_ENV: "shell" }, all)).toBe("shell");
    expect(declaredJhoEnv({}, all)).toBe("a");
    expect(declaredJhoEnv({}, files({ ".env.local": "JHO_ENV=b\n", ".env": "JHO_ENV=d\n" }))).toBe("b");
    expect(declaredJhoEnv({}, files({ ".env.development": "JHO_ENV=c\n", ".env": "JHO_ENV=d\n" }))).toBe("c");
  });

  it("declarada vazia continua declarada — não vira local", () => {
    expect(devEnvironment({ JHO_ENV: "" }, files({})).JHO_ENV).toBe("");
    expect(devEnvironment({}, files({ ".env": "JHO_ENV=\n" })).JHO_ENV).toBeUndefined();
  });

  it("linha comentada não é declaração", () => {
    expect(devEnvironment({}, files({ ".env": "# JHO_ENV=production\n" })).JHO_ENV).toBe("local");
  });
});

describe("scripts/dev.ts como processo", () => {
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    it(`${signal} no wrapper derruba o filho — o next dev não fica órfão na porta`, async () => {
      // O filho imprime o próprio pid e dorme. Sem o repasse, o wrapper morre
      // e este processo continua vivo.
      const wrapper = spawn(
        process.execPath,
        [
          "--experimental-strip-types",
          "--no-warnings",
          "scripts/dev.ts",
          process.execPath,
          "-e",
          "console.log(process.pid); setInterval(() => {}, 1000)",
        ],
        { stdio: ["ignore", "pipe", "inherit"] },
      );
      const [chunk] = (await once(wrapper.stdout!, "data")) as [Buffer];
      const childPid = Number(chunk.toString().trim());
      expect(alive(childPid)).toBe(true);

      const exited = once(wrapper, "exit");
      wrapper.kill(signal);
      const [code, wrapperSignal] = (await exited) as [number | null, NodeJS.Signals | null];

      expect(await waitDead(childPid, 5_000), `filho ${childPid} sobreviveu ao ${signal}`).toBe(true);
      // O wrapper sai como o filho saiu: pelo mesmo sinal.
      expect({ code, wrapperSignal }).toEqual({ code: null, wrapperSignal: signal });
    }, 15_000);
  }

  it("comando que não existe falha com mensagem, sem pendurar", async () => {
    const wrapper = spawn(
      process.execPath,
      ["--experimental-strip-types", "--no-warnings", "scripts/dev.ts", "comando-que-nao-existe-378"],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    wrapper.stderr!.on("data", (data: Buffer) => {
      stderr += data.toString();
    });
    const [code] = (await once(wrapper, "exit")) as [number | null];
    expect(code).toBe(1);
    expect(stderr).toContain("não foi possível iniciar comando-que-nao-existe-378");
  }, 15_000);
});
