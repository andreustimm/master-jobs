import { describe, expect, it } from "vitest";
import { quotaWatchIssue } from "../src/contexts/operations/infra/quota-watch-issue.ts";

/**
 * `quotaWatchIssue` — o alerta do vigia de cota, uma issue no próprio
 * repositório (ADR 0030 decisão 7: nenhuma checagem que merece atenção fica
 * silenciosa). O vigia nunca aplica mudança sozinho: isto só abre ou
 * comenta, nunca `gh variable set`/`gh workflow disable` de verdade.
 */

const SEGREDO = "token-de-teste-nao-deve-aparecer";

describe("abrir issue", () => {
  it("sem token: não chama a rede, devolve o motivo", async () => {
    let chamadas = 0;
    const alert = quotaWatchIssue({
      token: undefined,
      fetchImpl: (async () => { chamadas += 1; return new Response(null, { status: 201 }); }) as typeof fetch,
    });
    const result = await alert.open({ title: "t", body: "b" });
    expect(result).toEqual({ ok: false, reason: "sem token configurado" });
    expect(chamadas).toBe(0);
  });

  it("sem token e sem fetchImpl: cai no `fetch` global sem nunca chamá-lo", async () => {
    const alert = quotaWatchIssue({ token: undefined });
    await expect(alert.open({ title: "t", body: "b" })).resolves.toEqual({ ok: false, reason: "sem token configurado" });
  });

  it("token vazio (\"\") é tratado como ausente — firstNonEmpty, não ??", async () => {
    let chamadas = 0;
    const alert = quotaWatchIssue({
      token: "",
      fetchImpl: (async () => { chamadas += 1; return new Response(null, { status: 201 }); }) as typeof fetch,
    });
    await expect(alert.open({ title: "t", body: "b" })).resolves.toEqual({ ok: false, reason: "sem token configurado" });
    expect(chamadas).toBe(0);
  });

  it("repo vazio (\"\") cai no repositório padrão, não numa URL quebrada", async () => {
    let url = "";
    const alert = quotaWatchIssue({
      token: SEGREDO,
      repo: "",
      fetchImpl: async (input) => { url = String(input); return new Response(JSON.stringify({ number: 1 }), { status: 201 }); },
    });
    await alert.open({ title: "t", body: "b" });
    expect(url).toBe("https://api.github.com/repos/andreustimm/master-jobs/issues");
  });

  it("sucesso: chama o repositório certo, com o rótulo, o token no header, um teto de tempo e devolve o número da issue", async () => {
    let url = "";
    let body: unknown;
    let authorization = "";
    let signal: AbortSignal | undefined;
    const alert = quotaWatchIssue({
      token: SEGREDO,
      repo: "dono/repo",
      fetchImpl: async (input, init) => {
        url = String(input);
        authorization = String((init?.headers as Record<string, string>).authorization);
        body = JSON.parse(String(init?.body));
        signal = init?.signal ?? undefined;
        return new Response(JSON.stringify({ number: 456 }), { status: 201 });
      },
    });
    const result = await alert.open({ title: "Vigia de cota: aviso", body: "80%" });
    expect(result).toEqual({ ok: true, number: 456 });
    expect(url).toBe("https://api.github.com/repos/dono/repo/issues");
    expect(body).toEqual({ title: "Vigia de cota: aviso", body: "80%", labels: ["vigia-de-cota"] });
    expect(authorization).toContain(SEGREDO);
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("repositório padrão quando não configurado", async () => {
    let url = "";
    const alert = quotaWatchIssue({
      token: SEGREDO,
      fetchImpl: async (input) => { url = String(input); return new Response(JSON.stringify({ number: 1 }), { status: 201 }); },
    });
    await alert.open({ title: "t", body: "b" });
    expect(url).toBe("https://api.github.com/repos/andreustimm/master-jobs/issues");
  });

  it("resposta sem `number` legível: ok, mas sem número (quem chama decide o que fazer)", async () => {
    const alert = quotaWatchIssue({
      token: SEGREDO,
      fetchImpl: async () => new Response(JSON.stringify({}), { status: 201 }),
    });
    await expect(alert.open({ title: "t", body: "b" })).resolves.toEqual({ ok: true, number: undefined });
  });

  it("recusa do GitHub: ok=false com o status, sem corpo nem credencial", async () => {
    const alert = quotaWatchIssue({
      token: SEGREDO,
      fetchImpl: async () => new Response(JSON.stringify({ message: SEGREDO }), { status: 403 }),
    });
    const result = await alert.open({ title: "t", body: "b" });
    expect(result).toEqual({ ok: false, reason: "status 403" });
    expect(JSON.stringify(result)).not.toContain(SEGREDO);
  });

  it("rede falhando (throw): ok=false, nunca propaga", async () => {
    const alert = quotaWatchIssue({
      token: SEGREDO,
      fetchImpl: async () => { throw new Error("timeout"); },
    });
    await expect(alert.open({ title: "t", body: "b" })).resolves.toEqual({ ok: false, reason: "erro de rede" });
  });
});

describe("comentar (M1 — dedupe)", () => {
  it("sem token: não chama a rede", async () => {
    let chamadas = 0;
    const alert = quotaWatchIssue({
      token: undefined,
      fetchImpl: (async () => { chamadas += 1; return new Response(null, { status: 201 }); }) as typeof fetch,
    });
    const result = await alert.comment({ issueNumber: 42, body: "de novo" });
    expect(result).toEqual({ ok: false, reason: "sem token configurado" });
    expect(chamadas).toBe(0);
  });

  it("sucesso: comenta na issue certa, com o corpo pedido", async () => {
    let url = "";
    let body: unknown;
    const alert = quotaWatchIssue({
      token: SEGREDO,
      repo: "dono/repo",
      fetchImpl: async (input, init) => {
        url = String(input);
        body = JSON.parse(String(init?.body));
        return new Response(null, { status: 201 });
      },
    });
    const result = await alert.comment({ issueNumber: 42, body: "Checagem se repete" });
    expect(result).toEqual({ ok: true });
    expect(url).toBe("https://api.github.com/repos/dono/repo/issues/42/comments");
    expect(body).toEqual({ body: "Checagem se repete" });
  });

  it("recusa do GitHub: ok=false com o status", async () => {
    const alert = quotaWatchIssue({
      token: SEGREDO,
      fetchImpl: async () => new Response(null, { status: 404 }),
    });
    await expect(alert.comment({ issueNumber: 999, body: "x" })).resolves.toEqual({ ok: false, reason: "status 404" });
  });

  it("rede falhando (throw): ok=false, nunca propaga", async () => {
    const alert = quotaWatchIssue({
      token: SEGREDO,
      fetchImpl: async () => { throw new Error("timeout"); },
    });
    await expect(alert.comment({ issueNumber: 1, body: "x" })).resolves.toEqual({ ok: false, reason: "erro de rede" });
  });
});
