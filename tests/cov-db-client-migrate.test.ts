/**
 * Suíte: `src/core/db/client.ts` e `src/core/db/migrate.ts`.
 *
 * Estes dois arquivos são o ponto onde "roda local" e "roda na Vercel" precisam
 * ser o mesmo código. O que se testa é a **resolução de destino**: qual banco
 * abre quando nada foi configurado, o que acontece quando a configuração está
 * pela metade, e se o bootstrap consegue criar o diretório antes de o libSQL
 * tentar abrir o arquivo.
 *
 * Fronteira DENTRO: variáveis de ambiente, sistema de arquivos e o cliente
 * libSQL real apontado para arquivos temporários.
 * Fronteira FORA: qualquer banco remoto — nenhum caso abre socket.
 */
import { sql } from "drizzle-orm";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../src/core/db/client.ts";
import { runMigrations } from "../src/core/db/migrate.ts";

const raizDoProjeto = process.cwd();
let temporario: string;
let ambienteSalvo: { url?: string; token?: string };

beforeEach(() => {
  ambienteSalvo = {
    url: process.env.TURSO_DATABASE_URL,
    token: process.env.TURSO_AUTH_TOKEN,
  };
  temporario = mkdtempSync(join(tmpdir(), "jho-client-"));
  closeDb();
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
});

afterEach(() => {
  closeDb();
  process.chdir(raizDoProjeto);
  rmSync(temporario, { recursive: true, force: true });
  if (ambienteSalvo.url === undefined) delete process.env.TURSO_DATABASE_URL;
  else process.env.TURSO_DATABASE_URL = ambienteSalvo.url;
  if (ambienteSalvo.token === undefined) delete process.env.TURSO_AUTH_TOKEN;
  else process.env.TURSO_AUTH_TOKEN = ambienteSalvo.token;
});

describe("getDb", () => {
  it("abre o arquivo local padrão quando nada foi configurado", async () => {
    // "Zero configuração" é uma promessa do README: `pnpm jho` tem que funcionar
    // logo depois do clone, sem .env. O caminho é relativo ao diretório de
    // trabalho, então o teste roda dentro de um diretório temporário para não
    // encostar no banco real do desenvolvedor. `data/` é criado à mão aqui
    // porque o libSQL não cria diretório — é exatamente essa lacuna que
    // `runMigrations` cobre, e os casos abaixo verificam.
    process.chdir(temporario);
    mkdirSync(join(temporario, "data"));

    const db = getDb();
    await db.run(sql.raw("create table sonda (x integer)"));

    expect(existsSync(join(temporario, "data", "jobs.db"))).toBe(true);
  });

  it("reaproveita o mesmo cliente entre chamadas", async () => {
    // O runtime do Next.js chama `getDb()` por requisição. Abrir um cliente novo
    // a cada chamada vazaria descritores de arquivo e, no Turso, conexões.
    process.env.TURSO_DATABASE_URL = `file:${join(temporario, "cache.db")}`;

    expect(getDb()).toBe(getDb());
  });

  it("volta a abrir depois de fechado, em vez de devolver cliente morto", async () => {
    // `closeDb()` é o teardown da CLI e dos testes. Se o cache sobrevivesse ao
    // fechamento, a próxima suíte receberia um cliente já encerrado.
    process.env.TURSO_DATABASE_URL = `file:${join(temporario, "reabre.db")}`;
    const primeiro = getDb();
    await primeiro.run(sql.raw("create table sonda (x integer)"));

    closeDb();
    const segundo = getDb();

    expect(segundo).not.toBe(primeiro);
    await expect(segundo.run(sql.raw("select 1"))).resolves.toBeDefined();
  });

  it("recusa banco remoto sem token, nomeando a variável que falta", async () => {
    // Sem esta guarda o erro apareceria como um 401 opaco lá dentro de um cron,
    // longe da causa. Falhar aqui é a diferença entre "faltou TURSO_AUTH_TOKEN"
    // e "por que o sync parou de gravar".
    process.env.TURSO_DATABASE_URL = "libsql://exemplo.turso.io";

    expect(() => getDb()).toThrow(/TURSO_AUTH_TOKEN/);
    expect(() => getDb()).toThrow(/libsql:\/\/exemplo\.turso\.io/);
  });

  it("aceita banco remoto quando o token está presente, sem abrir conexão", () => {
    // Constrói o cliente e para por aí: o libSQL só fala com a rede na primeira
    // query. É o que permite testar a decisão de configuração sem sair da
    // máquina.
    process.env.TURSO_DATABASE_URL = "libsql://exemplo.turso.io";
    process.env.TURSO_AUTH_TOKEN = "token-de-teste";

    expect(() => getDb()).not.toThrow();
  });

  it("trata URL vazia como ausente, não como destino válido", async () => {
    // `.env` com `TURSO_DATABASE_URL=` produz string vazia, não `undefined`.
    // Tratar isso como configurado abriria um cliente para lugar nenhum.
    process.chdir(temporario);
    mkdirSync(join(temporario, "data"));
    process.env.TURSO_DATABASE_URL = "";

    const db = getDb();
    await db.run(sql.raw("create table sonda (x integer)"));

    expect(existsSync(join(temporario, "data", "jobs.db"))).toBe(true);
  });
});

describe("runMigrations", () => {
  it("cria o diretório do arquivo antes de o libSQL tentar abri-lo", async () => {
    // O libSQL não cria diretório: apontar para `data/jobs.db` num clone recém
    // feito falharia com "unable to open database file". Este é o passo que faz
    // `pnpm jho db migrate` funcionar como primeiro comando do projeto.
    const destino = join(temporario, "ainda", "nao", "existe", "jobs.db");
    process.env.TURSO_DATABASE_URL = `file:${destino}`;

    await runMigrations();

    expect(existsSync(destino)).toBe(true);
    const tabelas = await getDb().all<{ name: string }>(
      sql.raw("select name from sqlite_master where type = 'table'"),
    );
    const nomes = tabelas.map((t) => t.name);
    expect(nomes).toContain("job");
    expect(nomes).toContain("application");
    expect(nomes).toContain("job_score");
  });

  it("cria o banco padrão quando não há variável de ambiente nenhuma", async () => {
    // O primeiro comando de um clone: sem `.env`, sem diretório `data/`, sem
    // nada. Este é o caminho que precisa funcionar antes de qualquer outro.
    // A pasta de migrations vai absoluta só porque o teste trocou de diretório
    // de trabalho — o que está sob prova aqui é a resolução do banco, não a dela.
    process.chdir(temporario);

    await runMigrations(join(raizDoProjeto, "drizzle"));

    expect(existsSync(join(temporario, "data", "jobs.db"))).toBe(true);
    const [linha] = await getDb().all<{ total: number }>(
      sql.raw("select count(*) as total from sqlite_master where name = 'job'"),
    );
    expect(Number(linha!.total)).toBe(1);
  });

  it("é idempotente e aceita uma pasta de migrations explícita", async () => {
    // A CLI, os testes e um hook de deploy chamam o mesmo bootstrap. Rodar duas
    // vezes tem que ser inofensivo, senão o segundo start derruba o serviço.
    process.env.TURSO_DATABASE_URL = `file:${join(temporario, "duas-vezes.db")}`;

    await runMigrations("./drizzle");
    await expect(runMigrations("./drizzle")).resolves.toBeUndefined();

    const [linha] = await getDb().all<{ total: number }>(
      sql.raw("select count(*) as total from sqlite_master where name = 'job'"),
    );
    expect(Number(linha!.total)).toBe(1);
  });
});
