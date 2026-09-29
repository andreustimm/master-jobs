// Suite: requestResetAction — a Server Action de pedido de recuperação (m3
//   da re-revisão da PR #373)
// Invariant: sem origem pública confiável, o pedido é auditado
//   (recordResetSendFailure) e NUNCA chega a askPasswordReset; a resposta
//   observável (o redirect) é idêntica ao caminho de sucesso — G17 exige que
//   o comportamento externo não distinga os dois casos.
// Boundary IN: app/login/forgot/actions.ts, com next/headers e
//   next/navigation dublados; askPasswordReset/recordResetSendFailure
//   dublados como espiões — resolvePublicOrigin continua real.
// Boundary OUT: o envio de e-mail de verdade e a escrita em auth_event,
//   cobertos por tests/password-reset.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = { host: null as string | null };

vi.mock("next/headers", () => ({
  headers: async () => new Headers(estado.host ? { host: estado.host } : {}),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT;${to}`);
  },
}));
vi.mock("../app/mutation-feedback-server", () => ({
  setMutationFeedbackCookie: async () => undefined,
}));

const espioes = {
  askPasswordReset: vi.fn(async (_email: string, _origem: string) => undefined),
  recordResetSendFailure: vi.fn(async (_email: string, _detalhe: string) => undefined),
};
vi.mock("../src/contexts/auth/index.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/contexts/auth/index.ts")>()),
  askPasswordReset: (...args: [string, string]) => espioes.askPasswordReset(...args),
  recordResetSendFailure: (...args: [string, string]) => espioes.recordResetSendFailure(...args),
}));

const { requestResetAction } = await import("../app/login/forgot/actions.ts");

function comEmail(email: string): FormData {
  const dados = new FormData();
  dados.set("email", email);
  return dados;
}

beforeEach(() => {
  espioes.askPasswordReset.mockClear();
  espioes.recordResetSendFailure.mockClear();
  estado.host = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("requestResetAction — sem origem pública confiável", () => {
  it("grava recordResetSendFailure, nunca askPasswordReset, e redireciona IGUAL ao caminho de sucesso", async () => {
    // Reproduz o plano B no Fly sem JHO_PUBLIC_URL: JHO_ENV declara
    // deployment (não local), mas nenhuma variável de origem existe.
    vi.stubEnv("JHO_ENV", "production");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("JHO_PUBLIC_URL", "");
    estado.host = "atacante.example";

    await expect(requestResetAction(comEmail("pessoa@exemplo.test"))).rejects.toThrow(
      "NEXT_REDIRECT;/login/forgot?sent=1",
    );

    expect(espioes.askPasswordReset).not.toHaveBeenCalled();
    expect(espioes.recordResetSendFailure).toHaveBeenCalledTimes(1);
    expect(espioes.recordResetSendFailure).toHaveBeenCalledWith(
      "pessoa@exemplo.test",
      expect.stringContaining("JHO_PUBLIC_URL"),
    );
  });

  it("com origem resolvida, chama askPasswordReset e o MESMO redirect — a resposta não distingue os dois casos", async () => {
    vi.stubEnv("JHO_PUBLIC_URL", "https://jobs.mastertimm.com.br");
    estado.host = "atacante.example"; // nunca lido: JHO_PUBLIC_URL vence.

    await expect(requestResetAction(comEmail("pessoa@exemplo.test"))).rejects.toThrow(
      "NEXT_REDIRECT;/login/forgot?sent=1",
    );

    expect(espioes.recordResetSendFailure).not.toHaveBeenCalled();
    expect(espioes.askPasswordReset).toHaveBeenCalledWith(
      "pessoa@exemplo.test",
      "https://jobs.mastertimm.com.br",
    );
  });
});
