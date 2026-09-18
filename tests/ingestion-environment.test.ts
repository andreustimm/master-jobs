import { describe, expect, it, vi } from "vitest";
import {
  assertIngestionAllowed,
  canRunIngestion,
  IngestionBlockedError,
  INGESTION_ENVIRONMENTS,
  normalizeIngestionContext,
  type IngestionContext,
  type IngestionEnvironment,
} from "../src/core/ingest/environment.ts";
import { currentIngestionContext, guardIngestion } from "../src/core/ingest/guard.ts";

/**
 * Suite: política de ingestão por ambiente (F-08, UT-001 e UT-002)
 * Invariant: nenhum ambiente não-produtivo gasta cota de fonte externa.
 * Boundary IN: a decisão pura e a normalização da configuração crua.
 * Boundary OUT: os entrypoints em si, cobertos pela integração IT-002.
 */

function context(overrides: Partial<IngestionContext> = {}): IngestionContext {
  return {
    environment: "production",
    explicitOptIn: false,
    productionAllowlistSatisfied: true,
    ...overrides,
  };
}

describe("UT-001 — a política nega por omissão", () => {
  it("libera produção somente com a allowlist satisfeita", () => {
    expect(canRunIngestion(context())).toEqual({ allowed: true });
    expect(canRunIngestion(context({ productionAllowlistSatisfied: false }))).toMatchObject({
      allowed: false,
    });
  });

  it("nega dev, staging e preview mesmo com allowlist e opt-in", () => {
    // A combinação mais permissiva possível ainda tem que ser negada: o que
    // decide é o ambiente, e nenhuma variável de conveniência compra exceção.
    for (const environment of ["dev", "staging", "preview"] as const) {
      const decision = canRunIngestion(
        context({ environment, explicitOptIn: true, productionAllowlistSatisfied: true }),
      );
      expect(decision.allowed, environment).toBe(false);
    }
  });

  it("exige opt-in explícito no local", () => {
    expect(canRunIngestion(context({ environment: "local" })).allowed).toBe(false);
    expect(canRunIngestion(context({ environment: "local", explicitOptIn: true }))).toEqual({
      allowed: true,
    });
  });

  it("nega ambiente desconhecido que escapou do tipo", () => {
    // O `default` do switch é a rede que pega o ambiente novo que alguém
    // acrescentar sem passar por esta função.
    const smuggled = context({ environment: "qa" as IngestionEnvironment });

    expect(canRunIngestion(smuggled)).toEqual({ allowed: false, reason: "unknown environment" });
  });

  it("normaliza ambiente ausente ou ilegível para o mais restrito", () => {
    // Chutar "produção" aqui transformaria erro de digitação em gasto de cota.
    for (const raw of [undefined, null, "", "   ", "produção", "PROD"]) {
      expect(normalizeIngestionContext({ environment: raw }).environment, String(raw)).toBe("preview");
    }
    expect(normalizeIngestionContext({ environment: " Production " }).environment).toBe("production");
  });

  it("só considera a allowlist satisfeita quando ela tem conteúdo", () => {
    for (const raw of [undefined, null, "", " , , ", [], ["  "]]) {
      expect(
        normalizeIngestionContext({ productionAllowlist: raw }).productionAllowlistSatisfied,
        JSON.stringify(raw),
      ).toBe(false);
    }
    expect(
      normalizeIngestionContext({ productionAllowlist: "greenhouse, ashby" })
        .productionAllowlistSatisfied,
    ).toBe(true);
  });

  it("aceita opt-in só como verdadeiro explícito", () => {
    for (const raw of [undefined, null, "", "1", "yes", "TRUE ".trim().toLowerCase() === "true" ? "" : "no"]) {
      expect(normalizeIngestionContext({ explicitOptIn: raw }).explicitOptIn, String(raw)).toBe(false);
    }
    expect(normalizeIngestionContext({ explicitOptIn: "true" }).explicitOptIn).toBe(true);
    expect(normalizeIngestionContext({ explicitOptIn: true }).explicitOptIn).toBe(true);
  });

  it("cobre todo ambiente declarado, sem buraco silencioso", () => {
    for (const environment of INGESTION_ENVIRONMENTS) {
      const decision = canRunIngestion(context({ environment, explicitOptIn: true }));
      expect(typeof decision.allowed, environment).toBe("boolean");
      if (!decision.allowed) expect(decision.reason.length, environment).toBeGreaterThan(0);
    }
  });
});

describe("UT-002 — bloqueio é barato, repetível e não vaza", () => {
  it("não cita segredo, host nem credencial na mensagem", () => {
    const error = (() => {
      try {
        assertIngestionAllowed(context({ environment: "staging" }));
        return null;
      } catch (thrown) {
        return thrown as IngestionBlockedError;
      }
    })();

    expect(error).toBeInstanceOf(IngestionBlockedError);
    expect(error!.code).toBe("ingestion_blocked");
    expect(error!.message).toBe("Ingestion blocked in staging: staging runs on fixtures only");
    // O texto vai para log de CI, lido por mais gente do que o banco.
    expect(error!.message).not.toMatch(/postgres|supabase|token|secret|password|@/i);
  });

  it("repete a mesma decisão sem efeito colateral nem I/O", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const blocked = context({ environment: "dev" });

    const decisions = Array.from({ length: 50 }, () => canRunIngestion(blocked));

    expect(new Set(decisions.map((d) => JSON.stringify(d))).size).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("lê o ambiente do processo sem depender do processo do teste", () => {
    // `currentIngestionContext` recebe o env por parâmetro justamente para o
    // teste não precisar mexer em `process.env` — mexer ali vaza entre suítes.
    expect(currentIngestionContext({ JHO_ENV: "staging" })).toMatchObject({
      environment: "staging",
    });
    expect(
      currentIngestionContext({ VERCEL_ENV: "production", JHO_SOURCE_ALLOWLIST: "ashby" }),
    ).toMatchObject({ environment: "production", productionAllowlistSatisfied: true });
    expect(currentIngestionContext({}).environment).toBe("preview");
  });

  it("o guarda lança antes de qualquer trabalho quando o ambiente nega", () => {
    expect(() => guardIngestion({ JHO_ENV: "dev" })).toThrow(IngestionBlockedError);
    expect(() =>
      guardIngestion({ JHO_ENV: "production", JHO_SOURCE_ALLOWLIST: "ashby" }),
    ).not.toThrow();
  });
});
