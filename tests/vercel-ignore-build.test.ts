import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// O `ignoreCommand` decide se a Vercel gasta um deploy do limite diário.
// Errar para "pular" publicaria código velho; por isso o padrão é construir.
const script = resolve("scripts/vercel-ignore-build.sh");
let repo: string;

function git(...args: string[]) {
  execFileSync("git", args, { cwd: repo, stdio: "ignore" });
}

function commit(files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@local.test", "commit", "-q", "-m", "c");
}

function decide(env: Record<string, string> = {}) {
  const result = spawnSync("bash", [script], { cwd: repo, encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env } });
  return result.status === 0 ? "pula" : "constrói";
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "vercel-ignore-"));
  git("init", "-q");
  commit({ "app/page.tsx": "a" });
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("vercel-ignore-build.sh", () => {
  it("pula quando só documentação, testes e automação mudam", () => {
    commit({ "docs/a.md": "x", "tests/a.test.ts": "x", ".github/workflows/x.yml": "x", "README.md": "x", ".compozy/t.md": "x" });
    expect(decide()).toBe("pula");
  });

  it("constrói quando o código do site muda", () => {
    commit({ "docs/a.md": "x", "src/core/x.ts": "x" });
    expect(decide()).toBe("constrói");
  });

  it("constrói quando muda o changelog que o app exibe em Novidades", () => {
    commit({ "USER_CHANGELOG.pt-BR.md": "x" });
    expect(decide()).toBe("constrói");
  });

  it("constrói diante de arquivo desconhecido e sem commit anterior", () => {
    commit({ "qualquer.coisa": "x" });
    expect(decide()).toBe("constrói");
    rmSync(repo, { recursive: true, force: true });
    repo = mkdtempSync(join(tmpdir(), "vercel-ignore-"));
    git("init", "-q");
    commit({ "docs/a.md": "x" });
    expect(decide()).toBe("constrói");
  });

  it("usa o SHA anterior da Vercel quando ele existe", () => {
    const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
    commit({ "src/x.ts": "x" });
    commit({ "docs/b.md": "x" });
    expect(decide()).toBe("pula");
    expect(decide({ VERCEL_GIT_PREVIOUS_SHA: base })).toBe("constrói");
  });

  it("está ligado no vercel.json", () => {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { ignoreCommand?: string };
    expect(vercel.ignoreCommand).toBe("bash scripts/vercel-ignore-build.sh");
  });
});
