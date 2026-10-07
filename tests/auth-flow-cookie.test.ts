/**
 * Suíte: cookie cifrado do fluxo OIDC, `next` seguro e destino por papel (#464).
 *
 * Fronteira DENTRO: `infra/flow-cookie.ts` (AES-GCM com chave derivada) e
 * `domain/landing.ts`. Chave e relógio entram por parâmetro.
 * Fronteira FORA: a rota que grava e lê o cookie, e o provedor.
 */
import { describe, expect, it } from "vitest";
import { landingFor, safeNext } from "../src/contexts/auth/domain/landing.ts";
import {
  checkCallbackState,
  flowKey,
  FLOW_TTL_MS,
  openFlow,
  sealFlow,
} from "../src/contexts/auth/infra/flow-cookie.ts";
import type { OidcFlowState } from "../src/contexts/auth/ports.ts";

const CREATED = "2026-10-06T12:00:00.000Z";
const KEY = flowKey("segredo-de-teste-com-mais-de-trinta-e-dois-caracteres");

const flow: OidcFlowState = {
  provider: "google",
  state: "state-abc",
  nonce: "nonce-def",
  codeVerifier: "verifier-ghi",
  intent: "signin",
  next: "/jobs/12",
  createdAt: CREATED,
};

const at = (ms: number) => new Date(Date.parse(CREATED) + ms);

describe("cookie do fluxo", () => {
  it("UT-030 selado e aberto com a mesma chave devolve o mesmo estado, sem nada legível no cookie", () => {
    const sealed = sealFlow(flow, KEY);
    expect(openFlow(sealed, KEY, at(1_000))).toEqual(flow);
    // Cifrado, não só assinado: o verificador PKCE não aparece no cookie.
    expect(Buffer.from(sealed, "base64url").toString("latin1")).not.toContain("verifier-ghi");
    // Duas selagens do mesmo estado não se repetem (IV aleatório).
    expect(sealFlow(flow, KEY)).not.toBe(sealed);
  });

  it("UT-031 qualquer byte alterado, chave errada ou lixo devolve null", () => {
    const sealed = sealFlow(flow, KEY);
    const raw = Buffer.from(sealed, "base64url");
    for (const index of [0, 12, Math.floor(raw.length / 2), raw.length - 1]) {
      const tampered = Buffer.from(raw);
      tampered[index] = tampered[index]! ^ 0x01;
      expect(openFlow(tampered.toString("base64url"), KEY, at(1_000)), `byte ${index}`).toBeNull();
    }
    expect(openFlow(sealed, flowKey("outro-segredo-com-mais-de-trinta-e-dois-chars"), at(1_000))).toBeNull();
    expect(openFlow("", KEY, at(0))).toBeNull();
    expect(openFlow(null, KEY, at(0))).toBeNull();
    expect(openFlow("não é base64", KEY, at(0))).toBeNull();
    expect(openFlow(Buffer.alloc(20).toString("base64url"), KEY, at(0))).toBeNull();
  });

  it("UT-031 estado cifrado com a chave certa mas em forma errada também é recusado", () => {
    const forged = { ...flow, provider: "github" } as unknown as OidcFlowState;
    expect(openFlow(sealFlow(forged, KEY), KEY, at(1_000))).toBeNull();
    const badIntent = { ...flow, intent: "admin" } as unknown as OidcFlowState;
    expect(openFlow(sealFlow(badIntent, KEY), KEY, at(1_000))).toBeNull();
  });

  it("UT-032 vale até 10 minutos: 9 min 59 s abre, 10 min + 1 s não", () => {
    const sealed = sealFlow(flow, KEY);
    expect(FLOW_TTL_MS).toBe(600_000);
    expect(openFlow(sealed, KEY, at(9 * 60_000 + 59_000))).toEqual(flow);
    expect(openFlow(sealed, KEY, at(10 * 60_000))).toEqual(flow);
    expect(openFlow(sealed, KEY, at(10 * 60_000 + 1_000))).toBeNull();
  });

  it("UT-033 state do retorno diferente do cookie, ou cookie ausente, vira expired", () => {
    expect(checkCallbackState(flow, "state-abc")).toEqual({ ok: true, flow });
    expect(checkCallbackState(flow, "state-abd")).toEqual({ ok: false, reason: "expired" });
    expect(checkCallbackState(flow, "state-ab")).toEqual({ ok: false, reason: "expired" });
    expect(checkCallbackState(flow, null)).toEqual({ ok: false, reason: "expired" });
    expect(checkCallbackState(null, "state-abc")).toEqual({ ok: false, reason: "expired" });
  });
});

describe("next seguro e destino", () => {
  it("UT-034 só aceita caminho relativo do próprio site", () => {
    expect(safeNext("/jobs/12")).toBe("/jobs/12");
    expect(safeNext("/jobs?q=ai#top")).toBe("/jobs?q=ai#top");
    for (const hostile of [
      "https://evil.test",
      "//evil.test",
      "/\\evil",
      "/\\/evil.test",
      "\\\\evil.test",
      "/\t/evil.test",
      "jobs/12",
      "javascript:alert(1)",
      "",
      `/${"a".repeat(2048)}`,
      // Segmentos de ponto: o parser os resolve e a saída vira `//evil.test`.
      "/..//evil.test",
      "/.//evil.test",
      "/a/..//evil.test",
      "/%2e%2e//evil.test",
      "/%2E//evil.test",
      "/a/b/../..//evil.test",
    ]) {
      expect(safeNext(hostile), JSON.stringify(hostile)).toBeNull();
    }
    expect(safeNext(null)).toBeNull();
    expect(safeNext(undefined)).toBeNull();
  });

  it("UT-034 o que safeNext devolve é ponto fixo: conferido de novo, sai igual", () => {
    for (const raw of ["/jobs/12", "/jobs?q=ai#top", "/a/../jobs", "/./jobs", "/%2e%2e/jobs", "/a/b/../c"]) {
      const out = safeNext(raw);
      expect(out, JSON.stringify(raw)).not.toBeNull();
      expect(safeNext(out), JSON.stringify(raw)).toBe(out);
    }
  });

  it("UT-035 sem next vai para a tela do papel; com next seguro, para ele", () => {
    expect(landingFor(["recruiter"], null)).toBe("/jobs");
    expect(landingFor(["candidate"], null)).toBe("/");
    expect(landingFor(["candidate"], "/jobs/1")).toBe("/jobs/1");
    expect(landingFor(["admin"], null)).toBe("/jobs");
    expect(landingFor(["admin", "candidate"], null)).toBe("/");
    // next hostil é ignorado, não seguido.
    expect(landingFor(["candidate"], "//evil.test")).toBe("/");
    expect(landingFor(["candidate"], "/..//evil.test")).toBe("/");
    expect(landingFor(["recruiter"], "/%2e%2e//evil.test")).toBe("/jobs");
  });
});
