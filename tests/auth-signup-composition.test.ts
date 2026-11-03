/**
 * Suíte: a composição pública do cadastro em `src/contexts/auth/index.ts` (#464).
 *
 * Invariante: o que as Server Actions chamam lê o ambiente a cada chamada e
 * fecha por omissão — sem e-mail que saia ou sem a chave do IP, o cadastro
 * manual fica indisponível antes de gravar qualquer coisa; com tudo
 * configurado, o caminho inteiro (pendência, código no sink, conta, fila de
 * score) roda pelas funções públicas.
 * Fronteira DENTRO: `index.ts` com a loja de verdade e o PostgreSQL de teste.
 * Fronteira FORA: as regras e o serviço isolados (`auth-signup-rules.test.ts`,
 * `auth-signup.test.ts`) e o navegador (E2E `sign-up`).
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  beginManualSignup,
  confirmManualSignupCode,
  finishSocialSignup,
  manualSignupOpen,
  resendManualSignupCode,
  signupScreenFor,
  verifyScreenFor,
} from "../src/contexts/auth/index.ts";
import { authUser, scoreTask } from "../src/core/db/schema.ts";
import { currentLegalVersions } from "../src/core/legal.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

const REQUEST = { host: "127.0.0.1:3000", proto: "http" as const };
const CV =
  "Engenheira de plataforma com oito anos em Kubernetes, observabilidade, filas e bancos de dados distribuídos.";

function form(overrides: Record<string, unknown> = {}) {
  return {
    role: "candidate" as unknown,
    name: "Clara Nunes",
    headline: "Engenheira de plataforma",
    cvPasted: CV,
    cvFile: null,
    termsAccepted: true,
    email: "clara@exemplo.com",
    password: "senha-de-doze-ou-mais",
    locale: "pt-BR" as const,
    clientIp: "203.0.113.77",
    ...overrides,
  };
}

describe("composição sem banco: fecha por omissão", () => {
  const preview = { VERCEL: "1", VERCEL_ENV: "preview", JHO_SIGNUP_IP_SECRET: "segredo" };
  const local = { JHO_ENV: "local", JHO_SIGNUP_IP_SECRET: "segredo" };

  it("Preview não oferece o cadastro manual, e o início recusa antes de validar", async () => {
    expect(manualSignupOpen(preview)).toBe(false);
    expect(await beginManualSignup(form(), REQUEST, preview)).toEqual({ ok: false, error: "unavailable_here" });
  });

  it("sem a chave do IP, nem manual nem social", async () => {
    const noSecret = { JHO_ENV: "local" };
    expect(manualSignupOpen(noSecret)).toBe(false);
    expect(await finishSocialSignup({ ...form(), token: "qualquer" }, REQUEST, noSecret)).toEqual({
      ok: false,
      error: "unavailable_here",
    });
  });

  it("local, sem cookie: telas no estado inicial e ações dizem que expirou", async () => {
    expect(manualSignupOpen(local)).toBe(true);
    expect(await signupScreenFor(null)).toEqual({ mode: "manual", pendingCodeEmail: null, socialExpired: false });
    expect(await verifyScreenFor(null)).toEqual({ state: "expired" });
    expect(await resendManualSignupCode(null, REQUEST, local)).toEqual({ ok: false, error: "expired" });
    expect(await confirmManualSignupCode({ token: null, code: "123456", clientIp: "203.0.113.77" }, REQUEST, local)).toEqual({
      ok: false,
      error: "expired",
    });
    expect(await finishSocialSignup({ ...form(), token: null }, REQUEST, local)).toEqual({ ok: false, error: "expired" });
  });

  it("o PDF é lido pelo extrator carregado sob demanda, antes do e-mail ser conferido", async () => {
    const notPdf = new File(["texto renomeado"], "cv.pdf", { type: "application/pdf" });
    expect(await beginManualSignup(form({ cvPasted: "", cvFile: notPdf, email: "invalido" }), REQUEST, local)).toEqual({
      ok: false,
      error: "pdf_not_pdf",
    });
  });
});

describe("composição com banco: o caminho manual inteiro pelas funções públicas", () => {
  let sink: string;

  beforeEach(async () => {
    await useTestDb();
    sink = mkdtempSync(join(tmpdir(), "jho-signup-composition-"));
  });

  afterEach(async () => {
    rmSync(sink, { recursive: true, force: true });
    await releaseTestDb();
  });

  it("pendência, código pelo sink, conta com as versões vigentes e currículo na fila de score", async () => {
    const env = { JHO_ENV: "e2e", JHO_MAIL_SINK: sink, JHO_SIGNUP_IP_SECRET: "segredo", JHO_PUBLIC_URL: "http://127.0.0.1:3000" };
    const started = await beginManualSignup(form(), REQUEST, env);
    if (!started.ok || started.value.token === null) throw new Error(`início recusado: ${JSON.stringify(started)}`);
    const token = started.value.token;
    expect(await signupScreenFor(token)).toEqual({ mode: "manual", pendingCodeEmail: "clara@exemplo.com", socialExpired: false });
    expect(await verifyScreenFor(token)).toMatchObject({ state: "active", email: "clara@exemplo.com" });
    expect(await resendManualSignupCode(token, REQUEST, env)).toMatchObject({ ok: false, error: "resend_wait" });

    const [mail] = readdirSync(sink).map((file) => JSON.parse(readFileSync(join(sink, file), "utf8")) as { text: string });
    const code = /\b(\d{6})\b/.exec(mail!.text)![1]!;
    const confirmed = await confirmManualSignupCode({ token, code, clientIp: "203.0.113.77" }, REQUEST, env);
    expect(confirmed).toMatchObject({ ok: true, value: { location: "/" } });

    const db = (await import("../src/core/db/client.ts")).getDb();
    const [user] = await db.select().from(authUser);
    const versions = currentLegalVersions();
    expect(user).toMatchObject({ termsVersion: versions.terms, privacyVersion: versions.privacy, signupOrigin: "manual" });
    const queued = await db.select().from(scoreTask);
    expect(queued.some((row) => row.candidateId === user!.candidateId)).toBe(true);
  });
});
