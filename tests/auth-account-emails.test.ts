/**
 * Suíte: e-mails da conta localizados e sink em arquivo (#464, ADR-011).
 *
 * Fronteira DENTRO: os construtores puros de `app/account-emails.ts`, o
 * `fileMailer` gravando num diretório temporário de verdade e a escolha de
 * `configuredMailer` pelo ambiente.
 * Fronteira FORA: o Resend — nenhum caso envia; o adapter dele só é
 * identificado pelo nome.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accountExistsEmail,
  providerNoticeEmail,
  recoveryEmail,
  signupCodeEmail,
  welcomeEmail,
} from "../src/contexts/auth/app/account-emails.ts";
import { configuredMailer, fileMailer } from "../src/contexts/auth/infra/resend-mailer.ts";

let sink: string;

beforeEach(() => {
  sink = mkdtempSync(join(tmpdir(), "jho-mail-sink-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(sink, { recursive: true, force: true });
});

const sinkFiles = () => readdirSync(sink).sort();

describe("construtores", () => {
  it("UT-080 boas-vindas no idioma escolhido, com o endereço de entrada", () => {
    const signInUrl = "https://jobs.mastertimm.com.br/login";
    const pt = welcomeEmail({ locale: "pt-BR", role: "candidate", signInUrl });
    expect(pt.subject).toBe("Boas-vindas ao Master Jobs");
    expect(pt.text).toContain("Sua conta no Master Jobs está pronta.");
    expect(pt.text).toContain("currículo");
    expect(pt.text).toContain(signInUrl);

    const en = welcomeEmail({ locale: "en", role: "recruiter", signInUrl });
    expect(en.subject).toBe("Welcome to Master Jobs");
    expect(en.text).toContain("recruiter account starts with no candidates");
    expect(en.text).toContain(signInUrl);
    expect(en.text).not.toContain("Sua conta");
  });

  it("UT-080 código e conta existente: o código aparece só no e-mail de código", () => {
    const code = signupCodeEmail({ locale: "pt-BR", code: "482915", minutes: 15 });
    expect(code.text).toContain("482915");
    expect(code.text).toContain("15 minutos");
    // O código fica fora do assunto, que aparece em notificação e lista.
    expect(code.subject).not.toContain("482915");

    const exists = accountExistsEmail({
      locale: "en",
      signInUrl: "https://jobs.test/login",
      recoveryUrl: "https://jobs.test/login/forgot",
    });
    expect(exists.text).toContain("https://jobs.test/login/forgot");
    expect(exists.text).not.toMatch(/\b\d{6}\b/);
  });

  it("UT-082 aviso de vínculo nomeia o provedor, a data e 'an administrator'", () => {
    const notice = providerNoticeEmail({
      locale: "en",
      provider: "google",
      action: "linked",
      by: "admin",
      at: "2026-10-06T15:30:00.000Z",
    });
    expect(notice.subject).toBe("Google was connected to your Master Jobs account");
    expect(notice.text).toContain("Google");
    expect(notice.text).toContain("October 6, 2026");
    expect(notice.text).toContain("an administrator");

    const cli = providerNoticeEmail({ locale: "pt-BR", provider: "linkedin", action: "unlinked", by: "cli", at: "2026-10-06T15:30:00.000Z" });
    expect(cli.subject).toBe("LinkedIn foi desligado da sua conta do Master Jobs");
    expect(cli.text).toContain("por um administrador");
    expect(cli.text).toContain("6 de outubro de 2026");

    const auto = providerNoticeEmail({ locale: "pt-BR", provider: "google", action: "linked", by: "automatic", at: "2026-10-06T15:30:00.000Z" });
    expect(auto.text).toContain("automaticamente, no seu primeiro login com Google");
  });

  it("UT-083 o aviso não carrega e-mail do provedor, token, nome nem foto, mesmo se vierem junto", () => {
    // Um chamador descuidado passa a identidade inteira; o construtor só lê o
    // que a mensagem precisa e devolve só assunto e texto.
    const identity = {
      locale: "pt-BR" as const,
      provider: "google" as const,
      action: "linked" as const,
      by: "self" as const,
      at: "2026-10-06T15:30:00.000Z",
      email: "outra.pessoa@gmail.com",
      accessToken: "ya29.token-secreto",
      idToken: "eyJhbGciOi.id-token",
      name: "Fulana de Tal",
      picture: "https://lh3.googleusercontent.com/foto.jpg",
    };
    const notice = providerNoticeEmail(identity);
    expect(Object.keys(notice).sort()).toEqual(["subject", "text"]);
    const all = `${notice.subject}\n${notice.text}`;
    for (const leaked of [identity.email, identity.accessToken, identity.idToken, identity.name, identity.picture]) {
      expect(all).not.toContain(leaked);
    }
  });

  it("UT-084 recuperação em inglês com o link", () => {
    const url = "https://jobs.mastertimm.com.br/login/reset?token=abc";
    const mail = recoveryEmail({ locale: "en", url, minutes: 60 });
    expect(mail.subject).toBe("Recover access to Master Jobs");
    expect(mail.text).toContain(url);
    expect(mail.text).toContain("60 minutes");
    expect(recoveryEmail({ locale: "pt-BR", url, minutes: 60 }).subject).toBe("Recuperar o acesso ao Master Jobs");
  });

  it("UT-085 código e link de recuperação não chegam a log nenhum fora do processo local", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );
    const code = "739204";
    const url = "https://jobs.test/login/reset?token=segredo-de-uso-unico";
    const messages = [
      signupCodeEmail({ locale: "pt-BR", code, minutes: 15 }),
      recoveryEmail({ locale: "en", url, minutes: 60 }),
    ];
    const deployments = [
      { JHO_ENV: "production" },
      { JHO_ENV: "preview", VERCEL: "1", VERCEL_ENV: "preview" },
      {},
      // Sink cadastrado por engano em produção não vira caminho para o log.
      { JHO_ENV: "production", JHO_MAIL_SINK: sink },
    ];
    for (const env of deployments) {
      const mailer = configuredMailer(env);
      for (const message of messages) await mailer.send({ to: "ana@example.test", ...message });
    }
    const logged = spies.flatMap((spy) => spy.mock.calls.flat().map(String)).join("\n");
    expect(logged).not.toContain(code);
    expect(logged).not.toContain("segredo-de-uso-unico");
    expect(sinkFiles()).toEqual([]);
  });
});

describe("sink em arquivo", () => {
  it("UT-081 com JHO_MAIL_SINK e JHO_ENV=local o e-mail vai para o arquivo, mesmo com chave do Resend", async () => {
    const mailer = configuredMailer({
      JHO_ENV: "local",
      JHO_MAIL_SINK: sink,
      RESEND_API_KEY: "re_fake",
      RESEND_FROM: "contato@mastertimm.com.br",
    });
    expect(mailer.name).toBe("file");

    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const message = signupCodeEmail({ locale: "pt-BR", code: "120034", minutes: 15 });
    const first = await mailer.send({ to: "ana@example.test", ...message });
    const second = await mailer.send({ to: "ana@example.test", ...welcomeEmail({ locale: "pt-BR", role: "candidate", signInUrl: "http://127.0.0.1:3000/login" }) });
    expect(first.ok && second.ok).toBe(true);
    expect(log).not.toHaveBeenCalled();

    const files = sinkFiles();
    expect(files).toHaveLength(2);
    const stored = JSON.parse(readFileSync(join(sink, files[0]!), "utf8"));
    expect(stored).toMatchObject({ to: "ana@example.test", subject: message.subject, text: message.text });
    // A ordem alfabética dos arquivos é a ordem de envio.
    expect(JSON.parse(readFileSync(join(sink, files[1]!), "utf8")).subject).toBe("Boas-vindas ao Master Jobs");
  });

  it("UT-081 em produção a mesma configuração escolhe Resend ou o mailer que omite", () => {
    expect(configuredMailer({ JHO_ENV: "production", JHO_MAIL_SINK: sink, RESEND_API_KEY: "re_fake", RESEND_FROM: "contato@mastertimm.com.br" }).name).toBe("resend");
    expect(configuredMailer({ JHO_ENV: "production", JHO_MAIL_SINK: sink }).name).toBe("withheld");
  });

  it("UT-081 o sink cria o diretório quando ele ainda não existe", async () => {
    const nested = join(sink, "novo", "dir");
    const result = await fileMailer(nested).send({ to: "a@x.test", subject: "s", text: "t" });
    expect(result.ok).toBe(true);
    expect(readdirSync(nested)).toHaveLength(1);
  });
});

describe("sink fora de produção, integração com o ambiente", () => {
  it("IT-075 JHO_MAIL_SINK com JHO_ENV=production não grava arquivo nenhum e não entrega", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const mailer = configuredMailer({ JHO_ENV: "production", JHO_MAIL_SINK: sink });
    const result = await mailer.send({ to: "ana@example.test", ...signupCodeEmail({ locale: "en", code: "555111", minutes: 15 }) });
    expect(mailer.name).toBe("withheld");
    expect(result.ok).toBe(false);
    expect(sinkFiles()).toEqual([]);
  });
});
