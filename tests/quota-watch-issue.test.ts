import { describe, expect, it } from "vitest";
import { quotaWatchIssue } from "../src/contexts/operations/infra/quota-watch-issue.ts";

/**
 * `quotaWatchIssue` — o alerta do vigia de cota, uma issue no próprio
 * repositório (ADR 0030 decisão 7: nenhuma ação automática é silenciosa).
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

  it("sucesso: chama o repositório certo, com o rótulo e o token no header", async () => {
    let url = "";
    let body: unknown;
    let authorization = "";
    const alert = quotaWatchIssue({
      token: SEGREDO,
      repo: "dono/repo",
      fetchImpl: async (input, init) => {
        url = String(input);
        authorization = String((init?.headers as Record<string, string>).authorization);
        body = JSON.parse(String(init?.body));
        return new Response(null, { status: 201 });
      },
    });
    const result = await alert.open({ title: "Vigia de cota: aviso", body: "80%" });
    expect(result).toEqual({ ok: true });
    expect(url).toBe("https://api.github.com/repos/dono/repo/issues");
    expect(body).toEqual({ title: "Vigia de cota: aviso", body: "80%", labels: ["vigia-de-cota"] });
    expect(authorization).toContain(SEGREDO);
  });

  it("repositório padrão quando não configurado", async () => {
    let url = "";
    const alert = quotaWatchIssue({
      token: SEGREDO,
      fetchImpl: async (input) => { url = String(input); return new Response(null, { status: 201 }); },
    });
    await alert.open({ title: "t", body: "b" });
    expect(url).toBe("https://api.github.com/repos/andreustimm/master-jobs/issues");
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
