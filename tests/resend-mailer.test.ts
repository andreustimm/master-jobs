import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configuredMailer,
  consoleMailer,
  resendMailer,
  withheldMailer,
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

/** Captura tudo que qualquer método do console imprimir — o vazamento pode vir por qualquer um. */
function captureConsole(): string[] {
  const linhas: string[] = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      linhas.push(args.map(String).join(" "));
    });
  }
  return linhas;
}

describe("configuredMailer", () => {
  it("sem chave, cai para o terminal em vez de falhar", () => {
    // A chave é do usuário e ninguém mais pode gerá-la. Falhar o cadastro de
    // conta porque não há provedor configurado transformaria um detalhe de
    // infraestrutura em bloqueio de produto.
    expect(configuredMailer({} as unknown as NodeJS.ProcessEnv).name).toBe("console");
  });

  it("chave sem remetente não envia e não imprime o corpo", () => {
    // O Resend recusa envio sem `from` verificado, então metade da configuração
    // não envia. Mas chave presente é intenção de enviar: imprimir o link ali
    // seria o vazamento que a chave veio evitar.
    expect(configuredMailer({ RESEND_API_KEY: "re_x" } as unknown as NodeJS.ProcessEnv).name).toBe("withheld");
    expect(configuredMailer({ RESEND_FROM: "eu@dominio.test" } as unknown as NodeJS.ProcessEnv).name).toBe("console");
  });

  it("deployment hospedado sem chave nunca usa o terminal", () => {
    // O log das funções da Vercel é lido por outras pessoas, e o corpo do
    // e-mail de recuperação é a credencial.
    for (const VERCEL_ENV of ["production", "preview"]) {
      expect(configuredMailer({ VERCEL_ENV } as unknown as NodeJS.ProcessEnv).name).toBe("withheld");
      expect(
        configuredMailer({ VERCEL_ENV, RESEND_FROM: "eu@dominio.test" } as unknown as NodeJS.ProcessEnv).name,
      ).toBe("withheld");
    }
    // Lista de permissão, a mesma do modo aberto: só `local` ou nenhuma
    // declaração usam o terminal. `development`, `VERCEL=1` e valor inventado
    // caem no lado seguro.
    for (const env of [
      { VERCEL_ENV: "development" },
      { VERCEL: "1" },
      { JHO_ENV: "production" },
      { JHO_ENV: "staging" },
      { JHO_ENV: "local", VERCEL_ENV: "production" },
    ]) {
      expect(configuredMailer(env as unknown as NodeJS.ProcessEnv).name, JSON.stringify(env)).toBe("withheld");
    }
    expect(configuredMailer({ JHO_ENV: "local" } as unknown as NodeJS.ProcessEnv).name).toBe("console");
  });

  it("em produção com as duas variáveis, usa o Resend", () => {
    expect(
      configuredMailer({
        VERCEL_ENV: "production",
        RESEND_API_KEY: "re_x",
        RESEND_FROM: "eu@dominio.test",
      } as unknown as NodeJS.ProcessEnv).name,
    ).toBe("resend");
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

describe("withheldMailer", () => {
  it("alerta sem imprimir destinatário, assunto, corpo nem link", async () => {
    const linhas = captureConsole();

    const secret = {
      to: "pessoa@local.test",
      subject: "Recuperar o acesso",
      text: "https://jobs.example.test/login/reset?token=tok_muito_secreto",
    };
    const result = await withheldMailer.send(secret);

    // Falha, não sucesso: nada foi entregue, e o auth_event precisa dizer isso.
    expect(result.ok).toBe(false);
    const saida = linhas.join("\n");
    expect(saida).toContain("ALERTA");
    expect(saida).toContain("RESEND_API_KEY");
    for (const vazamento of ["tok_muito_secreto", "/login/reset", "pessoa@local.test", "Recuperar o acesso"]) {
      expect(saida).not.toContain(vazamento);
      expect(JSON.stringify(result)).not.toContain(vazamento);
    }
  });

  it("com o ambiente de produção, o e-mail escolhido não imprime o link", async () => {
    const linhas = captureConsole();
    const mailer = configuredMailer({ VERCEL_ENV: "production" } as unknown as NodeJS.ProcessEnv);
    await mailer.send({ ...MAIL, text: "link https://x.test/login/reset?token=tok_prod" });
    expect(linhas.join("\n")).not.toContain("tok_prod");
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

  it("com a chave presente, nada é impresso no log", async () => {
    const linhas = captureConsole();
    const fake = (async () =>
      new Response(JSON.stringify({ id: "abc" }), { status: 200 })) as unknown as typeof fetch;
    await resendMailer("re_x", "f@x.test", fake).send({ ...MAIL, text: "token=tok_resend" });
    expect(linhas).toEqual([]);
  });

  it("a chave nunca aparece no resultado", async () => {
    const fake = (async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    const result = await resendMailer("re_muito_secreta", "f@x.test", fake).send(MAIL);
    expect(JSON.stringify(result)).not.toContain("re_muito_secreta");
  });
});
