/**
 * Suíte: decisão de identidade do login social (#464, ADR-001).
 *
 * Invariante: a identidade `(provider, subject)` decide sozinha quando ligada;
 * só e-mail verificado liga sozinho; recusa e "não verificado" não revelam se
 * existe conta.
 * Fronteira DENTRO: `resolveIdentity`, `decideManualLink` e `normalizeEmail`,
 * puros.
 * Fronteira FORA: banco e provedor — cobertos por `auth-oidc-login.test.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  decideManualLink,
  normalizeEmail,
  resolveIdentity,
  type ResolvableIdentity,
} from "../src/contexts/auth/domain/identity-resolution.ts";

const google = (over: Partial<ResolvableIdentity> = {}): ResolvableIdentity => ({
  provider: "google",
  subject: "g-1",
  email: "ana@x.com",
  emailVerified: true,
  ...over,
});

const linkedin = (over: Partial<ResolvableIdentity> = {}): ResolvableIdentity => ({
  ...google({ provider: "linkedin", subject: "li-1" }),
  ...over,
});

describe("resolveIdentity", () => {
  it("UT-020 identidade ligada a conta habilitada entra", () => {
    expect(
      resolveIdentity({ identity: google(), linkedUser: { id: 7, disabled: false }, emailUser: null }),
    ).toEqual({ kind: "signin", userId: 7 });
  });

  it("UT-021 identidade ligada entra mesmo com e-mail não verificado (o e-mail nem é olhado)", () => {
    expect(
      resolveIdentity({
        identity: google({ emailVerified: false, email: null }),
        linkedUser: { id: 7, disabled: false },
        emailUser: null,
      }),
    ).toEqual({ kind: "signin", userId: 7 });
  });

  it("UT-022 e-mail do provedor diferente do da conta ainda entra pela identidade", () => {
    expect(
      resolveIdentity({
        identity: google({ email: "ana.nova@outro.com" }),
        linkedUser: { id: 7, disabled: false },
        // Mesmo havendo outra conta com o e-mail novo, a identidade decide.
        emailUser: { id: 99, disabled: false, hasProvider: false },
      }),
    ).toEqual({ kind: "signin", userId: 7 });
  });

  it.each([
    ["ligada", { linkedUser: { id: 7, disabled: true }, emailUser: null }],
    ["pelo e-mail", { linkedUser: null, emailUser: { id: 7, disabled: true, hasProvider: false } }],
    // Desabilitada vence o conflito: a recusa não conta que há vínculo.
    ["pelo e-mail e com o provedor", { linkedUser: null, emailUser: { id: 7, disabled: true, hasProvider: true } }],
  ])("UT-023 conta desabilitada %s é recusada de forma neutra", (_label, users) => {
    expect(resolveIdentity({ identity: google(), ...users })).toEqual({ kind: "refused" });
  });

  it("UT-024 sem vínculo, e-mail verificado igual ao de conta habilitada sem o provedor: liga sozinho", () => {
    expect(
      resolveIdentity({
        identity: google(),
        linkedUser: null,
        emailUser: { id: 3, disabled: false, hasProvider: false },
      }),
    ).toEqual({ kind: "auto_link", userId: 3 });
  });

  it("UT-025 normalização de e-mail: espaço nas pontas e maiúsculas", () => {
    expect(normalizeEmail(" Ana@X.com ")).toBe(normalizeEmail("ana@x.com"));
    expect(normalizeEmail(" Ana@X.com ")).toBe("ana@x.com");
    // A decisão de cadastro devolve o e-mail já normalizado.
    expect(
      resolveIdentity({ identity: google({ email: " Ana@X.com " }), linkedUser: null, emailUser: null }),
    ).toEqual({ kind: "signup", email: "ana@x.com" });
  });

  it("UT-026 conta do e-mail já com OUTRA identidade do provedor: conflito, nada muda", () => {
    expect(
      resolveIdentity({
        identity: google({ subject: "g-B" }),
        linkedUser: null,
        emailUser: { id: 3, disabled: false, hasProvider: true },
      }),
    ).toEqual({ kind: "conflict", provider: "google" });
  });

  it("UT-027 identidade desconhecida com e-mail não verificado: orientação, nomeando o provedor", () => {
    expect(
      resolveIdentity({ identity: linkedin({ emailVerified: false }), linkedUser: null, emailUser: null }),
    ).toEqual({ kind: "unverified", provider: "linkedin" });
  });

  it.each([
    ["Google", google({ email: null, emailVerified: true })],
    ["LinkedIn", linkedin({ email: null, emailVerified: false })],
    ["e-mail em branco", google({ email: "   ", emailVerified: true })],
  ])("UT-028 sem e-mail (%s) conta como não verificado", (_label, identity) => {
    expect(resolveIdentity({ identity, linkedUser: null, emailUser: null })).toEqual({
      kind: "unverified",
      provider: identity.provider,
    });
  });

  it("UT-029 'não verificado' é idêntico com e sem conta para o e-mail", () => {
    const identity = linkedin({ emailVerified: false });
    const withAccount = resolveIdentity({
      identity,
      linkedUser: null,
      emailUser: { id: 3, disabled: false, hasProvider: false },
    });
    const withoutAccount = resolveIdentity({ identity, linkedUser: null, emailUser: null });
    const disabledAccount = resolveIdentity({
      identity,
      linkedUser: null,
      emailUser: { id: 3, disabled: true, hasProvider: true },
    });
    expect(withAccount).toEqual(withoutAccount);
    expect(disabledAccount).toEqual(withoutAccount);
  });
});

describe("decideManualLink", () => {
  const session = { id: 5, impersonated: false };

  it("UT-036 ligar pela conta aceita identidade sem e-mail verificado", () => {
    // O e-mail nem entra na decisão: quem prova a posse é a sessão.
    expect(decideManualLink({ sessionUser: session, linkedUserId: null, sessionHasProvider: false })).toEqual({
      kind: "link",
      userId: 5,
    });
  });

  it("UT-037 identidade já ligada a outra conta: tomada, nada muda", () => {
    expect(decideManualLink({ sessionUser: session, linkedUserId: 9, sessionHasProvider: false })).toEqual({
      kind: "taken",
    });
  });

  it("UT-037 identidade já desta conta, ou conta já com o provedor: já ligado", () => {
    expect(decideManualLink({ sessionUser: session, linkedUserId: 5, sessionHasProvider: true })).toEqual({
      kind: "already_linked",
    });
    expect(decideManualLink({ sessionUser: session, linkedUserId: null, sessionHasProvider: true })).toEqual({
      kind: "already_linked",
    });
  });

  it("UT-038 sem sessão, ou com sessão emprestada, exige sessão própria", () => {
    expect(decideManualLink({ sessionUser: null, linkedUserId: null, sessionHasProvider: false })).toEqual({
      kind: "session_required",
    });
    expect(
      decideManualLink({ sessionUser: { id: 5, impersonated: true }, linkedUserId: null, sessionHasProvider: false }),
    ).toEqual({ kind: "session_required" });
  });
});
