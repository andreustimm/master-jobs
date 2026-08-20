/**
 * Suíte: `src/core/ingest/observe.ts` — a observação canônica de um anúncio.
 *
 * Todo canal de ingestão termina aqui: sync, adição manual, importação de JSON e
 * e-mail. É o que impede deduplicação, resolução de empresa, reabertura e
 * invalidação de score de divergirem conforme o caminho de entrada.
 *
 * Os casos abaixo cobrem o que os canais não exercitam por conta própria: nome
 * de empresa que não vira slug, URL de candidatura vazia, e o carimbo de
 * observação compartilhado por um lote inteiro.
 *
 * Fronteira DENTRO: libSQL real.
 * Fronteira FORA: rede — nenhum caso aqui busca nada.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { company, job, source } from "../src/core/db/schema.ts";
import { observeRawJob } from "../src/core/ingest/observe.ts";
import type { RawJob } from "../src/core/sources/types.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
  await db
    .insert(source)
    .values({ id: "lever:acme", kind: "lever", handle: "acme", label: "Acme" });
});

afterEach(() => {
  releaseTestDb();
});

const cru = (over: Partial<RawJob> = {}): RawJob => ({
  externalId: "ext-1",
  companyName: "Acme",
  title: "Staff AI Engineer",
  url: "https://exemplo.test/1",
  raw: {},
  ...over,
});

describe("observeRawJob", () => {
  it("guarda a vaga mesmo quando o nome da empresa não produz slug", async () => {
    // Nome escrito inteiramente fora de a-z0-9 — comum em board que publica a
    // razão social em japonês ou cirílico — vira slug vazio. Slug vazio como
    // chave uniria empresas sem nenhuma relação numa só; nulo mantém a vaga
    // legível e apenas sem empresa canônica.
    const observacao = await observeRawJob(cru({ companyName: "株式会社" }), "lever:acme");

    const [linha] = await db.select().from(job).where(eq(job.id, observacao.jobId));
    expect(linha!.companyId).toBeNull();
    // O nome cru continua visível: quem lê o quadro precisa dele.
    expect(linha!.companyName).toBe("株式会社");
    await expect(db.select().from(company)).resolves.toHaveLength(0);
  });

  it("reaproveita a empresa canônica entre variações do mesmo nome", async () => {
    // "Acme Inc." e "ACME Technologies" são a mesma empresa. Sem a resolução por
    // slug, filtrar por empregador devolveria um subconjunto arbitrário.
    const primeira = await observeRawJob(cru({ companyName: "Acme Inc." }), "lever:acme");
    const segunda = await observeRawJob(
      cru({ externalId: "ext-2", title: "Outro cargo", companyName: "ACME Technologies" }),
      "lever:acme",
    );

    const linhas = await db.select().from(job);
    const empresas = await db.select().from(company);
    expect(empresas).toHaveLength(1);
    expect(linhas.map((l) => l.companyId)).toEqual([
      empresas[0]!.id,
      empresas[0]!.id,
    ]);
    expect(primeira.jobId).not.toBe(segunda.jobId);
  });

  it("cai para a URL do anúncio quando o link de candidatura vem vazio", async () => {
    // Regra 17: `??` não protege contra string vazia. Um `applyUrl: ""` gravado
    // como está produziria um botão "candidatar-se" que não leva a lugar nenhum.
    const observacao = await observeRawJob(cru({ applyUrl: "   " }), "lever:acme");

    const [linha] = await db.select().from(job).where(eq(job.id, observacao.jobId));
    expect(linha!.applyUrl).toBe("https://exemplo.test/1");
  });

  it("compartilha um carimbo único de observação em todo o lote", async () => {
    // `observedAt` explícito é o que permite ao sync fechar, na mesma passada, o
    // que não foi visto. Com um relógio por linha, uma vaga observada no limiar
    // do segundo pareceria não vista.
    const carimbo = "2026-08-20T12:00:00.000Z";

    await observeRawJob(cru(), "lever:acme", { observedAt: carimbo });
    await observeRawJob(
      cru({ externalId: "ext-2", title: "Outro cargo" }),
      "lever:acme",
      { observedAt: carimbo },
    );

    const linhas = await db.select().from(job);
    expect(linhas.map((l) => l.firstSeenAt)).toEqual([carimbo, carimbo]);
    expect(linhas.map((l) => l.lastSeenAt)).toEqual([carimbo, carimbo]);
  });

  it("aceita um fingerprint imposto, para namespace de observação separado", async () => {
    // É o que mantém a colagem manual do usuário isolada da observação canônica
    // do mesmo anúncio: mesma empresa, mesmo cargo, mesmo local, e ainda assim
    // duas linhas — porque uma é o que o board publica e a outra é o que a
    // pessoa recebeu.
    const canonica = await observeRawJob(cru(), "lever:acme");
    const paralela = await observeRawJob(cru(), "lever:acme", {
      fingerprintOverride: "namespace-proprio",
    });

    expect(paralela.jobId).not.toBe(canonica.jobId);
    expect(paralela.fingerprint).toBe("namespace-proprio");
    expect(paralela.outcome).toBe("inserted");
  });

  it("atualiza metadados sem invalidar score quando o conteúdo não mudou", async () => {
    // Link de candidatura e id externo mudam sozinhos em agregador. Repontuar
    // por isso jogaria fora o trabalho do scorer para todo o acervo a cada
    // varredura.
    const primeira = await observeRawJob(cru(), "lever:acme");
    const segunda = await observeRawJob(
      cru({ externalId: "ext-novo", applyUrl: "https://exemplo.test/candidatar" }),
      "lever:acme",
    );

    expect(segunda.jobId).toBe(primeira.jobId);
    expect(segunda.outcome).toBe("unchanged");
    expect(segunda.contentChanged).toBe(false);
    expect(segunda.invalidatedScores).toBe(0);
    const [linha] = await db.select().from(job).where(eq(job.id, primeira.jobId));
    expect(linha!.externalId).toBe("ext-novo");
    expect(linha!.applyUrl).toBe("https://exemplo.test/candidatar");
  });
});
