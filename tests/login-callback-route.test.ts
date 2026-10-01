import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  finishLogin: vi.fn(),
  isOpenMode: vi.fn(),
}));
const cookieJar = vi.hoisted(() => ({ set: vi.fn() }));

vi.mock("../src/contexts/auth/index.ts", () => auth);
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => cookieJar) }));
vi.mock("../app/auth.ts", () => ({ SESSION_COOKIE: "jho_session" }));

const { GET } = await import("../app/login/callback/route.ts");

beforeEach(() => {
  auth.finishLogin.mockReset();
  auth.isOpenMode.mockReset();
  auth.isOpenMode.mockReturnValue(false);
  cookieJar.set.mockReset();
});

describe("callback do login", () => {
  it("mantém o redirect inválido relativo à origem da requisição", async () => {
    auth.finishLogin.mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://127.0.0.1:3210/login/callback?token=token-invalido"),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?error=invalid");
    expect(auth.finishLogin).toHaveBeenCalledWith("token-invalido");
  });

  it("deixa o App Router tratar o redirect RSC como navegação interna", async () => {
    auth.finishLogin.mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://127.0.0.1:3210/login/callback?token=token-invalido", {
        headers: { RSC: "1" },
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3210/login?error=invalid");
  });

  it("mantém o redirect de sucesso relativo e grava a sessão", async () => {
    auth.finishLogin.mockResolvedValue({
      token: "sessao-de-teste",
      session: { expiresAt: "2026-10-01T12:00:00.000Z" },
    });

    const response = await GET(
      new NextRequest("http://127.0.0.1:3210/login/callback?token=token-valido"),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(cookieJar.set).toHaveBeenCalledWith(
      "jho_session",
      "sessao-de-teste",
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
    );
  });
});
