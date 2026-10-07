/**
 * Suíte: `jho auth methods` e `jho auth unlink` (#464, US-013).
 *
 * Invariante: a CLI lista as formas de entrar e desliga provedor com a mesma
 * proteção do último método e a mesma auditoria da tela; e-mail desconhecido e
 * provedor não ligado saem com código 1; ligar provedor não existe na CLI.
 * Fronteira DENTRO: o Commander real (`buildProgram()`), o banco de teste com
 * as migrações e o sink de e-mail em arquivo (`JHO_ENV=local`).
 * Fronteira FORA: a tela (`auth-account-methods.test.ts`) e o fluxo do
 * provedor, que só o navegador percorre.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authEvent, authIdentity, authUser } from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { banco, carregarCli, cli, rodar } from "./cov-cli-harness.ts";

const TOUCHED = ["JHO_ENV", "JHO_MAIL_SINK", "VERCEL", "VERCEL_ENV"] as const;
let original: Record<string, string | undefined> = {};
let sink: string;

beforeAll(async () => {
  await carregarCli();
});

beforeEach(async () => {
  original = Object.fromEntries(TOUCHED.map((name) => [name, process.env[name]]));
  sink = mkdtempSync(join(tmpdir(), "jho-cli-sink-"));
  process.env.JHO_ENV = "local";
  process.env.JHO_MAIL_SINK = sink;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  await useTestDb();
});

afterEach(async () => {
  for (const name of TOUCHED) {
    const value = original[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(sink, { recursive: true, force: true });
  await releaseTestDb();
});

async function seed(
  email: string,
  options: { password?: boolean; providers?: Array<{ provider: "google" | "linkedin"; lastUsedAt?: string }> } = {},
): Promise<number> {
  const [user] = await banco()
    .insert(authUser)
    .values({ email, roles: ["candidate"], passwordHash: options.password ? "scrypt$hash-de-teste" : null })
    .returning({ id: authUser.id });
  for (const item of options.providers ?? []) {
    await banco().insert(authIdentity).values({
      userId: user!.id,
      provider: item.provider,
      subject: `${item.provider}-sujeito-${email}`,
      emailAtLink: `provedor-${email}`,
      origin: item.provider === "google" ? "automatic" : "manual",
      linkedAt: "2026-10-01T10:00:00.000Z",
      lastUsedAt: item.lastUsedAt ?? null,
    });
  }
  return user!.id;
}

const sinkMails = () =>
  readdirSync(sink)
    .sort()
    .map((file) => JSON.parse(readFileSync(join(sink, file), "utf8")) as { to: string; subject: string; text: string });

describe("jho auth methods", () => {
  it("IT-060 mostra a senha e cada provedor com as datas, sem dado do provedor", async () => {
    await seed("ana@x.com", {
      password: true,
      providers: [{ provider: "google", lastUsedAt: "2026-10-05T09:30:00.000Z" }, { provider: "linkedin" }],
    });
    const r = await rodar("auth", "methods", "Ana@X.com");
    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();
    expect(r.out).toContain("ana@x.com");
    expect(r.out).toMatch(/senha\s+definida/);
    expect(r.out).toMatch(/google\s+ligado em 2026-10-01 \(automático\) · último uso: 2026-10-05 09:30/);
    expect(r.out).toMatch(/linkedin\s+ligado em 2026-10-01 \(manual\) · último uso: nunca/);
    expect(r.out).not.toContain("sujeito");
    expect(r.out).not.toContain("provedor-ana@x.com");

    await seed("bia@x.com");
    const bia = await rodar("auth", "methods", "bia@x.com");
    expect(bia.out).toMatch(/senha\s+não definida/);
    expect(bia.out).toMatch(/google\s+não ligado/);
  });

  it("IT-062 e-mail desconhecido: 'não existe' e código 1", async () => {
    const r = await rodar("auth", "methods", "ninguem@x.com");
    expect(r.code).toBe(1);
    expect(r.err).toContain("Conta ninguem@x.com não existe.");
    const u = await rodar("auth", "unlink", "ninguem@x.com", "google");
    expect(u.code).toBe(1);
    expect(u.err).toContain("Conta ninguem@x.com não existe.");
  });
});

describe("jho auth unlink", () => {
  it("IT-061 desliga, registra identity_unlinked (cli) e manda o aviso", async () => {
    const ana = await seed("ana@x.com", { password: true, providers: [{ provider: "google" }] });
    const r = await rodar("auth", "unlink", "ana@x.com", "google");
    expect(r.erro).toBeUndefined();
    expect(r.code).toBeUndefined();
    expect(r.out).toContain("google desligado de ana@x.com");

    expect(await banco().select().from(authIdentity).where(eq(authIdentity.userId, ana))).toHaveLength(0);
    const unlinked = await banco().select().from(authEvent).where(eq(authEvent.kind, "identity_unlinked"));
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0]).toMatchObject({ userId: ana, email: "ana@x.com", detail: "google: cli" });
    const mails = sinkMails();
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ to: "ana@x.com", subject: "Google foi desligado da sua conta do Master Jobs" });
  });

  it("IT-063 provedor não ligado: 'nada a desligar' e código 1; último método também recusa", async () => {
    await seed("ana@x.com", { password: true, providers: [{ provider: "google" }] });
    const r = await rodar("auth", "unlink", "ana@x.com", "linkedin");
    expect(r.code).toBe(1);
    expect(r.err).toContain("Nada a desligar: linkedin não está ligado a ana@x.com.");

    const bia = await seed("bia@x.com", { providers: [{ provider: "linkedin" }] });
    const last = await rodar("auth", "unlink", "bia@x.com", "linkedin");
    expect(last.code).toBe(1);
    expect(last.err).toContain("última forma de entrar");
    expect(await banco().select().from(authIdentity).where(eq(authIdentity.userId, bia))).toHaveLength(1);

    const invalid = await rodar("auth", "unlink", "ana@x.com", "github");
    expect(invalid.code).toBe(1);
    expect(invalid.err).toContain("Provedor inválido: github");
    expect(await banco().select().from(authEvent).where(eq(authEvent.kind, "identity_unlinked"))).toHaveLength(0);
    expect(sinkMails()).toEqual([]);
  });

  it("IT-064 não existe `jho auth link`: a ajuda não lista e o comando é recusado", async () => {
    const help = await rodar("auth", "--help");
    expect(help.uso).toContain("methods <email>");
    expect(help.uso).toContain("unlink <email> <provider>");
    expect(help.uso).not.toMatch(/^\s+link\b/m);

    const subcommands = cli.root!.commands.find((command) => command.name() === "auth")!.commands.map((c) => c.name());
    expect(subcommands).toContain("unlink");
    expect(subcommands).not.toContain("link");

    // Sem o subcomando, `link …` cai no padrão (`status`), que recusa os argumentos.
    await seed("ana@x.com", { password: true });
    const link = await rodar("auth", "link", "ana@x.com", "google");
    expect(link.erro).toBeDefined();
    expect(link.uso).toMatch(/too many arguments for 'status'/);
    expect(await banco().select().from(authIdentity)).toHaveLength(0);
  });
});
