/**
 * Suíte: e-mails do acesso de recrutador (#465, `_tests.md` UT-043 – UT-049).
 *
 * Fronteira DENTRO: os construtores puros de `app/recruiter-emails.ts` e as
 * chaves `email.recruiter*` dos dois dicionários.
 * Fronteira FORA: o envio — nenhum caso chama um `Mailer`.
 */
import { describe, expect, it } from "vitest";
import {
  accessEndedEmail,
  accessGrantedEmail,
  endDateChangedEmail,
  inviteEmail,
  suggestionsDigestEmail,
  type AccessEndCause,
} from "../src/contexts/auth/app/recruiter-emails.ts";

const url = "https://jobs.mastertimm.com.br/signup/invite?token=abc123";
const recruiterUrl = "https://jobs.mastertimm.com.br/recruiter/7";

describe("convite", () => {
  it("UT-043 nomeia o candidato, o escopo, a validade, o mesmo e-mail e o link — no idioma pedido", () => {
    const pt = inviteEmail({ locale: "pt-BR", candidateName: "Ana", url, validUntil: "2026-10-13T12:00:00Z" });
    expect(pt.subject).toContain("Ana");
    expect(pt.text).toContain("Ana");
    expect(pt.text).toContain("funil de Ana (só leitura)");
    expect(pt.text).toContain("13 de outubro de 2026");
    expect(pt.text).toContain("este mesmo e-mail");
    expect(pt.text).toContain(url);
    expect(pt.text).not.toContain("conta de recrutador.");

    const en = inviteEmail({ locale: "en", candidateName: "Ana", url, validUntil: "2026-10-13T12:00:00Z" });
    expect(en.text).toContain("Ana's funnel (read-only)");
    expect(en.text).toContain("October 13, 2026");
    expect(en.text).toContain("this same email address");
    expect(en.text).toContain(url);
    expect(en.text).not.toContain("funil");
  });

  it("UT-044 needsRecruiterAccount acrescenta que é preciso conta de recrutador", () => {
    const mail = inviteEmail({
      locale: "pt-BR",
      candidateName: "Ana",
      url,
      validUntil: "2026-10-13T12:00:00Z",
      needsRecruiterAccount: true,
    });
    expect(mail.text).toContain("O acesso exige uma conta de recrutador.");
    expect(
      inviteEmail({ locale: "en", candidateName: "Ana", url, validUntil: "2026-10-13T12:00:00Z", needsRecruiterAccount: true })
        .text,
    ).toContain("Access requires a recruiter account.");
  });
});

describe("acesso concedido e prazo", () => {
  it("UT-045 nomeia o candidato, o fim (ou 'No end date') e o link da página dele", () => {
    const open = accessGrantedEmail({ locale: "en", candidateName: "Ana", url: recruiterUrl, expiresAt: null, expiryTz: null });
    expect(open.subject).toContain("Ana");
    expect(open.text).toContain("No end date");
    expect(open.text).toContain("/recruiter/7");

    const ending = accessGrantedEmail({
      locale: "pt-BR",
      candidateName: "Ana",
      url: recruiterUrl,
      expiresAt: "2026-10-21T02:59:59.999Z",
      expiryTz: "America/Sao_Paulo",
    });
    expect(ending.text).toContain("20 de outubro de 2026");
    expect(ending.text).toContain("23:59");
    expect(ending.text).toContain("(America/Sao_Paulo)");
    expect(ending.text).toContain("/recruiter/7");
  });

  it("UT-046 prazo mudado mostra o novo fim; sem fim diz que não termina mais", () => {
    const moved = endDateChangedEmail({
      locale: "en",
      candidateName: "Ana",
      url: recruiterUrl,
      expiresAt: "2026-10-20T23:59:59.999Z",
      expiryTz: "UTC",
    });
    expect(moved.text).toContain("October 20, 2026");
    expect(moved.text).toContain("(UTC)");

    const cleared = endDateChangedEmail({ locale: "en", candidateName: "Ana", url: recruiterUrl, expiresAt: null, expiryTz: null });
    expect(cleared.text).toContain("no longer ends");
    expect(
      endDateChangedEmail({ locale: "pt-BR", candidateName: "Ana", url: recruiterUrl, expiresAt: null, expiryTz: null }).text,
    ).toContain("não termina mais");
  });

  it("data ilegível sai como veio, sem estourar", () => {
    expect(inviteEmail({ locale: "en", candidateName: "Ana", url, validUntil: "lixo" }).text).toContain("until lixo (UTC)");
    expect(
      accessGrantedEmail({ locale: "en", candidateName: "Ana", url: recruiterUrl, expiresAt: "lixo", expiryTz: null }).text,
    ).toContain("ends on lixo (UTC)");
  });

  it("fuso inválido no fim cai para UTC sem estourar", () => {
    const mail = accessGrantedEmail({
      locale: "en",
      candidateName: "Ana",
      url: recruiterUrl,
      expiresAt: "2026-10-20T23:59:59.999Z",
      expiryTz: "Mars/Base",
    });
    expect(mail.text).toContain("(UTC)");
  });
});

describe("acesso encerrado", () => {
  it.each([
    ["candidate", "Ana ended your access to their profile on Master Jobs."],
    ["admin", "service administration"],
    ["expired", "access period"],
  ] as [AccessEndCause, string][])("UT-047 causa %s", (cause, sentence) => {
    const mail = accessEndedEmail({ locale: "en", candidateName: "Ana", cause });
    expect(mail.text).toContain(sentence);
    // A revogação do candidato não carrega motivo, e o e-mail não inventa um.
    if (cause === "candidate") expect(mail.text).not.toMatch(/because|reason/i);
  });

  it("UT-047 em português", () => {
    expect(accessEndedEmail({ locale: "pt-BR", candidateName: "Ana", cause: "admin" }).text).toContain(
      "administração do serviço",
    );
    expect(accessEndedEmail({ locale: "pt-BR", candidateName: "Ana", cause: "expired" }).text).toContain(
      "período de acesso",
    );
  });
});

describe("sugestões agrupadas", () => {
  it("UT-048 nomeia o recrutador, as três vagas com empresa e um link; nota não entra", () => {
    const items = [
      { title: "Staff Engineer", company: "Acme", note: "nota secreta 1" },
      { title: "AI Architect", company: "Globex", note: "nota secreta 2" },
      { title: "Tech Lead", company: "Initech", note: "nota secreta 3" },
    ];
    const mail = suggestionsDigestEmail({
      locale: "en",
      recruiterName: "Rui",
      items,
      url: "https://jobs.mastertimm.com.br/suggestions",
    });
    expect(mail.subject).toContain("Rui");
    for (const item of items) {
      expect(mail.text).toContain(`${item.title} — ${item.company}`);
      expect(mail.text).not.toContain(item.note);
    }
    expect(mail.text.match(/\/suggestions/g)).toHaveLength(1);
    expect(mail.text).toContain("3 job(s)");
  });
});

describe("nome é dado do usuário", () => {
  it("UT-049 quebra de linha não chega ao assunto e marcação sai como texto", () => {
    const injected = accessGrantedEmail({
      locale: "en",
      candidateName: "Ana\nBcc: x@y.com",
      url: recruiterUrl,
      expiresAt: null,
      expiryTz: null,
    });
    expect(injected.subject).not.toMatch(/[\r\n]/);
    expect(injected.text).not.toMatch(/^Bcc:/m);

    const markup = inviteEmail({ locale: "en", candidateName: "<b>Ana</b>", url, validUntil: "2026-10-13T12:00:00Z" });
    expect(markup.text).toContain("<b>Ana</b>");
    expect(markup.subject).toContain("<b>Ana</b>");

    const digest = suggestionsDigestEmail({
      locale: "pt-BR",
      recruiterName: "Rui\r\nBcc: x@y.com",
      items: [{ title: "Vaga\nX", company: "Acme Y" }],
      url: "https://jobs.test/suggestions",
    });
    expect(digest.subject).not.toMatch(/[\r\n]/);
    expect(digest.text).toContain("• Vaga X — Acme Y");
  });

  it("devolve só assunto e texto, mesmo com dado extra na entrada", () => {
    const mail = accessEndedEmail({
      locale: "pt-BR",
      candidateName: "Ana",
      cause: "candidate",
      ...{ salaryFloor: "R$ 30.000", cv: "currículo inteiro" },
    } as Parameters<typeof accessEndedEmail>[0]);
    expect(Object.keys(mail).sort()).toEqual(["subject", "text"]);
    expect(`${mail.subject}\n${mail.text}`).not.toMatch(/30\.000|currículo inteiro/);
  });
});
