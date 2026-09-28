import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * O limite por IP do portfólio público no proxy, com a foto e a capa (#327)
 * em balde próprio: uma visita pede a página e até duas imagens, e no mesmo
 * balde dez visitas esgotariam o limite de quem só abriu o link.
 */
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadProxy() {
  vi.stubEnv("JHO_AUTH_MODE", "");
  vi.resetModules();
  return (await import("../proxy.ts")).proxy;
}

const request = (path: string, ip: string) =>
  new NextRequest(new URL(path, "http://127.0.0.1:3000"), { headers: { "x-forwarded-for": ip } });

describe("limite do portfólio público", () => {
  it("imagens não gastam o limite da página, e cada balde recusa com Retry-After", async () => {
    const proxy = await loadProxy();
    for (let i = 0; i < 60; i++) {
      expect(proxy(request(`/p/maria/image/${i % 2 ? "photo" : "cover"}`, "203.0.113.7")).status, `imagem ${i}`).not.toBe(429);
    }
    const blockedImage = proxy(request("/p/maria/image/photo", "203.0.113.7"));
    expect(blockedImage.status).toBe(429);
    expect(Number(blockedImage.headers.get("retry-after"))).toBeGreaterThan(0);

    // A página do mesmo IP continua com o limite inteiro.
    for (let i = 0; i < 30; i++) expect(proxy(request("/p/maria", "203.0.113.7")).status, `página ${i}`).not.toBe(429);
    expect(proxy(request("/p/maria", "203.0.113.7")).status).toBe(429);
  });

  it("só o caminho exato da imagem usa o balde das imagens", async () => {
    const proxy = await loadProxy();
    // Varredura por caminho aninhado continua no balde da página.
    for (let i = 0; i < 30; i++) proxy(request(`/p/maria/image/photo/extra${i}`, "198.51.100.9"));
    expect(proxy(request("/p/outra", "198.51.100.9")).status).toBe(429);
    expect(proxy(request("/p/outra/image/photo", "198.51.100.9")).status).not.toBe(429);
  });
});
