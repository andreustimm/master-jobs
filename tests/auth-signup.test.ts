/**
 * Suíte: cadastro aberto de ponta a ponta no servidor (#464, US-004–US-006,
 * US-015–US-018, US-021).
 *
 * Invariante: conta e perfil nascem num commit só, ou não nascem; o código
 * vale uma vez, por 15 minutos, e trava em 5 erros; três contas por IP por
 * hora, contando só cadastro concluído; e-mail com conta nunca é revelado;
 * boas-vindas uma vez, só para quem se cadastrou.
 * Fronteira DENTRO: `app/signup.ts` com a loja de verdade
 * (`infra/drizzle-signups.ts`), PostgreSQL com as migrações (`useTestDb`), o
 * sink de e-mail em arquivo e, no IT-077, o login social contra o emissor falso.
 * Fronteira FORA: as Server Actions e o navegador (E2E `sign-up`).
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { count, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import {
  authEvent,
  authIdentity,
  authSession,
  authSignup,
  authUser,
  candidate,
  candidateDocument,
  recruiterGrant,
} from "../src/core/db/schema.ts";
import { clock } from "../src/core/clock.ts";
import { runDatabaseCleanup } from "../src/core/db/retention.ts";
import { readCvPdf } from "../src/core/pdf.ts";
import { en } from "../src/core/i18n/en.ts";
import { ptBR } from "../src/core/i18n/pt-BR.ts";
import {
  completeSocial,
  confirmCode,
  resendCode,
  signupScreen,
  startManual,
  verifyScreen,
  type SignupConfig,
  type SignupDeps,
} from "../src/contexts/auth/app/signup.ts";
import { beginSocial, finishSocial, type SocialConfig, type SocialDeps } from "../src/contexts/auth/app/oidc-login.ts";
import { addUser } from "../src/contexts/auth/app/accounts.ts";
import { loginWithPassword } from "../src/contexts/auth/app/session.ts";
import { showsRecruiterEmptyState } from "../src/contexts/auth/domain/landing.ts";
import { hashPassword } from "../src/contexts/auth/domain/password.ts";
import { can, candidateScope } from "../src/contexts/auth/domain/policy.ts";
import * as identities from "../src/contexts/auth/infra/drizzle-identities.ts";
import {
  completeSocialSignup,
  confirmManualSignup,
  createSocialSignup,
  findPending,
  generateSignupCode,
  newSignupToken,
  resendSignupCode,
  signupIpHmac,
  signupTokenHash,
  startManualSignup,
} from "../src/contexts/auth/infra/drizzle-signups.ts";
import { drizzleAuthRepository, drizzleSessions, magicLink } from "../src/contexts/auth/infra/drizzle-store.ts";
import { checkCallbackState, flowKey, openFlow, sealFlow } from "../src/contexts/auth/infra/flow-cookie.ts";
import { googleProvider } from "../src/contexts/auth/infra/oidc/google.ts";
import { drizzlePasswords, MAX_ATTEMPTS, recentFailures } from "../src/contexts/auth/infra/password-login.ts";
import { fileMailer } from "../src/contexts/auth/infra/resend-mailer.ts";
import type { Mailer } from "../src/contexts/auth/ports-mailer.ts";
import { createFakeOidc, FAKE_CLIENTS } from "./e2e/fake-oidc.mjs";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;
let sink: string;
let offsetMs = 0;
let lastCode = "";
let versions = { terms: "2026-10-06", privacy: "2026-10-06" };
let mailerOverride: Mailer | null = null;

const now = () => new Date(clock().now() + offsetMs);
const ORIGIN = "http://127.0.0.1:3000";
const IP = "203.0.113.10";
const SECRET = "segredo-do-ip-e-do-codigo";
const PASSWORD = "senha-forte-de-teste-42";
const CV =
  "Engenheira de dados com dez anos em plataformas analíticas, Spark, Kafka e observabilidade em nuvem pública.";

const config: SignupConfig = {
  manualAvailable: true,
  origin: ORIGIN,
  ipSecret: SECRET,
  maxPerIpHour: 3,
  legalVersions: () => versions,
};

function deps(): SignupDeps {
  return {
    store: {
      startManual: startManualSignup,
      resend: resendSignupCode,
      confirmManual: confirmManualSignup,
      completeSocial: completeSocialSignup,
      findPending,
    },
    tokens: { create: newSignupToken, hash: signupTokenHash },
    ipHmac: signupIpHmac,
    hashPassword,
    generateCode: () => {
      lastCode = generateSignupCode();
      return lastCode;
    },
    readPdf: readCvPdf,
    sessions: drizzleSessions,
    repository: drizzleAuthRepository,
    identityOfUser: identities.identityOfUser,
    mailer: () => mailerOverride ?? fileMailer(sink),
    afterCandidateCreated: async () => {},
    now,
  };
}

beforeEach(async () => {
  db = await useTestDb();
  sink = mkdtempSync(join(tmpdir(), "jho-signup-sink-"));
  offsetMs = 0;
  lastCode = "";
  versions = { terms: "2026-10-06", privacy: "2026-10-06" };
  mailerOverride = null;
});

afterEach(async () => {
  rmSync(sink, { recursive: true, force: true });
  await releaseTestDb();
});

type Mail = { to: string; subject: string; text: string };
const mails = (): Mail[] =>
  readdirSync(sink)
    .sort()
    .map((file) => JSON.parse(readFileSync(join(sink, file), "utf8")) as Mail);

async function countOf(table: typeof authUser | typeof candidate | typeof authSignup | typeof authIdentity | typeof recruiterGrant) {
  const [row] = await db.select({ n: count() }).from(table);
  return row?.n ?? 0;
}

async function events(kind: string) {
  return db.select().from(authEvent).where(eq(authEvent.kind, kind));
}

/** A pendência social que o retorno do provedor grava (task_02). */
async function socialPending(email: string, options: { provider?: "google" | "linkedin"; subject?: string } = {}) {
  const pending = await createSocialSignup({
    email,
    provider: options.provider ?? "google",
    subject: options.subject ?? `sub-${email}`,
    locale: "pt-BR",
    ipHmac: signupIpHmac(IP, SECRET),
    now: now(),
  });
  return pending.token;
}

function socialForm(token: string | null, overrides: Partial<Parameters<typeof completeSocial>[0]> = {}) {
  return {
    token,
    role: "candidate" as unknown,
    name: "Ana Souza",
    headline: "Engenheira de dados",
    cvPasted: CV,
    cvFile: null,
    termsAccepted: true,
    locale: "pt-BR" as const,
    clientIp: IP,
    ...overrides,
  };
}

function manualForm(email: string, overrides: Partial<Parameters<typeof startManual>[0]> = {}) {
  return {
    role: "candidate" as unknown,
    name: "Bruno Lima",
    headline: "Desenvolvedor backend",
    cvPasted: CV,
    cvFile: null,
    termsAccepted: true,
    email,
    password: PASSWORD,
    locale: "pt-BR" as const,
    clientIp: IP,
    ...overrides,
  };
}

/** Início manual que exige ter dado certo, e o código que foi para o e-mail. */
async function startedManual(email: string, overrides: Partial<Parameters<typeof startManual>[0]> = {}) {
  const result = await startManual(manualForm(email, overrides), config, deps());
  if (!result.ok || result.value.token === null) throw new Error(`início recusado: ${JSON.stringify(result)}`);
  return { token: result.value.token, code: lastCode };
}

async function socialSignedUp(email: string, ip = IP, overrides: Partial<Parameters<typeof completeSocial>[0]> = {}) {
  const token = await socialPending(email);
  return completeSocial(socialForm(token, { clientIp: ip, ...overrides }), config, deps());
}

/* --------------------------- Cadastro social ------------------------------ */

describe("conclusão do cadastro social (IT-020–IT-031)", () => {
  it("IT-020 pendência social + candidato: conta verificada, identidade, candidato com CV e sessão", async () => {
    const token = await socialPending("ana@exemplo.com", { subject: "google-ana" });
    const result = await completeSocial(socialForm(token), config, deps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.location).toBe("/");

    const users = await db.select().from(authUser);
    expect(users).toHaveLength(1);
    const user = users[0]!;
    expect(user.email).toBe("ana@exemplo.com");
    expect(user.roles).toEqual(["candidate"]);
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(user.signupOrigin).toBe("google");
    expect(user.passwordHash).toBeNull();
    expect(user.fullName).toBe("Ana Souza");

    const linked = await db.select().from(authIdentity);
    expect(linked).toEqual([
      expect.objectContaining({ userId: user.id, provider: "google", subject: "google-ana", emailAtLink: "ana@exemplo.com" }),
    ]);

    const [own] = await db.select().from(candidate).where(eq(candidate.id, user.candidateId!));
    expect(own).toMatchObject({ name: "Ana Souza", headline: "Engenheira de dados", visibility: "private", isDefault: false });
    const docs = await db.select().from(candidateDocument).where(eq(candidateDocument.candidateId, own!.id));
    expect(docs).toEqual([expect.objectContaining({ kind: "cv", content: CV, isCurrent: true })]);

    const session = await drizzleSessions.resolve(result.value.token);
    expect(session).toMatchObject({ userId: user.id, candidateId: own!.id, roles: ["candidate"] });
    expect(await countOf(authSignup)).toBe(1);
    const [pending] = await db.select().from(authSignup);
    // Concluída, sem o dado pessoal que só servia até a conta nascer.
    expect(pending).toMatchObject({ completedAt: expect.any(String), userId: user.id, cvText: null, role: "candidate" });
  });

  it("IT-021 a conta nova só alcança o próprio candidato", async () => {
    const [other] = await db.insert(candidate).values({ slug: "outra-pessoa", name: "Outra Pessoa" }).returning();
    const result = await socialSignedUp("ana@exemplo.com");
    if (!result.ok) throw new Error("cadastro recusado");
    const session = (await drizzleSessions.resolve(result.value.token))!;
    expect(candidateScope(session)).not.toBe(other!.id);
    expect(candidateScope(session)).toBe(session.candidateId);
    expect(can(session, "candidate:read", { kind: "candidate", candidateId: other!.id }).allowed).toBe(false);
    expect(can(session, "candidate:read", { kind: "candidate", candidateId: session.candidateId! }).allowed).toBe(true);
    expect(can(session, "user:manage").allowed).toBe(false);
  });

  it("IT-022 grava signup_completed com caminho e papel, e as versões aceitas na conta", async () => {
    const before = now().toISOString();
    await socialSignedUp("ana@exemplo.com");
    const [completed] = await events("signup_completed");
    expect(completed?.detail).toContain("google candidate");
    const [user] = await db.select().from(authUser);
    expect(user).toMatchObject({ termsVersion: "2026-10-06", privacyVersion: "2026-10-06" });
    expect(user!.termsAcceptedAt! >= before).toBe(true);
  });

  it("IT-023 uma boas-vindas no idioma escolhido na tela", async () => {
    await socialSignedUp("ana@exemplo.com", IP, { locale: "en" });
    const sent = mails();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "ana@exemplo.com", subject: en.email.welcomeSubject });
    expect(sent[0]!.text).toContain(`${ORIGIN}/login`);
    const [user] = await db.select().from(authUser);
    expect(user!.locale).toBe("en");
  });

  it("IT-024 pendência abandonada não cria conta, e a purga a apaga depois de 24 h", async () => {
    await socialPending("ana@exemplo.com");
    expect(await countOf(authUser)).toBe(0);
    await runDatabaseCleanup({ apply: true, now: new Date(now().getTime() + 25 * 3_600_000) });
    expect(await countOf(authSignup)).toBe(0);
  });

  it("IT-025 concluir a pendência social depois de 15 min: expirou, nada criado", async () => {
    const token = await socialPending("ana@exemplo.com");
    offsetMs = 15 * 60_000 + 1_000;
    expect(await completeSocial(socialForm(token), config, deps())).toEqual({ ok: false, error: "expired" });
    expect(await countOf(authUser)).toBe(0);
    expect(await countOf(candidate)).toBe(0);
  });

  it("IT-026 duas conclusões simultâneas: uma conta, uma boas-vindas, a segunda entra nela", async () => {
    const token = await socialPending("ana@exemplo.com");
    const [a, b] = await Promise.all([
      completeSocial(socialForm(token), config, deps()),
      completeSocial(socialForm(token), config, deps()),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(await countOf(authUser)).toBe(1);
    expect(await countOf(candidate)).toBe(1);
    expect(mails()).toHaveLength(1);
    const [user] = await db.select().from(authUser);
    if (a.ok && b.ok) {
      expect((await drizzleSessions.resolve(a.value.token))?.userId).toBe(user!.id);
      expect((await drizzleSessions.resolve(b.value.token))?.userId).toBe(user!.id);
    }
  });

  it("IT-027 conta criada para o e-mail entre o consentimento e o envio: email_taken, sem duplicar", async () => {
    const token = await socialPending("ana@exemplo.com");
    await db.insert(authUser).values({ email: "ana@exemplo.com", roles: ["recruiter"] });
    expect(await completeSocial(socialForm(token), config, deps())).toEqual({ ok: false, error: "email_taken" });
    expect(await countOf(authUser)).toBe(1);
    expect(await countOf(authIdentity)).toBe(0);
  });

  it("IT-028 papel admin forjado: role_invalid e nada criado; o banco também recusa", async () => {
    const token = await socialPending("ana@exemplo.com");
    expect(await completeSocial(socialForm(token, { role: "admin" }), config, deps())).toEqual({
      ok: false,
      error: "role_invalid",
    });
    expect(await countOf(authUser)).toBe(0);
    await expect(
      db.update(authSignup).set({ role: "admin" }).where(eq(authSignup.tokenHash, signupTokenHash(token!))),
    ).rejects.toThrow();
  });

  it("IT-029 PDF com problema recusa antes de qualquer pendência ou código", async () => {
    const notPdf = new File(["texto renomeado"], "cv.pdf", { type: "application/pdf" });
    const result = await startManual(manualForm("bruno@exemplo.com", { cvPasted: "", cvFile: notPdf }), config, deps());
    expect(result).toEqual({ ok: false, error: "pdf_not_pdf" });
    expect(await countOf(authSignup)).toBe(0);
    expect(await events("signup_code_sent")).toHaveLength(0);
    expect(mails()).toHaveLength(0);
  });

  it("IT-030 recrutador: papel recrutador, sem candidato e sem vínculo nenhum", async () => {
    const result = await socialSignedUp("rita@exemplo.com", IP, { role: "recruiter", headline: "", cvPasted: "" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.location).toBe("/recruiter");
    const [user] = await db.select().from(authUser);
    expect(user).toMatchObject({ roles: ["recruiter"], candidateId: null });
    expect(await countOf(candidate)).toBe(0);
    expect(await countOf(recruiterGrant)).toBe(0);
    const session = await drizzleSessions.resolve(result.value.token);
    expect(session?.linkedCandidateIds).toEqual([]);
    expect(mails()[0]!.text).toContain(ptBR.email.welcomeRecruiter);
  });

  it("IT-031 o recrutador não vira candidato sozinho: reenviar a pendência não muda o papel; só admin troca", async () => {
    const token = await socialPending("rita@exemplo.com");
    const first = await completeSocial(socialForm(token, { role: "recruiter" }), config, deps());
    const again = await completeSocial(socialForm(token, { role: "candidate" }), config, deps());
    expect(first.ok && again.ok).toBe(true);
    const [user] = await db.select().from(authUser);
    expect(user!.roles).toEqual(["recruiter"]);
    expect(await countOf(candidate)).toBe(0);
    const session = (await drizzleSessions.resolve(first.ok ? first.value.token : ""))!;
    expect(can(session, "user:manage").allowed).toBe(false);
  });
});

/* ------------------------------ Limite por IP ----------------------------- */

describe("limite por IP (IT-032–IT-035)", () => {
  it("IT-032 três cadastros do mesmo IP na hora: o quarto recusa e registra; outro IP passa", async () => {
    for (const name of ["a", "b", "c"]) expect((await socialSignedUp(`${name}@exemplo.com`)).ok).toBe(true);
    expect(await socialSignedUp("d@exemplo.com")).toEqual({ ok: false, error: "ip_cap" });
    expect(await events("signup_ip_capped")).toHaveLength(1);
    expect((await socialSignedUp("e@exemplo.com", "198.51.100.7")).ok).toBe(true);
    expect(await countOf(authUser)).toBe(4);
    // Nenhum IP cru gravado em lugar nenhum.
    const signups = await db.select({ ip: authSignup.ipHmac }).from(authSignup);
    expect(signups.every((row) => /^[0-9a-f]{64}$/.test(row.ip) && !row.ip.includes(IP))).toBe(true);
  });

  it("IT-032 o limite vale no código do cadastro manual também", async () => {
    for (const name of ["a", "b", "c"]) expect((await socialSignedUp(`${name}@exemplo.com`)).ok).toBe(true);
    const { token, code } = await startedManual("bruno@exemplo.com");
    expect(await confirmCode({ token, code, clientIp: IP }, config, deps())).toEqual({ ok: false, error: "ip_cap" });
    expect(await countOf(authUser)).toBe(3);
  });

  it("IT-033 duas conclusões simultâneas do mesmo IP com 2 usadas: exatamente uma passa", async () => {
    for (const name of ["a", "b"]) expect((await socialSignedUp(`${name}@exemplo.com`)).ok).toBe(true);
    const [x, y] = await Promise.all([socialPending("x@exemplo.com"), socialPending("y@exemplo.com")]);
    const results = await Promise.all([
      completeSocial(socialForm(x), config, deps()),
      completeSocial(socialForm(y), config, deps()),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: "ip_cap" }]);
    expect(await countOf(authUser)).toBe(3);
  });

  it("IT-034 contas criadas por admin e pendências não contam", async () => {
    await addUser({ email: "convidado1@exemplo.com", roles: ["recruiter"] });
    await addUser({ email: "convidado2@exemplo.com", roles: ["recruiter"] });
    for (const name of ["p1", "p2", "p3"]) await socialPending(`${name}@exemplo.com`);
    await startedManual("pendente@exemplo.com");
    for (const name of ["a", "b", "c"]) expect((await socialSignedUp(`${name}@exemplo.com`)).ok).toBe(true);
    expect(await socialSignedUp("d@exemplo.com")).toEqual({ ok: false, error: "ip_cap" });
  });

  it("IT-035 senha e link mágico com e-mail desconhecido não criam conta", async () => {
    const before = await countOf(authUser);
    const login = await loginWithPassword("ninguem@exemplo.com", PASSWORD, {
      sessions: drizzleSessions,
      identity: magicLink,
      passwords: drizzlePasswords,
      repository: drizzleAuthRepository,
    });
    expect(login.ok).toBe(false);
    const link = await magicLink.begin("ninguem@exemplo.com");
    expect(await magicLink.complete(link.token)).toBeNull();
    expect(await countOf(authUser)).toBe(before);
    expect(await countOf(authSignup)).toBe(0);
  });
});

/* --------------------------- Estado do recrutador -------------------------- */

describe("estado vazio do recrutador (IT-066)", () => {
  it("IT-066 com um vínculo, a tela de acompanhados deixa de ser o estado vazio", async () => {
    const result = await socialSignedUp("rita@exemplo.com", IP, { role: "recruiter" });
    if (!result.ok) throw new Error("cadastro recusado");
    const before = (await drizzleSessions.resolve(result.value.token))!;
    expect(showsRecruiterEmptyState(before)).toBe(true);

    const [granted] = await db.insert(candidate).values({ slug: "quem-concede", name: "Quem Concede" }).returning();
    // O acesso concedido pelo candidato (#465): uma concessão ativa.
    await db.insert(recruiterGrant).values({
      recruiterUserId: before.userId,
      recruiterEmail: "rita@exemplo.com",
      candidateId: granted!.id,
      status: "active",
    });
    const after = (await drizzleSessions.resolve(result.value.token))!;
    expect(after.linkedCandidateIds).toEqual([granted!.id]);
    expect(showsRecruiterEmptyState(after)).toBe(false);
  });
});

/* --------------------------- Cadastro manual ------------------------------ */

describe("cadastro manual e código (IT-070–IT-083)", () => {
  it("IT-070 início válido: pendência manual, código no sink, nenhuma conta", async () => {
    const { token, code } = await startedManual("bruno@exemplo.com");
    const [pending] = await db.select().from(authSignup);
    expect(pending).toMatchObject({ kind: "manual", email: "bruno@exemplo.com", role: "candidate", codeAttempts: 0 });
    expect(pending!.codeHash).not.toBeNull();
    expect(pending!.codeHash).not.toContain(code);
    expect(pending!.passwordHash?.startsWith("scrypt$")).toBe(true);
    expect(pending!.tokenHash).toBe(signupTokenHash(token));
    expect(await countOf(authUser)).toBe(0);
    const sent = mails();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "bruno@exemplo.com", subject: ptBR.email.codeSubject });
    expect(sent[0]!.text).toContain(code);
    expect(await verifyScreen(token, deps())).toMatchObject({ state: "active", email: "bruno@exemplo.com", resendInSeconds: 60 });
    expect(await signupScreen(token, deps())).toEqual({ mode: "manual", pendingCodeEmail: "bruno@exemplo.com", socialExpired: false });
  });

  it("IT-071 e-mail já cadastrado: mesma resposta; o sink tem o aviso de conta existente, sem código", async () => {
    await db.insert(authUser).values({ email: "bruno@exemplo.com", roles: ["candidate"] });
    const known = await startManual(manualForm("bruno@exemplo.com"), config, deps());
    const fresh = await startManual(manualForm("outra@exemplo.com"), config, deps());
    expect(known.ok && fresh.ok).toBe(true);
    if (known.ok && fresh.ok) {
      expect(Object.keys(known.value).sort()).toEqual(Object.keys(fresh.value).sort());
      expect(typeof known.value.token).toBe(typeof fresh.value.token);
      expect(await verifyScreen(known.value.token, deps())).toMatchObject({ state: "active", email: "bruno@exemplo.com" });
    }
    const notice = mails().find((mail) => mail.to === "bruno@exemplo.com")!;
    expect(notice.subject).toBe(ptBR.email.existsSubject);
    expect(notice.text).not.toMatch(/\b\d{6}\b/);
    expect(notice.text).toContain(`${ORIGIN}/login/forgot`);
    const [pending] = await db.select().from(authSignup).where(eq(authSignup.email, "bruno@exemplo.com"));
    expect(pending).toMatchObject({ codeHash: null, passwordHash: null, cvText: null, role: null });
  });

  it("IT-072 segundo início para o mesmo e-mail: código anterior para de valer, o novo vale, dados substituídos", async () => {
    const first = await startedManual("bruno@exemplo.com", { name: "Bruno Primeiro" });
    offsetMs = 61_000;
    const second = await startedManual("bruno@exemplo.com", { name: "Bruno Segundo" });
    expect(await countOf(authSignup)).toBe(1);
    // O token antigo também deixa de apontar para a pendência.
    expect(await confirmCode({ token: first.token, code: first.code, clientIp: IP }, config, deps())).toEqual({
      ok: false,
      error: "expired",
    });
    expect(await confirmCode({ token: second.token, code: first.code, clientIp: IP }, config, deps())).toMatchObject({
      ok: false,
      error: "wrong_code",
    });
    const confirmed = await confirmCode({ token: second.token, code: second.code, clientIp: IP }, config, deps());
    expect(confirmed.ok).toBe(true);
    const [user] = await db.select().from(authUser);
    expect(user!.fullName).toBe("Bruno Segundo");
  });

  it("IT-073 duplo envio: uma pendência e um e-mail", async () => {
    const [a, b] = await Promise.all([
      startManual(manualForm("bruno@exemplo.com"), config, deps()),
      startManual(manualForm("bruno@exemplo.com"), config, deps()),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(await countOf(authSignup)).toBe(1);
    expect(mails()).toHaveLength(1);
    // Só um dos dois emitiu cookie novo; o outro deixa o do primeiro valer.
    const tokens = [a, b].map((result) => (result.ok ? result.value.token : null)).filter((token) => token !== null);
    expect(tokens).toHaveLength(1);
  });

  it("IT-074 o sexto pedido de código na hora: too_many_codes e nenhum e-mail", async () => {
    for (let i = 0; i < 5; i += 1) {
      offsetMs = i * 61_000;
      await startedManual("bruno@exemplo.com");
    }
    expect(mails()).toHaveLength(5);
    offsetMs = 5 * 61_000;
    expect(await startManual(manualForm("bruno@exemplo.com"), config, deps())).toEqual({ ok: false, error: "too_many_codes" });
    expect(mails()).toHaveLength(5);
  });

  it("IT-076 código certo: conta verificada com senha e papel, candidato com CV, sessão e boas-vindas", async () => {
    const { token, code } = await startedManual("bruno@exemplo.com");
    const result = await confirmCode({ token, code: ` ${code.slice(0, 3)}-${code.slice(3)} `, clientIp: IP }, config, deps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.location).toBe("/");
    const [user] = await db.select().from(authUser);
    expect(user).toMatchObject({ email: "bruno@exemplo.com", roles: ["candidate"], signupOrigin: "manual" });
    expect(user!.emailVerifiedAt).not.toBeNull();
    expect(user!.passwordHash?.startsWith("scrypt$")).toBe(true);
    const docs = await db.select().from(candidateDocument).where(eq(candidateDocument.candidateId, user!.candidateId!));
    expect(docs).toEqual([expect.objectContaining({ content: CV, isCurrent: true })]);
    expect((await drizzleSessions.resolve(result.value.token))?.userId).toBe(user!.id);
    expect(mails().map((mail) => mail.subject)).toEqual([ptBR.email.codeSubject, ptBR.email.welcomeSubject]);
    expect(await events("signup_completed")).toEqual([expect.objectContaining({ detail: expect.stringContaining("manual candidate") })]);
  });

  it("IT-077 conta confirmada entra com a senha e é ligada sozinha pelo Google de mesmo e-mail verificado", async () => {
    const { token, code } = await startedManual("bruno@exemplo.com");
    expect((await confirmCode({ token, code, clientIp: IP }, config, deps())).ok).toBe(true);
    const password = await drizzlePasswords.verify("bruno@exemplo.com", PASSWORD);
    expect(password.ok).toBe(true);

    const fake = createFakeOidc();
    const key = flowKey("segredo-de-teste-com-mais-de-32-caracteres");
    const socialConfig: SocialConfig = {
      available: ["google"],
      origin: ORIGIN,
      provider: () =>
        googleProvider(
          { clientId: FAKE_CLIENTS.google.id, clientSecret: FAKE_CLIENTS.google.secret, issuer: fake.issuer("google"), issuerOverridden: true },
          { fetchImpl: fake.fetch, now },
        ),
      sealFlow: (flow) => sealFlow(flow, key),
      readFlow: (sealed, state) => {
        const check = checkCallbackState(openFlow(sealed, key, now()), state);
        return check.ok ? check.flow : null;
      },
      signupIpSecret: SECRET,
    };
    const socialDeps: SocialDeps = {
      sessions: drizzleSessions,
      repository: drizzleAuthRepository,
      identities,
      signups: { createSocialSignup, ipHmac: signupIpHmac },
      attempts: { recentFailures, max: MAX_ATTEMPTS },
      mailer: () => fileMailer(sink),
      now,
    };
    fake.setBehavior("google", { sub: "google-bruno", email: "bruno@exemplo.com", emailVerified: true });
    const start = await beginSocial({ provider: "google", intent: "signin", next: null, session: null }, socialConfig, socialDeps);
    if (start.kind !== "provider") throw new Error("início recusado");
    const authorize = await fake.handle(new Request(start.location));
    const outcome = await finishSocial(
      {
        provider: "google",
        callbackUrl: new URL(authorize.headers.get("location")!),
        sealedFlow: start.sealedFlow,
        session: null,
        clientIp: IP,
        locale: "pt-BR",
      },
      socialConfig,
      socialDeps,
    );
    expect(outcome.kind).toBe("session");
    const [user] = await db.select().from(authUser);
    expect(await db.select().from(authIdentity)).toEqual([
      expect.objectContaining({ userId: user!.id, provider: "google", origin: "automatic" }),
    ]);
  });

  it("IT-078 cinco códigos errados travam; o certo depois disso é code_locked", async () => {
    const { token, code } = await startedManual("bruno@exemplo.com");
    const wrong = code === "000000" ? "111111" : "000000";
    const results = [];
    for (let i = 0; i < 5; i += 1) results.push(await confirmCode({ token, code: wrong, clientIp: IP }, config, deps()));
    expect(results.slice(0, 4).map((result) => (result.ok ? null : result.attemptsLeft))).toEqual([4, 3, 2, 1]);
    expect(results[4]).toEqual({ ok: false, error: "code_locked" });
    expect(await confirmCode({ token, code, clientIp: IP }, config, deps())).toEqual({ ok: false, error: "code_locked" });
    expect(await countOf(authUser)).toBe(0);
    expect(await events("signup_code_failed")).toHaveLength(5);
  });

  it("IT-079 código certo depois de 15 min: expirou", async () => {
    const { token, code } = await startedManual("bruno@exemplo.com");
    offsetMs = 15 * 60_000 + 1_000;
    expect(await confirmCode({ token, code, clientIp: IP }, config, deps())).toEqual({ ok: false, error: "expired" });
    expect(await countOf(authUser)).toBe(0);
  });

  it("IT-080 duas confirmações certas simultâneas: uma conta", async () => {
    const { token, code } = await startedManual("bruno@exemplo.com");
    const results = await Promise.all([
      confirmCode({ token, code, clientIp: IP }, config, deps()),
      confirmCode({ token, code, clientIp: IP }, config, deps()),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await countOf(authUser)).toBe(1);
    expect(await countOf(candidate)).toBe(1);
    expect(mails().filter((mail) => mail.subject === ptBR.email.welcomeSubject)).toHaveLength(1);
  });

  it("IT-081 pendência com mais de 24 h: expirou, e a purga a apaga", async () => {
    const { token, code } = await startedManual("bruno@exemplo.com");
    offsetMs = 24 * 3_600_000 + 1_000;
    expect(await confirmCode({ token, code, clientIp: IP }, config, deps())).toEqual({ ok: false, error: "expired" });
    expect(await verifyScreen(token, deps())).toEqual({ state: "expired" });
    await runDatabaseCleanup({ apply: true, now: now() });
    expect(await countOf(authSignup)).toBe(0);
  });

  it("IT-082 o Google cria a conta do e-mail antes do código: a confirmação dá email_taken, sem duplicar", async () => {
    const { token, code } = await startedManual("bruno@exemplo.com");
    expect((await socialSignedUp("bruno@exemplo.com", "198.51.100.20")).ok).toBe(true);
    expect(await confirmCode({ token, code, clientIp: IP }, config, deps())).toEqual({ ok: false, error: "email_taken" });
    expect(await countOf(authUser)).toBe(1);
  });

  it("IT-083 reenvio antes de 60 s recusa com a espera; depois, código novo e o antigo para de valer", async () => {
    const { token, code: firstCode } = await startedManual("bruno@exemplo.com");
    offsetMs = 30_000;
    expect(await resendCode({ token }, config, deps())).toEqual({ ok: false, error: "resend_wait", retryInSeconds: 30 });
    expect(mails()).toHaveLength(1);
    offsetMs = 60_000;
    expect(await resendCode({ token }, config, deps())).toEqual({ ok: true, value: { email: "bruno@exemplo.com" } });
    const secondCode = lastCode;
    expect(mails()).toHaveLength(2);
    expect(mails()[1]!.text).toContain(secondCode);
    if (secondCode !== firstCode) {
      expect(await confirmCode({ token, code: firstCode, clientIp: IP }, config, deps())).toMatchObject({ error: "wrong_code" });
    }
    expect((await confirmCode({ token, code: secondCode, clientIp: IP }, config, deps())).ok).toBe(true);
  });
});

/* -------------------------------- E-mails --------------------------------- */

describe("boas-vindas (IT-084, IT-085)", () => {
  it("IT-084 conta criada por admin não recebe as boas-vindas do cadastro", async () => {
    await addUser({ email: "convidada@exemplo.com", roles: ["recruiter"] });
    expect(mails()).toHaveLength(0);
    expect(await events("signup_completed")).toHaveLength(0);
  });

  it("IT-085 falha de envio das boas-vindas: a conta existe e entra; a falha fica registrada", async () => {
    const token = await socialPending("ana@exemplo.com");
    mailerOverride = { name: "quebrado", send: async () => ({ ok: false, error: "resend respondeu 500" }) };
    const result = await completeSocial(socialForm(token), config, deps());
    expect(result.ok).toBe(true);
    expect(await countOf(authUser)).toBe(1);
    expect(await events("email_send_failed")).toEqual([expect.objectContaining({ detail: "welcome" })]);
    if (result.ok) expect(await drizzleSessions.resolve(result.value.token)).not.toBeNull();
  });
});

/* ------------------------------ Versões legais ---------------------------- */

describe("versões dos documentos (IT-094)", () => {
  it("IT-094 quem aceitou a v1 continua na v1; o cadastro seguinte grava a v2", async () => {
    await socialSignedUp("primeira@exemplo.com");
    versions = { terms: "2026-12-01", privacy: "2026-12-02" };
    await socialSignedUp("segunda@exemplo.com");
    const users = await db.select().from(authUser);
    const byEmail = new Map(users.map((user) => [user.email, user]));
    expect(byEmail.get("primeira@exemplo.com")).toMatchObject({ termsVersion: "2026-10-06", privacyVersion: "2026-10-06" });
    expect(byEmail.get("segunda@exemplo.com")).toMatchObject({ termsVersion: "2026-12-01", privacyVersion: "2026-12-02" });
  });
});

/* ------------------------------ Sessões e telas --------------------------- */

describe("telas do cadastro", () => {
  it("/signup sem cookie é o formulário manual; com pendência social, o modo social", async () => {
    expect(await signupScreen(null, deps())).toEqual({ mode: "manual", pendingCodeEmail: null, socialExpired: false });
    const token = await socialPending("ana@exemplo.com", { provider: "linkedin" });
    expect(await signupScreen(token, deps())).toEqual({ mode: "social", email: "ana@exemplo.com", provider: "linkedin" });
    offsetMs = 16 * 60_000;
    expect(await signupScreen(token, deps())).toEqual({ mode: "manual", pendingCodeEmail: null, socialExpired: true });
  });

  it("a sessão do cadastro é uma só por conclusão", async () => {
    await socialSignedUp("ana@exemplo.com");
    expect(await countOf(authUser)).toBe(1);
    const sessions = await db.select().from(authSession);
    expect(sessions).toHaveLength(1);
  });
});
