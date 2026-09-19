import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeDb, connectDatabase, getDb } from "../src/core/db/client.ts";
import {
  databaseUrlSources,
  normalizeConnectionUrl,
  resolveDatabaseUrl,
} from "../src/core/db/config.ts";

/**
 * Suite: de onde sai a URL do banco, e o que o runtime diz quando não sai
 * Invariant: a ordem é declarada, a origem é dizível e o valor nunca aparece.
 * Boundary IN: leitura de ambiente, normalização de URL e do certificado.
 * Boundary OUT: a conexão em si, coberta pelas suítes que usam banco real.
 */

const PEM = [
  "-----BEGIN CERTIFICATE-----",
  "MIIBfakeCertificateContentForTestsOnly",
  "-----END CERTIFICATE-----",
].join("\n");

const REMOTE = "postgres://user:pass@db.example.test:5432/postgres";
const POOLER = "postgres://user:pass@pooler.example.test:6543/postgres";
const NAMES = [
  "DATABASE_URL",
  "DATABASE_MIGRATION_URL",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
  "DATABASE_CA_CERT",
];

const saved = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));

afterEach(async () => {
  await closeDb();
  for (const name of NAMES) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

describe("resolveDatabaseUrl", () => {
  it("usa a variável explícita antes das da integração", () => {
    const env = { DATABASE_URL: REMOTE, POSTGRES_URL: POOLER };
    expect(resolveDatabaseUrl("runtime", env)).toEqual({ url: REMOTE, source: "DATABASE_URL" });
  });

  it("aceita a variável que a integração do Supabase cadastra", () => {
    // É o caso da produção real: ninguém copiou nada, e o deploy funciona.
    const env = { POSTGRES_URL: POOLER };
    expect(resolveDatabaseUrl("runtime", env)).toEqual({ url: POOLER, source: "POSTGRES_URL" });
  });

  it("migration prefere a conexão direta à do pooler", () => {
    const env = { POSTGRES_URL: POOLER, POSTGRES_URL_NON_POOLING: REMOTE };
    expect(resolveDatabaseUrl("migration", env)).toEqual({
      url: REMOTE,
      source: "POSTGRES_URL_NON_POOLING",
    });
    // E o runtime, ao contrário, prefere o pooler.
    expect(resolveDatabaseUrl("runtime", env).source).toBe("POSTGRES_URL");
  });

  it("variável em branco conta como ausente", () => {
    const env = { DATABASE_URL: "   ", POSTGRES_URL: POOLER };
    expect(resolveDatabaseUrl("runtime", env).source).toBe("POSTGRES_URL");
  });

  it("sem nenhuma, o erro lista os nomes aceitos na ordem", () => {
    expect(() => resolveDatabaseUrl("runtime", {})).toThrow(/DATABASE_URL ou POSTGRES_URL/);
    expect(databaseUrlSources("migration")[0]).toBe("DATABASE_MIGRATION_URL");
  });
});

describe("normalizeConnectionUrl", () => {
  it("descarta parâmetros de pool que o painel anexa", () => {
    expect(normalizeConnectionUrl(`${POOLER}?pgbouncer=true&connection_limit=1`, "POSTGRES_URL"))
      .toBe(POOLER);
  });

  it("recusa parâmetro de TLS em vez de apagá-lo em silêncio", () => {
    // Apagar deixaria quem escreveu `sslmode=disable` convencido de que
    // desligou a verificação — o engano mais caro possível aqui.
    expect(() => normalizeConnectionUrl(`${REMOTE}?sslmode=disable`, "DATABASE_URL")).toThrow(
      /política de TLS é do cliente/,
    );
    for (const modo of ["allow", "prefer"]) {
      expect(() => normalizeConnectionUrl(`${REMOTE}?sslmode=${modo}`, "POSTGRES_URL")).toThrow(
        /POSTGRES_URL traz sslmode/,
      );
    }
    // Trocar a CA ou a identidade do cliente também é mudar a política.
    expect(() => normalizeConnectionUrl(`${REMOTE}?sslrootcert=/tmp/ca.crt`, "POSTGRES_URL"))
      .toThrow(/POSTGRES_URL traz sslrootcert/);
  });

  it("aceita o sslmode que o provedor cadastra, porque ele não afrouxa nada", () => {
    // `POSTGRES_URL` chega da integração Supabase↔Vercel com `sslmode=require`.
    // Recusar isso derrubou a produção inteira: o cliente já exige verificação
    // de cadeia, que é MAIS estrito que `require`. A regra é recusar quem pede
    // menos, não quem pede o mesmo ou mais.
    for (const modo of ["require", "verify-ca", "verify-full", "REQUIRE"]) {
      expect(normalizeConnectionUrl(`${POOLER}?sslmode=${modo}`, "POSTGRES_URL")).toBe(POOLER);
    }
    // E continua saindo sem query string, junto com os parâmetros de pool.
    expect(normalizeConnectionUrl(`${POOLER}?sslmode=require&pgbouncer=true`, "POSTGRES_URL"))
      .toBe(POOLER);
  });

  it("sslmode com valor desconhecido recusa, em vez de deixar passar", () => {
    // Lista de permissão: um valor que ninguém previu pode ser afrouxamento
    // inventado depois, e diante do desconhecido a escolha segura é parar.
    expect(() => normalizeConnectionUrl(`${REMOTE}?sslmode=talvez`, "POSTGRES_URL")).toThrow(
      /POSTGRES_URL traz sslmode/,
    );
  });

  it("nomeia a variável errada e nunca o valor", () => {
    const error = (() => {
      try {
        normalizeConnectionUrl("mysql://user:senha-secreta@host/db", "POSTGRES_URL");
      } catch (thrown) {
        return (thrown as Error).message;
      }
      return "";
    })();
    expect(error).toContain("POSTGRES_URL");
    expect(error).not.toContain("senha-secreta");
  });
});

describe("getDb", () => {
  it("conecta pela variável da integração quando a explícita não existe", () => {
    delete process.env.DATABASE_URL;
    process.env.POSTGRES_URL = POOLER;
    expect(() => getDb()).not.toThrow();
  });

  it("sem nenhuma variável, diz quais aceita", () => {
    for (const name of NAMES) delete process.env[name];
    expect(() => getDb()).toThrow(/Nenhuma URL de banco configurada para runtime/);
  });
});

describe("DATABASE_CA_CERT", () => {
  it("aceita o PEM colado direto na variável", () => {
    process.env.DATABASE_CA_CERT = PEM;
    expect(() => connectDatabase(REMOTE)).not.toThrow();
  });

  it("aceita o caminho de um arquivo", () => {
    const file = join(mkdtempSync(join(tmpdir(), "jho-ca-")), "supabase-ca.crt");
    writeFileSync(file, PEM);
    process.env.DATABASE_CA_CERT = file;
    expect(() => connectDatabase(REMOTE)).not.toThrow();
  });

  it("recusa valor que não é PEM nem arquivo, nomeando a variável", () => {
    process.env.DATABASE_CA_CERT = "/caminho/que/nao/existe.crt";
    expect(() => connectDatabase(REMOTE)).toThrow(/DATABASE_CA_CERT/);
  });

  it("variável vazia é ausência, não erro", () => {
    process.env.DATABASE_CA_CERT = "   ";
    expect(() => connectDatabase(REMOTE)).not.toThrow();
  });
});
