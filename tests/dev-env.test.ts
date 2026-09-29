// Suite: `pnpm dev` declara `JHO_ENV=local` só quando ninguém declarou (#378)
// Invariant: a declaração existente — processo ou arquivo `.env*` que o Next
//   carregaria em dev — vence; só a ausência total vira `local`.
// Boundary IN: `declaredJhoEnv`/`devEnvironment` com leitor de arquivo falso.
// Boundary OUT: o `spawn` do `next dev`.
import { describe, expect, it } from "vitest";
import { declaredJhoEnv, devEnvironment, type ReadFile } from "../scripts/dev.ts";

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
