import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { copiedToHarness, isolationRefusal } from "./e2e/database-guard.mjs";

/**
 * O setup do e2e só escreve em banco local. Foi rodado contra um banco real e
 * semeou uma conta com e-mail de verdade no candidato do dono — que chegou a
 * produção e vazou o perfil dele.
 */
const LOCAL = "postgresql://jho:jho@127.0.0.1:5432/jho_test_abc";
const SUPABASE =
  "postgresql://postgres.bujawvnxwtmneiggizje:x@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require";

describe("isolationRefusal", () => {
  it("aceita banco no loopback com conta @local.test", () => {
    expect(isolationRefusal({ DATABASE_URL: LOCAL, DATABASE_MIGRATION_URL: LOCAL })).toBeNull();
    expect(isolationRefusal({ DATABASE_URL: LOCAL, E2E_EMAIL: "e2e@local.test" })).toBeNull();
  });

  it("recusa o banco de produção, inclusive só na URL de migração", () => {
    expect(isolationRefusal({ DATABASE_URL: SUPABASE })).toMatch(/fora do loopback/);
    expect(isolationRefusal({ DATABASE_URL: LOCAL, DATABASE_MIGRATION_URL: SUPABASE })).toMatch(
      /DATABASE_MIGRATION_URL/,
    );
  });

  it("recusa URL de produção nas variáveis do provedor, que a migração usa como alternativa", () => {
    expect(isolationRefusal({ DATABASE_URL: LOCAL, POSTGRES_URL_NON_POOLING: SUPABASE })).toMatch(
      /POSTGRES_URL_NON_POOLING/,
    );
    expect(isolationRefusal({ DATABASE_URL: LOCAL, POSTGRES_URL: SUPABASE })).toMatch(/POSTGRES_URL/);
  });

  it("recusa sem banco declarado ou com URL inválida", () => {
    expect(isolationRefusal({})).toMatch(/ausente/);
    expect(isolationRefusal({ DATABASE_URL: "não é url" })).toMatch(/inválida/);
  });

  // #435: o navegador também escreve (conta, vaga, visibilidade). Rodado contra
  // o site publicado, cria dados em produção mesmo com o banco local declarado.
  it("recusa alvo HTTP fora do loopback e aceita o padrão local", () => {
    expect(isolationRefusal({ DATABASE_URL: LOCAL, E2E_BASE: "https://jobs.mastertimm.com.br" })).toMatch(
      /E2E_BASE.*fora do loopback/,
    );
    expect(isolationRefusal({ DATABASE_URL: LOCAL, E2E_BASE: "http://127.0.0.1:3000" })).toBeNull();
    expect(isolationRefusal({ DATABASE_URL: LOCAL, E2E_BASE: "http://[::1]:3101" })).toBeNull();
    // Ausente, `ui.mjs` e `a11y.mjs` caem em http://127.0.0.1:3000.
    expect(isolationRefusal({ DATABASE_URL: LOCAL })).toBeNull();
  });

  it("recusa alvo HTTP com URL inválida, inclusive vazia", () => {
    expect(isolationRefusal({ DATABASE_URL: LOCAL, E2E_BASE: "jobs.mastertimm.com.br" })).toMatch(
      /E2E_BASE inválida/,
    );
    // `ui.mjs` lê com `??`: vazio não cai no padrão, vira base relativa.
    expect(isolationRefusal({ DATABASE_URL: LOCAL, E2E_BASE: "" })).toMatch(/E2E_BASE inválida/);
  });

  it("recusa JHO_TEST_DATABASE_URL diferente do banco que o setup usa", () => {
    const other = "postgresql://jho:jho@127.0.0.1:5432/jho";
    expect(isolationRefusal({ DATABASE_URL: LOCAL, JHO_TEST_DATABASE_URL: other })).toMatch(
      /JHO_TEST_DATABASE_URL/,
    );
    expect(isolationRefusal({ DATABASE_URL: LOCAL, JHO_TEST_DATABASE_URL: LOCAL })).toBeNull();
  });

  it("recusa conta de e2e com e-mail de uma pessoa", () => {
    expect(isolationRefusal({ DATABASE_URL: LOCAL, E2E_EMAIL: "alguem@gmail.com" })).toMatch(/E2E_EMAIL/);
  });

  it("o build descartável não recebe arquivo de ambiente real", () => {
    for (const file of [".env", ".env.local", ".env.production", ".env.production.local", ".env.development"]) {
      expect(copiedToHarness(file), file).toBe(false);
    }
    for (const generated of [".git/HEAD", ".next/server", "node_modules/next", "data/jobs.db"]) {
      expect(copiedToHarness(generated), generated).toBe(false);
    }
    // O molde não tem valor real e documenta o contrato; o código, sim, vai.
    for (const kept of ["", ".env.example", "app/page.tsx", "tests/e2e/ui.mjs", "package.json"]) {
      expect(copiedToHarness(kept), kept).toBe(true);
    }
    const runner = readFileSync("tests/e2e/run-isolated.mjs", "utf8");
    expect(runner).toContain("filter: (source) => copiedToHarness(relative(ROOT, source))");
  });

  it("setup.mjs consulta a guarda antes de migrar ou escrever", () => {
    const setup = readFileSync("tests/e2e/setup.mjs", "utf8");
    const guard = setup.indexOf("isolationRefusal(process.env)");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(setup.indexOf("await runMigrations()"));
  });

  it("ui.mjs e a11y.mjs consultam a guarda antes de abrir o navegador", () => {
    for (const file of ["tests/e2e/ui.mjs", "tests/e2e/a11y.mjs"]) {
      const source = readFileSync(file, "utf8");
      const guard = source.indexOf("isolationRefusal(process.env)");
      expect(guard, file).toBeGreaterThan(-1);
      expect(guard, file).toBeLessThan(source.indexOf("chromium.launch("));
    }
  });
});
