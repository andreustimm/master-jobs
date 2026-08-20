import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configuredMailer,
  consoleMailer,
  resendMailer,
} from "../src/contexts/auth/infra/resend-mailer.ts";

/**
 * O adapter de e-mail.
 *
 * Dois comportamentos importam mais que o envio em si: **sem chave o sistema
 * continua funcionando**, e **o erro que sobe não carrega o endereço de
 * ninguém**.
 */

const ORIGINAL = { ...process.env };

beforeEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.restoreAllMocks();
});

const MAIL = { to: "pessoa@local.test", subject: "Assunto", text: "corpo\ncom link" };

describe("configuredMailer", () => {
  it("sem chave, cai para o terminal em vez de falhar", () => {
    // A chave é do usuário e ninguém mais pode gerá-la. Falhar o cadastro de
    // conta porque não há provedor configurado transformaria um detalhe de
    // infraestrutura em bloqueio de produto.
    expect(configuredMailer({} as unknown as NodeJS.ProcessEnv).name).toBe("console");
  });

  it("chave sem remetente também cai para o terminal", () => {
    // O Resend recusa envio sem `from` verificado. Metade da configuração é
    // configuração nenhuma, e descobrir isso na hora do envio seria tarde.
    expect(configuredMailer({ RESEND_API_KEY: "re_x" } as unknown as NodeJS.ProcessEnv).name).toBe("console");
    expect(configuredMailer({ RESEND_FROM: "eu@dominio.test" } as unknown as NodeJS.ProcessEnv).name).toBe("console");
  });

  it("espaço em branco não conta como configuração", () => {
    expect(configuredMailer({ RESEND_API_KEY: "  ", RESEND_FROM: "  " } as unknown as NodeJS.ProcessEnv).name).toBe("console");
  });

  it("com as duas variáveis, usa o Resend", () => {
    expect(
      configuredMailer({ RESEND_API_KEY: "re_x", RESEND_FROM: "eu@dominio.test" } as unknown as NodeJS.ProcessEnv).name,
    ).toBe("resend");
  });

  it("lê o ambiente a cada chamada", () => {
    // Valor capturado na importação tornaria a troca impossível de exercitar —
    // e impossível de corrigir sem reiniciar o processo.
    expect(configuredMailer({} as unknown as NodeJS.ProcessEnv).name).toBe("console");
    expect(configuredMailer({ RESEND_API_KEY: "k", RESEND_FROM: "f@x.test" } as unknown as NodeJS.ProcessEnv).name).toBe("resend");
  });
});

describe("consoleMailer", () => {
  it("diz que NÃO enviou, e mostra o conteúdo", async () => {
    const linhas: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      linhas.push(args.join(" "));
    });

    expect(await consoleMailer.send(MAIL)).toEqual({ ok: true, id: null });

    const saida = linhas.join("\n");
    // Sem o aviso, alguém em produção acharia que o e-mail saiu.
    expect(saida).toContain("NÃO enviado");
    expect(saida).toContain("RESEND_API_KEY");
    expect(saida).toContain("pessoa@local.test");
    expect(saida).toContain("com link");
  });
});

describe("resendMailer", () => {
  it("assina a chamada e devolve o id", async () => {
    let visto: { url: string; init: RequestInit } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      visto = { url, init };
      return new Response(JSON.stringify({ id: "abc" }), { status: 200 });
    }) as unknown as typeof fetch;

    expect(await resendMailer("re_secreta", "eu@dominio.test", fake).send(MAIL)).toEqual({
      ok: true,
      id: "abc",
    });
    expect(visto!.url).toBe("https://api.resend.com/emails");
    expect((visto!.init.headers as Record<string, string>).authorization).toBe("Bearer re_secreta");
    expect(JSON.parse(String(visto!.init.body))).toMatchObject({
      from: "eu@dominio.test",
      to: ["pessoa@local.test"],
    });
  });

  it("erro do provedor NÃO carrega o destinatário", async () => {
    const fake = (async () =>
      new Response(JSON.stringify({ message: "invalid recipient pessoa@local.test" }), {
        status: 422,
      })) as unknown as typeof fetch;

    const result = await resendMailer("k", "f@x.test", fake).send(MAIL);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("esperava falha");

    // A string vai para log, e log de autenticação não é lugar de endereço de
    // e-mail — o corpo do erro do provedor cita o destinatário; o status não.
    expect(result.error).toContain("422");
    expect(result.error).not.toContain("pessoa@local.test");
  });

  it("falha de rede vira resultado, não exceção", async () => {
    const fake = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    // Exceção aqui subiria até a tela e distinguiria conta existente de
    // inexistente pelo tipo do erro — o oposto do que a recuperação faz.
    expect(await resendMailer("k", "f@x.test", fake).send(MAIL)).toEqual({
      ok: false,
      error: "ECONNREFUSED",
    });
  });

  it("resposta ok sem corpo JSON continua sendo sucesso", async () => {
    const fake = (async () =>
      new Response("nao é json", { status: 200 })) as unknown as typeof fetch;
    expect(await resendMailer("k", "f@x.test", fake).send(MAIL)).toEqual({ ok: true, id: null });
  });

  it("a chave nunca aparece no resultado", async () => {
    const fake = (async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    const result = await resendMailer("re_muito_secreta", "f@x.test", fake).send(MAIL);
    expect(JSON.stringify(result)).not.toContain("re_muito_secreta");
  });
});
