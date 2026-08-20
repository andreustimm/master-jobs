import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixedClock, resetClock, setClock } from "../src/core/clock.ts";
import type { DB } from "../src/core/db/client.ts";
import { authEvent, authLoginToken, authSession, authUser } from "../src/core/db/schema.ts";
import {
  redeemPasswordReset,
  requestPasswordReset,
  RESET_MAX_PER_HOUR,
  RESET_MINUTES,
  type ResetDeps,
} from "../src/contexts/auth/app/password-reset.ts";
import { hashPassword, verifyPassword } from "../src/contexts/auth/domain/password.ts";
import type { Mailer, OutgoingMail } from "../src/contexts/auth/ports-mailer.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * Recuperação de senha.
 *
 * O caminho que ninguém percorre até precisar dele, e por isso o que mais
 * merece teste. Três coisas são travadas aqui, e as três são de segurança:
 * a resposta não revela quem está cadastrado, o link vale uma vez só, e trocar
 * a senha derruba as sessões antigas.
 */

let db: DB;
let enviados: OutgoingMail[];
let tokensEmitidos: string[];

const SENHA_NOVA = "uma-senha-nova-bem-longa";

function fakeMailer(falha = false): Mailer {
  return {
    name: "fake",
    async send(mail) {
      enviados.push(mail);
      return falha ? { ok: false, error: "provedor fora do ar" } : { ok: true, id: "id-1" };
    },
  };
}

/** Hash previsível, para o teste poder resgatar o token que emitiu. */
const hashToken = (raw: string) => `hash:${raw}`;

function deps(over: Partial<ResetDeps> = {}): ResetDeps {
  return {
    mailer: fakeMailer(),
    audit: {
      record: async () => {},
      findUserId: async () => null,
    },
    sessions: {
      create: async () => "t",
      resolve: async () => null,
      revoke: async () => {},
      revokeAllFor: async (userId) => {
        await db.delete(authSession).where(eq(authSession.userId, userId));
        return 1;
      },
      purgeExpired: async () => 0,
    },
    linkFor: (token) => `https://exemplo.test/login/reset?token=${token}`,
    setPassword: async (email, password) => {
      const rows = await db
        .update(authUser)
        .set({ passwordHash: await hashPassword(password) })
        .where(eq(authUser.email, email))
        .returning({ id: authUser.id });
      return rows.length > 0;
    },
    issue: async (email, expiresAt) => {
      const raw = `token-${tokensEmitidos.length}`;
      tokensEmitidos.push(raw);
      await db
        .insert(authLoginToken)
        .values({ tokenHash: hashToken(raw), email, purpose: "reset", expiresAt });
      return raw;
    },
    ...over,
  };
}

async function seedUser(email: string, disabled = false): Promise<number> {
  const [row] = await db
    .insert(authUser)
    .values({
      email,
      roles: ["candidate"],
      passwordHash: await hashPassword("senha-antiga-que-sera-trocada"),
      disabledAt: disabled ? "2026-08-01T00:00:00.000Z" : null,
    })
    .returning({ id: authUser.id });
  return row!.id;
}

beforeEach(async () => {
  db = await useTestDb();
  enviados = [];
  tokensEmitidos = [];
  setClock(fixedClock("2026-08-20T12:00:00.000Z"));
});

afterEach(() => {
  resetClock();
  releaseTestDb();
});

describe("pedir recuperação não revela quem está cadastrado", () => {
  it("a resposta é IDÊNTICA para conta existente e inexistente", async () => {
    await seedUser("existe@local.test");

    const comConta = await requestPasswordReset("existe@local.test", deps());
    const semConta = await requestPasswordReset("nao-existe@local.test", deps());

    // Um formulário que responde "não encontramos esta conta" é um oráculo de
    // enumeração aberto ao mundo: dá para descobrir quem está cadastrado sem
    // nunca entrar.
    expect(comConta).toEqual(semConta);
    expect(comConta).toEqual({ sent: true });
  });

  it("mas só manda e-mail para quem existe", async () => {
    await seedUser("existe@local.test");
    await requestPasswordReset("existe@local.test", deps());
    expect(enviados).toHaveLength(1);

    enviados = [];
    await requestPasswordReset("nao-existe@local.test", deps());
    // Mandar para o desconhecido seria pior que revelar: usaria o nosso
    // remetente para entregar mensagem a quem não pediu.
    expect(enviados).toHaveLength(0);
  });

  it("conta desabilitada não recupera, e também em silêncio", async () => {
    await seedUser("bloqueada@local.test", true);
    // Recuperar devolveria acesso a quem o sistema já decidiu que não entra.
    expect(await requestPasswordReset("bloqueada@local.test", deps())).toEqual({ sent: true });
    expect(enviados).toHaveLength(0);
  });

  it("normaliza o endereço antes de procurar", async () => {
    await seedUser("pessoa@local.test");
    await requestPasswordReset("  Pessoa@Local.Test  ", deps());
    expect(enviados[0]?.to).toBe("pessoa@local.test");
  });
});

describe("limite por endereço", () => {
  it("para de enviar depois do teto e não conta como erro", async () => {
    await seedUser("alvo@local.test");

    for (let i = 0; i < RESET_MAX_PER_HOUR + 3; i++) {
      expect(await requestPasswordReset("alvo@local.test", deps())).toEqual({ sent: true });
    }

    // Sem o limite, o formulário vira um botão de mandar e-mail para qualquer
    // pessoa quantas vezes se quiser — spam com o nosso remetente. E a resposta
    // não muda, senão o limite viraria o oráculo que o resto evita.
    expect(enviados).toHaveLength(RESET_MAX_PER_HOUR);
  });
});

describe("o e-mail", () => {
  it("carrega o link e diz por quanto tempo vale", async () => {
    await seedUser("pessoa@local.test");
    await requestPasswordReset("pessoa@local.test", deps());

    const mail = enviados[0]!;
    expect(mail.text).toContain("https://exemplo.test/login/reset?token=token-0");
    expect(mail.text).toContain(String(RESET_MINUTES));
    // "Se não foi você, ignore" importa: quem recebe sem ter pedido precisa
    // saber que ignorar basta.
    expect(mail.text).toMatch(/não foi você/i);
  });

  it("falha de envio não vira exceção para quem pediu", async () => {
    await seedUser("pessoa@local.test");
    // O provedor fora do ar não pode virar 500 na tela: além de inútil para
    // quem lê, distinguiria conta existente de inexistente pelo tipo do erro.
    expect(
      await requestPasswordReset("pessoa@local.test", deps({ mailer: fakeMailer(true) })),
    ).toEqual({ sent: true });
  });
});

describe("resgatar o link", () => {
  async function pedir(email = "pessoa@local.test") {
    const id = await seedUser(email);
    await requestPasswordReset(email, deps());
    return { id, token: tokensEmitidos[0]! };
  }

  it("troca a senha e derruba TODAS as sessões", async () => {
    const { id, token } = await pedir();
    await db.insert(authSession).values({
      tokenHash: "sessao-antiga",
      userId: id,
      expiresAt: "2026-09-20T12:00:00.000Z",
    });

    expect(await redeemPasswordReset(token, SENHA_NOVA, hashToken, deps())).toEqual({
      ok: true,
      email: "pessoa@local.test",
    });

    const [user] = await db.select().from(authUser).where(eq(authUser.id, id));
    expect(await verifyPassword(SENHA_NOVA, user!.passwordHash)).toBe(true);
    expect(await verifyPassword("senha-antiga-que-sera-trocada", user!.passwordHash)).toBe(false);

    // Quem recupera a senha costuma fazê-lo por suspeitar de acesso indevido.
    // Manter as sessões antigas devolveria o acesso a quem já estava dentro.
    expect(await db.select().from(authSession).where(eq(authSession.userId, id))).toHaveLength(0);
  });

  it("o link serve UMA vez", async () => {
    const { token } = await pedir();
    expect((await redeemPasswordReset(token, SENHA_NOVA, hashToken, deps())).ok).toBe(true);

    // Um link de recuperação é credencial completa: quem o tem troca a senha.
    // Reutilizável, ele viraria uma senha permanente no histórico do e-mail.
    expect(await redeemPasswordReset(token, "outra-senha-qualquer", hashToken, deps())).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("token expirado não serve", async () => {
    const { token } = await pedir();
    setClock(fixedClock("2026-08-20T13:01:00.000Z"));
    expect(await redeemPasswordReset(token, SENHA_NOVA, hashToken, deps())).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("token inexistente, expirado e usado dão a MESMA resposta", async () => {
    // Cada distinção é uma pista para quem está adivinhando token.
    const { token } = await pedir();
    await redeemPasswordReset(token, SENHA_NOVA, hashToken, deps());

    const usado = await redeemPasswordReset(token, SENHA_NOVA, hashToken, deps());
    const inexistente = await redeemPasswordReset("nunca-existiu", SENHA_NOVA, hashToken, deps());
    expect(usado).toEqual(inexistente);
  });

  it("senha fraca é recusada ANTES de queimar o token", async () => {
    const { token } = await pedir();
    expect(await redeemPasswordReset(token, "curta", hashToken, deps())).toEqual({
      ok: false,
      reason: "weak",
    });

    // Queimar o token numa senha fraca obrigaria a pedir outro link por causa
    // de um erro de digitação.
    expect((await redeemPasswordReset(token, SENHA_NOVA, hashToken, deps())).ok).toBe(true);
  });

  it("token de LOGIN não serve para trocar senha", async () => {
    await seedUser("pessoa@local.test");
    await db.insert(authLoginToken).values({
      tokenHash: hashToken("token-de-login"),
      email: "pessoa@local.test",
      purpose: "login",
      expiresAt: "2026-08-20T13:00:00.000Z",
    });

    // Sem o `purpose` gravado, um link de entrar viraria um link de trocar a
    // senha de quem só pediu para entrar.
    expect(await redeemPasswordReset("token-de-login", SENHA_NOVA, hashToken, deps())).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("registra a conclusão para o operador auditar", async () => {
    const { token } = await pedir();
    const eventos: string[] = [];
    await redeemPasswordReset(token, SENHA_NOVA, hashToken, deps({
      audit: {
        record: async (e) => {
          eventos.push(e.kind);
        },
        findUserId: async () => null,
      },
    }));
    expect(eventos).toContain("reset_completed");
    void authEvent;
  });
});
