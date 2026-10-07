/**
 * Suíte: regras do cadastro aberto (#464, UT-060–UT-079).
 *
 * Invariante: admin nunca nasce do cadastro; o código é HMAC, vale 15 minutos e
 * trava em 5 erros; reenvio a cada 60 s e cinco por hora; o limite por IP conta
 * só cadastro concluído; e-mail com conta recebe o aviso no lugar do código,
 * com a mesma resposta na tela.
 * Fronteira DENTRO: `domain/signup-rules.ts` puro e `app/signup.ts` com a loja
 * substituída por um dublê em memória (UT-070, UT-071, UT-073).
 * Fronteira FORA: a transação no PostgreSQL (`auth-signup.test.ts`) e a tela
 * (E2E `sign-up`).
 */
import { describe, expect, it } from "vitest";
import { startManual, type SignupConfig, type SignupDeps } from "../src/contexts/auth/app/signup.ts";
import { mailDelivery, manualSignupAvailable } from "../src/contexts/auth/domain/oidc-config.ts";
import { verifyPassword } from "../src/contexts/auth/domain/password.ts";
import {
  CODE_MAX_ATTEMPTS,
  capReached,
  capSlotsUsed,
  chooseCvSource,
  codeExpired,
  decideCompletion,
  decideManualStart,
  hashCode,
  isExpired,
  normalizeCode,
  pdfErrorToSignup,
  pendingExpiresAt,
  requireTerms,
  resendWaitSeconds,
  tooManyCodes,
  validateEmail,
  validatePassword,
  validateRole,
  verifyCode,
  wrongAttempt,
} from "../src/contexts/auth/domain/signup-rules.ts";
import type { ManualStartInput } from "../src/contexts/auth/infra/drizzle-signups.ts";
import { generateSignupCode } from "../src/contexts/auth/infra/drizzle-signups.ts";
import { CV_PDF_MAX_BYTES, readCvPdf } from "../src/core/pdf.ts";
import { pdfComTexto } from "./support/synthetic-pdf.ts";

const T = new Date("2026-10-06T12:00:00.000Z");
const at = (ms: number) => new Date(T.getTime() + ms);
const KEY = "chave-do-codigo-de-teste";
const CV = "Arquiteto de software com quinze anos de experiência em plataformas de dados, nuvem e times distribuídos.".padEnd(120, ".");

describe("papel (UT-060, UT-063)", () => {
  it.each(["candidate", "recruiter"])("UT-060 %s é aceito", (role) => {
    expect(validateRole(role)).toEqual({ ok: true, value: role });
  });

  it.each(["admin", "", "Candidate ", "candidate ", "ADMIN", null, undefined, 1])(
    "UT-063 %j é papel inválido",
    (role) => {
      expect(validateRole(role)).toEqual({ ok: false, error: "role_invalid" });
    },
  );
});

describe("validade da pendência (UT-061)", () => {
  it("UT-061 manual vence em 24 h e social em 15 min", () => {
    expect(pendingExpiresAt("manual", T).toISOString()).toBe("2026-10-07T12:00:00.000Z");
    expect(pendingExpiresAt("social", T).toISOString()).toBe("2026-10-06T12:15:00.000Z");
  });

  it("UT-061 vencida 1 ms depois do limite, não no limite", () => {
    const expiresAt = pendingExpiresAt("social", T).toISOString();
    expect(isExpired(expiresAt, new Date(Date.parse(expiresAt)))).toBe(false);
    expect(isExpired(expiresAt, new Date(Date.parse(expiresAt) + 1))).toBe(true);
  });
});

describe("conclusão (UT-062, UT-068, UT-069)", () => {
  const pending = { expiresAt: at(15 * 60_000).toISOString(), completedAt: null, userId: null };

  it("UT-062 e-mail que ganhou conta no meio recusa com email_taken", () => {
    expect(
      decideCompletion({ pending, emailTaken: true, completedFromIpLastHour: 0, maxPerIpHour: 3, now: T }),
    ).toEqual({ ok: false, error: "email_taken" });
    expect(decideCompletion({ pending, emailTaken: false, completedFromIpLastHour: 0, maxPerIpHour: 3, now: T })).toEqual({
      kind: "create",
    });
  });

  it("UT-062 a conclusão repetida dentro da janela entra na mesma conta; fora dela, expirou", () => {
    const done = { ...pending, completedAt: T.toISOString(), userId: 7 };
    expect(decideCompletion({ pending: done, emailTaken: true, completedFromIpLastHour: 9, maxPerIpHour: 3, now: at(60_000) })).toEqual({
      kind: "already",
      userId: 7,
    });
    expect(
      decideCompletion({ pending: done, emailTaken: true, completedFromIpLastHour: 0, maxPerIpHour: 3, now: at(11 * 60_000) }),
    ).toEqual({ ok: false, error: "expired" });
  });

  it("UT-068 o limite fecha na terceira conta da hora, não na segunda", () => {
    expect(capReached(2, 3)).toBe(false);
    expect(capReached(3, 3)).toBe(true);
    expect(decideCompletion({ pending, emailTaken: false, completedFromIpLastHour: 3, maxPerIpHour: 3, now: T })).toEqual({
      ok: false,
      error: "ip_cap",
    });
  });

  it("UT-069 só cadastro concluído na última hora ocupa vaga; pendência e conta antiga não", () => {
    const rows = [
      { completedAt: null }, // pendência manual esperando o código
      { completedAt: null }, // pendência social abandonada
      { completedAt: at(-30 * 60_000).toISOString() },
      { completedAt: at(-61 * 60_000).toISOString() }, // fora da janela
    ];
    expect(capSlotsUsed(rows, T)).toBe(1);
    // Conta criada por admin não tem linha em `auth_signup`: não há o que contar.
    expect(capSlotsUsed([], T)).toBe(0);
  });
});

describe("currículo e aceite (UT-064–UT-067)", () => {
  function pdf(bytes: Uint8Array<ArrayBuffer> | string): File {
    return new File([bytes], "cv.pdf", { type: "application/pdf" });
  }

  it("UT-064 as recusas de readCvPdf viram as do cadastro", async () => {
    const huge = new Uint8Array(CV_PDF_MAX_BYTES + 1);
    huge.set(new TextEncoder().encode("%PDF-1.4"));
    const cases: Array<[File, string]> = [
      [pdf(huge), "pdf_too_large"],
      [pdf("texto renomeado para .pdf"), "pdf_not_pdf"],
      [pdf(pdfComTexto([["Maria"]])), "pdf_no_text"],
    ];
    for (const [file, expected] of cases) {
      const read = await readCvPdf(file);
      expect(read.ok).toBe(false);
      if (!read.ok) expect(pdfErrorToSignup(read.code)).toBe(expected);
    }
    expect(pdfErrorToSignup("pdfMissing")).toBe("pdf_missing");
  });

  it("UT-065 texto colado com 99 caracteres é curto; com 100, vale", () => {
    expect(chooseCvSource({ hasPdf: false, pasted: "x".repeat(99) })).toEqual({ ok: false, error: "cv_too_short" });
    expect(chooseCvSource({ hasPdf: false, pasted: "x".repeat(100) })).toEqual({
      ok: true,
      value: { kind: "text", text: "x".repeat(100) },
    });
  });

  it("UT-066 sem aceite dos termos, terms_required", () => {
    expect(requireTerms(false)).toEqual({ ok: false, error: "terms_required" });
    expect(requireTerms(true)).toEqual({ ok: true, value: true });
  });

  it("UT-067 PDF e texto juntos: escolha um", () => {
    expect(chooseCvSource({ hasPdf: true, pasted: CV })).toEqual({ ok: false, error: "cv_both" });
    expect(chooseCvSource({ hasPdf: true, pasted: "   " })).toEqual({ ok: true, value: { kind: "pdf" } });
    expect(chooseCvSource({ hasPdf: false, pasted: "" })).toEqual({ ok: false, error: "cv_required" });
  });
});

describe("e-mail e senha (UT-071, UT-072)", () => {
  it.each(["ana@", "ana", "@x.com", "ana@x", "ana @x.com", ""])("UT-071 %j é invalid_email", (email) => {
    expect(validateEmail(email)).toEqual({ ok: false, error: "invalid_email" });
  });

  it("UT-071 e-mail válido sai normalizado como o das contas", () => {
    expect(validateEmail("  Ana@X.com ")).toEqual({ ok: true, value: "ana@x.com" });
  });

  it("UT-072 senha de 11 caracteres é fraca; de 12, vale", () => {
    expect(validatePassword("a".repeat(11))).toEqual({ ok: false, error: "weak_password" });
    expect(validatePassword("a".repeat(12))).toEqual({ ok: true, value: "a".repeat(12) });
  });
});

describe("código (UT-074–UT-079)", () => {
  it("UT-074 cinco envios na hora fecham; quatro, não", () => {
    expect(tooManyCodes(5)).toBe(true);
    expect(tooManyCodes(4)).toBe(false);
    const base = { accountExists: false, lastSentAt: at(-10 * 60_000).toISOString(), now: T };
    expect(decideManualStart({ ...base, sentLastHour: 5 })).toBe("too_many");
    expect(decideManualStart({ ...base, sentLastHour: 4 })).toBe("code");
  });

  it("UT-074 duplo envio em menos de 60 s não manda outro e-mail; com conta, o aviso", () => {
    expect(decideManualStart({ accountExists: false, sentLastHour: 1, lastSentAt: at(-5_000).toISOString(), now: T })).toBe("duplicate");
    expect(decideManualStart({ accountExists: true, sentLastHour: 0, lastSentAt: null, now: T })).toBe("account_exists_notice");
  });

  it("UT-075 o código certo confere contra o HMAC; outro código ou outra chave, não", () => {
    const hash = hashCode("123456", KEY);
    expect(hash).not.toContain("123456");
    expect(verifyCode("123456", hash, KEY)).toBe(true);
    expect(verifyCode("123457", hash, KEY)).toBe(false);
    expect(verifyCode("123456", hash, "outra-chave")).toBe(false);
    expect(verifyCode("123456", null, KEY)).toBe(false);
    expect(verifyCode("123456", "nao-e-hex", KEY)).toBe(false);
  });

  it("UT-076 a quarta errada deixa 1 tentativa; a quinta trava o código", () => {
    expect(wrongAttempt(3)).toEqual({ attempts: 4, failure: { ok: false, error: "wrong_code", attemptsLeft: 1 } });
    expect(wrongAttempt(4)).toEqual({ attempts: CODE_MAX_ATTEMPTS, failure: { ok: false, error: "code_locked" } });
    expect(wrongAttempt(0).failure).toEqual({ ok: false, error: "wrong_code", attemptsLeft: 4 });
  });

  it("UT-077 enviado em T, o código vale até T+15 min e vence 1 s depois", () => {
    expect(codeExpired(T.toISOString(), at(15 * 60_000))).toBe(false);
    expect(codeExpired(T.toISOString(), at(15 * 60_000 + 1_000))).toBe(true);
  });

  it("UT-078 dígitos extraídos de espaço, traço e texto; menos de 6 é código errado", () => {
    expect(normalizeCode(" 123-456 ")).toBe("123456");
    expect(normalizeCode("Código: 123 456.")).toBe("123456");
    expect(normalizeCode("12345")).toBeNull();
    expect(normalizeCode("1234567")).toBeNull();
    expect(normalizeCode("")).toBeNull();
  });

  it("UT-079 reenvio em +59 s espera 1 s; em +60 s, vale", () => {
    expect(resendWaitSeconds(T.toISOString(), at(59_000))).toBe(1);
    expect(resendWaitSeconds(T.toISOString(), at(60_000))).toBe(0);
    expect(resendWaitSeconds(null, T)).toBe(0);
  });

  it("o código gerado tem sempre 6 dígitos", () => {
    for (let i = 0; i < 200; i += 1) expect(generateSignupCode()).toMatch(/^\d{6}$/);
  });
});

describe("cadastro manual por ambiente (ADR-011, requisito 5 da task_03)", () => {
  const SECRET_ENV = { JHO_SIGNUP_IP_SECRET: "segredo" };

  it.each([
    [{ ...SECRET_ENV, VERCEL: "1", VERCEL_ENV: "preview" }, "withheld", false],
    [{ ...SECRET_ENV, JHO_ENV: "preview" }, "withheld", false],
    [{ ...SECRET_ENV, VERCEL: "1", VERCEL_ENV: "production", RESEND_API_KEY: "re_x", RESEND_FROM: "contato@x.com" }, "resend", true],
    [{ ...SECRET_ENV, JHO_ENV: "local" }, "console", true],
    [{ ...SECRET_ENV, JHO_ENV: "e2e", JHO_MAIL_SINK: "/tmp/sink" }, "file", true],
    [{ ...SECRET_ENV, VERCEL: "1", VERCEL_ENV: "production", RESEND_API_KEY: "re_x" }, "withheld", false],
    [{ JHO_ENV: "local" }, "console", false],
  ])("%j: e-mail %s, manual disponível = %s", (env, delivery, available) => {
    expect(mailDelivery(env)).toBe(delivery);
    expect(manualSignupAvailable(env)).toBe(available);
  });
});

/* -------------------------- Serviço com loja dublê ------------------------- */

type Sent = { to: string; subject: string; text: string };

function harness(options: { registered?: string[] } = {}) {
  const registered = new Set(options.registered ?? []);
  const writes: ManualStartInput[] = [];
  const sent: Sent[] = [];
  let lastCode = "";
  const deps: SignupDeps = {
    store: {
      async startManual(input) {
        writes.push(input);
        const decision = decideManualStart({
          accountExists: registered.has(input.email),
          sentLastHour: 0,
          lastSentAt: null,
          now: input.now,
        });
        return { decision, tokenIssued: true };
      },
      resend: async () => ({ ok: false, error: "expired" }),
      confirmManual: async () => ({ ok: false, error: "expired" }),
      completeSocial: async () => ({ ok: false, error: "expired" }),
      findPending: async () => null,
    },
    tokens: { create: () => "token-de-teste", hash: (token) => `hash:${token}` },
    ipHmac: (ip) => `ip:${ip}`,
    hashPassword: async (password) => (await import("../src/contexts/auth/domain/password.ts")).hashPassword(password),
    generateCode: () => {
      lastCode = generateSignupCode();
      return lastCode;
    },
    readPdf: readCvPdf,
    sessions: {
      create: async () => "sessao",
      resolve: async () => null,
      revoke: async () => {},
      revokeAllFor: async () => 0,
      purgeExpired: async () => 0,
    },
    repository: { record: async () => {}, findUserId: async () => null },
    identityOfUser: async () => null,
    mailer: () => ({
      name: "memória",
      async send(mail) {
        sent.push(mail);
        return { ok: true, id: null };
      },
    }),
    afterCandidateCreated: async () => {},
    now: () => T,
  };
  const config: SignupConfig = {
    manualAvailable: true,
    origin: "http://127.0.0.1:3000",
    ipSecret: KEY,
    maxPerIpHour: 3,
    legalVersions: () => ({ terms: "2026-10-06", privacy: "2026-10-06" }),
  };
  return { deps, config, writes, sent, code: () => lastCode };
}

const FORM = {
  role: "candidate",
  name: "Ana Souza",
  headline: "Engenheira de dados",
  cvPasted: CV,
  cvFile: null,
  termsAccepted: true,
  email: "Ana@Exemplo.com",
  password: "senha-com-doze-ou-mais",
  locale: "pt-BR" as const,
  clientIp: "203.0.113.5",
};

describe("início manual no serviço (UT-070, UT-071, UT-073)", () => {
  it("UT-070 entrada válida grava senha em scrypt, código de 6 dígitos e só o HMAC dele", async () => {
    const h = harness();
    const result = await startManual(FORM, h.config, h.deps);
    expect(result).toEqual({ ok: true, value: { email: "ana@exemplo.com", token: "token-de-teste" } });
    const [write] = h.writes;
    expect(write?.email).toBe("ana@exemplo.com");
    expect(write?.passwordHash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword(FORM.password, write!.passwordHash)).toBe(true);
    expect(h.code()).toMatch(/^\d{6}$/);
    expect(write?.codeHash).not.toBe(h.code());
    expect(write?.codeHash).not.toContain(h.code());
    expect(verifyCode(h.code(), write!.codeHash, KEY)).toBe(true);
    expect(write?.tokenHash).toBe("hash:token-de-teste");
    expect(write?.ipHmac).toBe("ip:203.0.113.5");
    // O código sai no e-mail, e só nele.
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.text).toContain(h.code());
  });

  it("UT-071 e-mail inválido não grava nada nem manda e-mail", async () => {
    const h = harness();
    expect(await startManual({ ...FORM, email: "ana@" }, h.config, h.deps)).toEqual({ ok: false, error: "invalid_email" });
    expect(h.writes).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
  });

  it("UT-073 e-mail com conta: aviso sem código, e a resposta da tela é idêntica", async () => {
    const fresh = harness();
    const known = harness({ registered: ["ana@exemplo.com"] });
    const a = await startManual(FORM, fresh.config, fresh.deps);
    const b = await startManual(FORM, known.config, known.deps);
    expect(b).toEqual(a);
    expect(known.sent).toHaveLength(1);
    expect(known.sent[0]?.text).not.toContain(known.code());
    expect(known.sent[0]?.text).not.toMatch(/\b\d{6}\b/);
    expect(known.sent[0]?.text).toContain("http://127.0.0.1:3000/login/forgot");
  });

  it("sem e-mail que saia (Preview), o manual fica indisponível antes de qualquer gravação", async () => {
    const h = harness();
    const result = await startManual(FORM, { ...h.config, manualAvailable: false }, h.deps);
    expect(result).toEqual({ ok: false, error: "unavailable_here" });
    expect(h.writes).toHaveLength(0);
  });
});
