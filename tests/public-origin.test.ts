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
// A máquina do dono se declara (#378): ausência de variáveis não é prova de nada.
const LOCAL = { JHO_ENV: "local" };

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

  it("#378: processo que não declara ambiente nenhum falha fechado — não é tratado como a máquina do dono", () => {
    // Reprodução do defeito: sem `VERCEL`, `VERCEL_ENV` nem `JHO_ENV` (a
    // Vercel com a exposição de variáveis de sistema desligada, ou um destino
    // novo que ainda não declara nada), a ausência era lida como "local" e o
    // `Host` do cliente decidia o link — host poisoning (G17).
    for (const env of [{}, { JHO_ENV: "" }, { JHO_ENV: "  " }, { VERCEL: "" }]) {
      expect(
        resolvePublicOrigin(env, { host: "atacante.example", proto: "https" }),
        JSON.stringify(env),
      ).toBeNull();
    }
  });

  describe("na Vercel, sem JHO_PUBLIC_URL cadastrada — funciona sem cadastro manual", () => {
    it("produção usa VERCEL_PROJECT_PRODUCTION_URL, nunca o Host do cliente", () => {
      const origin = resolvePublicOrigin(
        { VERCEL: "1", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "jobs.mastertimm.com.br" },
        { host: "atacante.example", proto: "https" },
      );
      expect(origin).toBe("https://jobs.mastertimm.com.br");
    });

    it("preview prefere VERCEL_BRANCH_URL (estável por branch) a VERCEL_URL (por deployment)", () => {
      const origin = resolvePublicOrigin(
        {
          VERCEL: "1",
          VERCEL_ENV: "preview",
          VERCEL_BRANCH_URL: "master-jobs-git-ci-plano-b-fly.vercel.app",
          VERCEL_URL: "master-jobs-abc123.vercel.app",
        },
        { host: "atacante.example", proto: "https" },
      );
      expect(origin).toBe("https://master-jobs-git-ci-plano-b-fly.vercel.app");
    });

    it("preview sem VERCEL_BRANCH_URL cai para VERCEL_URL, nunca o Host do cliente", () => {
      const origin = resolvePublicOrigin(
        { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "master-jobs-git-tarefa.vercel.app" },
        { host: "atacante.example", proto: "https" },
      );
      expect(origin).toBe("https://master-jobs-git-tarefa.vercel.app");
    });

    it("VERCEL_BRANCH_URL vazia não vence VERCEL_URL (regra 17: '' não é presença)", () => {
      const origin = resolvePublicOrigin(
        { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "", VERCEL_URL: "master-jobs-abc123.vercel.app" },
        { host: "atacante.example", proto: "https" },
      );
      expect(origin).toBe("https://master-jobs-abc123.vercel.app");
    });

    it("VERCEL_ENV ausente ou diferente de production também usa o ramo de preview", () => {
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
