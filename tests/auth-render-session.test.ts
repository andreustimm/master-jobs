import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveSession = vi.fn(async (_token: string | null, _candidateId: number | null) => ({ email: "dono@example.com" }));
const getCandidate = vi.fn(async () => ({ id: 7 }));
let open = false;

// `cache()` do React só memoriza dentro de uma requisição do servidor; no
// vitest ele é passagem direta. Este substituto faz o papel de UMA requisição.
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  cache: <T extends (...args: never[]) => unknown>(fn: T) => {
    let memo: ReturnType<T> | undefined;
    return (() => (memo ??= fn() as ReturnType<T>)) as unknown as T;
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "token" }) }) }));
vi.mock("next/navigation", () => ({ forbidden: () => undefined, redirect: () => undefined }));
vi.mock("../src/core/candidate.ts", () => ({ getCandidate: () => getCandidate() }));
vi.mock("../src/contexts/auth/index.ts", async (original) => ({
  ...(await original<typeof import("../src/contexts/auth/index.ts")>()),
  isOpenMode: () => open,
  resolveSession: (token: string | null, candidateId: number | null) => resolveSession(token, candidateId),
}));

describe("sessão de renderização", () => {
  beforeEach(() => {
    vi.resetModules();
    resolveSession.mockClear();
    getCandidate.mockClear();
    open = false;
  });

  it("layout, badge e página compartilham uma resolução por requisição", async () => {
    const { renderSession } = await import("../app/auth.ts");

    await Promise.all([renderSession(), renderSession(), renderSession()]);

    // Eram três resoluções, cada uma com a sua ida ao banco, disputando as três
    // conexões do pool com a própria página.
    expect(resolveSession).toHaveBeenCalledTimes(1);
  });

  it("currentSession continua sem cache: ação lê a sessão DEPOIS de a impersonação trocá-la", async () => {
    const { currentSession } = await import("../app/auth.ts");

    await currentSession();
    await currentSession();

    expect(resolveSession).toHaveBeenCalledTimes(2);
  });

  it("em produção não busca o candidato padrão, que só serve ao modo aberto", async () => {
    const { currentSession } = await import("../app/auth.ts");

    await currentSession();

    expect(getCandidate).not.toHaveBeenCalled();
    expect(resolveSession).toHaveBeenCalledWith("token", null);
  });

  it("no modo aberto ainda passa o candidato padrão à sessão sintetizada", async () => {
    open = true;
    const { currentSession } = await import("../app/auth.ts");

    await currentSession();

    expect(getCandidate).toHaveBeenCalledTimes(1);
    expect(resolveSession).toHaveBeenCalledWith("token", 7);
  });
});
