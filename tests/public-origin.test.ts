// Suite: origem pública do link de recuperação (M1, host poisoning)
// Invariant: o link de recuperação de senha nunca deriva do `Host` do
//   cliente em deployment; `JHO_PUBLIC_URL` é a única fonte confiável, e sua
//   ausência falha fechado fora da máquina do dono.
// Boundary IN: `resolvePublicOrigin`, função pura sobre variáveis de
//   ambiente e o par host/proto que a Server Action leria de `headers()`.
// Boundary OUT: `headers()` do Next e o envio real do e-mail, cobertos por
//   tests/password-reset.test.ts (que já injeta `linkFor` diretamente).
import { describe, expect, it } from "vitest";
import { resolvePublicOrigin } from "../src/contexts/auth/domain/public-origin.ts";

const DEPLOYMENT = { VERCEL: "1" };
const LOCAL = {};

describe("resolvePublicOrigin", () => {
  it("usa JHO_PUBLIC_URL quando configurada, ignorando qualquer Host", () => {
    const origin = resolvePublicOrigin(
      { ...DEPLOYMENT, JHO_PUBLIC_URL: "https://jobs.mastertimm.com.br/algum/caminho?x=1" },
      { host: "atacante.example", proto: "https" },
    );
    expect(origin).toBe("https://jobs.mastertimm.com.br");
  });

  it("JHO_PUBLIC_URL malformada nunca cai de volta para o Host do cliente", () => {
    const origin = resolvePublicOrigin(
      { ...DEPLOYMENT, JHO_PUBLIC_URL: "isto não é uma URL" },
      { host: "atacante.example", proto: "https" },
    );
    expect(origin).toBeNull();
  });

  it("JHO_PUBLIC_URL com esquema fora de http/https é recusada", () => {
    const origin = resolvePublicOrigin(
      { ...DEPLOYMENT, JHO_PUBLIC_URL: "ftp://jobs.mastertimm.com.br" },
      { host: "atacante.example", proto: "https" },
    );
    expect(origin).toBeNull();
  });

  it("na máquina local, sem a variável, usa o Host da requisição (conveniência de dev)", () => {
    expect(resolvePublicOrigin(LOCAL, { host: "127.0.0.1:3000", proto: "http" })).toBe(
      "http://127.0.0.1:3000",
    );
    expect(resolvePublicOrigin(LOCAL, { host: null, proto: "http" })).toBe("http://127.0.0.1:3000");
  });

  it("REPRODUZ o defeito: em deployment sem JHO_PUBLIC_URL nem variável de host, o Host do cliente NUNCA é usado", () => {
    // Esta é a reprodução do MAJOR M1: sem a correção, esta chamada devolveria
    // "https://atacante.example" — o link de recuperação apontaria para o
    // domínio de quem atacou (host poisoning), atrás de qualquer proxy que
    // repasse o `Host` recebido do cliente (Fly.io, e a Vercel também).
    const origin = resolvePublicOrigin(DEPLOYMENT, { host: "atacante.example", proto: "https" });
    expect(origin).toBeNull();
    expect(origin).not.toBe("https://atacante.example");
  });

  it("deployment declarado só por JHO_ENV (sem VERCEL) também falha fechado", () => {
    // O caso do plano B no Fly: nenhuma variável VERCEL existe lá.
    const origin = resolvePublicOrigin(
      { JHO_ENV: "production" },
      { host: "atacante.example", proto: "https" },
    );
    expect(origin).toBeNull();
  });

  describe("na Vercel, sem JHO_PUBLIC_URL cadastrada — funciona sem cadastro manual", () => {
    it("produção usa VERCEL_PROJECT_PRODUCTION_URL, nunca o Host do cliente", () => {
      const origin = resolvePublicOrigin(
        { VERCEL: "1", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "jobs.mastertimm.com.br" },
        { host: "atacante.example", proto: "https" },
      );
      expect(origin).toBe("https://jobs.mastertimm.com.br");
    });

    it("preview usa VERCEL_URL, nunca o Host do cliente", () => {
      const origin = resolvePublicOrigin(
        { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "master-jobs-git-tarefa.vercel.app" },
        { host: "atacante.example", proto: "https" },
      );
      expect(origin).toBe("https://master-jobs-git-tarefa.vercel.app");
    });

    it("VERCEL_ENV ausente ou diferente de production também usa VERCEL_URL (o mesmo ramo de preview)", () => {
      const origin = resolvePublicOrigin(
        { VERCEL: "1", VERCEL_URL: "master-jobs-abc123.vercel.app" },
        { host: "atacante.example", proto: "https" },
      );
      expect(origin).toBe("https://master-jobs-abc123.vercel.app");
    });

    it("produção sem VERCEL_PROJECT_PRODUCTION_URL falha fechado — nunca usa VERCEL_URL nem o Host", () => {
      const origin = resolvePublicOrigin(
        { VERCEL: "1", VERCEL_ENV: "production", VERCEL_URL: "algum-deployment.vercel.app" },
        { host: "atacante.example", proto: "https" },
      );
      expect(origin).toBeNull();
    });

    it("JHO_PUBLIC_URL, quando cadastrada, tem prioridade sobre as variáveis da Vercel", () => {
      const origin = resolvePublicOrigin(
        {
          VERCEL: "1",
          VERCEL_ENV: "production",
          VERCEL_PROJECT_PRODUCTION_URL: "outro-host.vercel.app",
          JHO_PUBLIC_URL: "https://jobs.mastertimm.com.br",
        },
        { host: "atacante.example", proto: "https" },
      );
      expect(origin).toBe("https://jobs.mastertimm.com.br");
    });
  });
});
