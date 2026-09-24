/**
 * Catálogo de fontes no PostgreSQL (#223, tarefa 01).
 *
 * IT-001: cadastrar, editar, desabilitar e aposentar, com duplicado e segredo
 * recusados e o acervo da fonte aposentada legível.
 * IT-002: os dois regimes de `ensureSources`, a seleção do sync pelo banco, a
 * importação, a divergência e a sondagem sem gravação.
 *
 * Fronteira FORA: rede (porta HTTP dublê) e o arquivo YAML (temporário).
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { count, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  catalogSources,
  editCatalogSource,
  importCatalog,
  probeCatalogSource,
  registerCatalogSource,
  retireSource,
  syncableSources,
} from "../src/contexts/sourcing/index.ts";
import type { DB } from "../src/core/db/client.ts";
import { application, candidate, job, source } from "../src/core/db/schema.ts";
import { catalogForSync, ensureSources, syncAll, syncSource } from "../src/core/ingest/run.ts";
import { fixtureHttp, resetHttpPort, setHttpPort } from "../src/core/sources/http-port.ts";
import "../src/core/sources/http.ts";
import { FETCHABLE_SOURCE_KINDS } from "../src/core/sources/types.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;
const NOW = "2026-09-23T12:00:00.000Z";

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(async () => {
  resetHttpPort();
  delete process.env.JHO_SOURCES_PATH;
  await releaseTestDb();
});

function yamlFile(text: string): void {
  const dir = mkdtempSync(join(tmpdir(), "jho-catalog-"));
  const file = join(dir, "sources.yaml");
  writeFileSync(file, text);
  process.env.JHO_SOURCES_PATH = file;
}

async function linha(id: string) {
  const [row] = await db.select().from(source).where(eq(source.id, id));
  return row;
}

const greenhouseBoard = (ids: number[]) =>
  fixtureHttp({
    "boards-api.greenhouse.io": {
      jobs: ids.map((id) => ({ id, title: `Vaga ${id}`, absolute_url: `https://boards.greenhouse.io/acme/jobs/${id}`, content: "" })),
    },
  });

describe("IT-001 escrita no catálogo", () => {
  it("cadastra, edita, desabilita e aposenta, carimbando o regime gerido e a revisão", async () => {
    const created = await registerCatalogSource(
      { kind: "greenhouse", handle: "acme", label: "Acme", enabled: false, secretRef: "ACME_TOKEN" },
      NOW,
    );
    expect(created).toEqual({ ok: true, id: "greenhouse:acme" });
    expect(await linha("greenhouse:acme")).toMatchObject({
      origin: "admin",
      enabled: false,
      secretRef: "ACME_TOKEN",
      managedAt: NOW,
      configRevision: 1,
      retiredAt: null,
    });

    expect(await editCatalogSource("greenhouse:acme", { label: "Acme Corp", enabled: true }, NOW)).toEqual({ ok: true });
    expect(await linha("greenhouse:acme")).toMatchObject({ label: "Acme Corp", enabled: true, configRevision: 2 });

    expect(await editCatalogSource("greenhouse:acme", { enabled: false }, NOW)).toEqual({ ok: true });
    expect(await linha("greenhouse:acme")).toMatchObject({ enabled: false, configRevision: 3 });

    expect(await retireSource("greenhouse:acme", NOW)).toEqual({ ok: true });
    expect(await linha("greenhouse:acme")).toMatchObject({ retiredAt: NOW, enabled: false, configRevision: 4 });
    // Aposentada não volta por edição nem aposenta de novo.
    expect(await editCatalogSource("greenhouse:acme", { enabled: true }, NOW)).toEqual({ ok: false, code: "not_found_or_retired" });
    expect(await retireSource("greenhouse:acme", NOW)).toEqual({ ok: false, code: "not_found_or_retired" });
  });

  it("recusa duplicado, inclusive na corrida em que os dois passaram pela validação", async () => {
    const input = { kind: "lever", handle: "globex", label: "Globex", enabled: true, secretRef: null };
    const both = await Promise.all([registerCatalogSource(input, NOW), registerCatalogSource(input, NOW)]);
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    expect(both.find((r) => !r.ok)).toEqual({ ok: false, code: "duplicate" });
    expect(await registerCatalogSource(input, NOW)).toEqual({ ok: false, code: "duplicate" });
    expect((await db.select({ n: count() }).from(source))[0]!.n).toBe(1);
  });

  it("recusa valor de segredo antes de gravar e nunca o guarda", async () => {
    const segredo = "sk-live-4f9a8b7c6d5e4f3a2b1c";
    const result = await registerCatalogSource(
      { kind: "greenhouse", handle: "acme", label: "Acme", enabled: true, secretRef: segredo },
      NOW,
    );
    expect(result).toEqual({ ok: false, code: "secret_ref_invalid" });
    expect(JSON.stringify(result)).not.toContain(segredo);
    expect(await db.select().from(source)).toEqual([]);

    await registerCatalogSource({ kind: "greenhouse", handle: "acme", label: "Acme", enabled: true, secretRef: null }, NOW);
    expect(await editCatalogSource("greenhouse:acme", { secretRef: "AKIAIOSFODNN7EXAMPLE" }, NOW)).toEqual({
      ok: false,
      code: "secret_ref_looks_like_secret",
    });
    expect((await linha("greenhouse:acme"))!.secretRef).toBeNull();
  });

  it("aposentar preserva vagas e candidaturas da fonte, legíveis como antes", async () => {
    await registerCatalogSource({ kind: "greenhouse", handle: "acme", label: "Acme", enabled: true, secretRef: null }, NOW);
    const [vaga] = await db
      .insert(job)
      .values({
        fingerprint: "fp-acme-1",
        contentHash: "h",
        sourceId: "greenhouse:acme",
        externalId: "1",
        companyName: "Acme",
        title: "Arquiteta de Software",
        url: "https://boards.greenhouse.io/acme/jobs/1",
        raw: {},
      })
      .returning({ id: job.id });
    const [pessoa] = await db.insert(candidate).values({ slug: "ana", name: "Ana" }).returning({ id: candidate.id });
    await db.insert(application).values({ candidateId: pessoa!.id, jobId: vaga!.id, status: "applied" });

    await retireSource("greenhouse:acme", NOW);

    expect(await db.select({ id: job.id }).from(job).where(eq(job.sourceId, "greenhouse:acme"))).toHaveLength(1);
    expect(await db.select({ status: application.status }).from(application)).toEqual([{ status: "applied" }]);
    expect((await catalogSources()).map((row) => [row.id, row.retiredAt])).toEqual([["greenhouse:acme", NOW]]);
  });
});

describe("IT-001 migration 0021: origem das linhas que já existiam", () => {
  it("marca como yaml só as linhas de sync, e reaplicar não muda nada", async () => {
    await db.insert(source).values([
      { id: "greenhouse:acme", kind: "greenhouse", handle: "acme", label: "Acme" },
      { id: "remotive:~terms", kind: "remotive", handle: "~terms", label: "Termos" },
      { id: "manual:sample", kind: "manual", handle: "sample", label: "Fixture" },
      { id: "lever:tela", kind: "lever", handle: "tela", label: "Tela", origin: "admin" },
      // Criada por `jho jobs add` para um link de ATS: mesmo kind, mas desligada.
      { id: "greenhouse:avulsa", kind: "greenhouse", handle: "avulsa", label: "Avulsa", enabled: false },
    ]);
    const backfill = readFileSync(resolve(process.cwd(), "drizzle/postgres/0021_backfill_source_origin.sql"), "utf8");

    await db.execute(sql.raw(backfill));
    await db.execute(sql.raw(backfill));

    const rows = await db.select({ id: source.id, origin: source.origin, managedAt: source.managedAt }).from(source).orderBy(source.id);
    expect(rows).toEqual([
      { id: "greenhouse:acme", origin: "yaml", managedAt: null },
      { id: "greenhouse:avulsa", origin: "system", managedAt: null },
      { id: "lever:tela", origin: "admin", managedAt: null },
      { id: "manual:sample", origin: "system", managedAt: null },
      { id: "remotive:~terms", origin: "system", managedAt: null },
    ]);
  });

  it("a lista de kinds da migration só tem kinds com adapter", () => {
    // Migration é congelada: kind novo no registro depois dela nasce `yaml`
    // pelo `ensureSources`, sem precisar do backfill. O inverso — kind na
    // lista sem adapter — marcaria `manual`/`recruiter` como vindos do arquivo.
    const backfill = readFileSync(resolve(process.cwd(), "drizzle/postgres/0021_backfill_source_origin.sql"), "utf8");
    const lista = /"kind" IN \(([^)]*)\)/.exec(backfill)![1]!.split(",").map((k) => k.trim().replaceAll("'", ""));
    expect(lista.length).toBeGreaterThan(0);
    expect([...FETCHABLE_SOURCE_KINDS]).toEqual(expect.arrayContaining(lista));
  });
});

describe("IT-002 regimes, seleção, importação, divergência e sondagem", () => {
  it("linha não gerida espelha o arquivo, inclusive enabled: false, e órfã é desabilitada", async () => {
    await ensureSources([{ kind: "greenhouse", handle: "acme", label: "Acme" }, { kind: "lever", handle: "saiu", label: "Saiu" }]);
    expect(await linha("greenhouse:acme")).toMatchObject({ enabled: true, origin: "yaml", managedAt: null, configRevision: 1 });

    await ensureSources([{ kind: "greenhouse", handle: "acme", label: "Acme", enabled: false }], { wholeFile: true });

    expect(await linha("greenhouse:acme")).toMatchObject({ enabled: false, configRevision: 2 });
    expect(await linha("lever:saiu")).toMatchObject({ enabled: false, configRevision: 2 });
  });

  it("fonte isolada nunca desliga as outras: órfã só com o arquivo inteiro", async () => {
    await ensureSources([{ kind: "greenhouse", handle: "acme", label: "Acme" }, { kind: "lever", handle: "beta", label: "Beta" }]);
    await ensureSources([{ kind: "greenhouse", handle: "acme", label: "Acme" }]);
    expect((await linha("lever:beta"))!.enabled).toBe(true);
  });

  it("seleção velha não religa a fonte que o arquivo acabou de desligar", async () => {
    await ensureSources([{ kind: "greenhouse", handle: "acme", label: "Acme" }]);
    const selecionadas = await syncableSources();
    await ensureSources([{ kind: "greenhouse", handle: "acme", label: "Acme", enabled: false }], { wholeFile: true });
    setHttpPort(greenhouseBoard([1]));

    // Quem leu a seleção antes do desligamento ainda roda com ela.
    await syncAll(selecionadas);
    await syncSource(selecionadas[0]!);

    expect(await linha("greenhouse:acme")).toMatchObject({ enabled: false, configRevision: 2 });
  });

  it("revisão nula conta como 1 ao subir, em vez de ficar nula para sempre", async () => {
    await db.insert(source).values({ id: "greenhouse:acme", kind: "greenhouse", handle: "acme", label: "Acme", configRevision: null });
    await editCatalogSource("greenhouse:acme", { label: "Outro" }, NOW);
    expect((await linha("greenhouse:acme"))!.configRevision).toBe(2);
  });

  it("uma edição gravada no banco sobrevive ao sync seguinte", async () => {
    await ensureSources([{ kind: "greenhouse", handle: "acme", label: "Acme" }]);
    await editCatalogSource("greenhouse:acme", { label: "Da tela", enabled: false }, NOW);

    const configs = await catalogForSync([{ kind: "greenhouse", handle: "acme", label: "Do arquivo", enabled: true }]);

    expect(configs).toEqual([]);
    expect(await linha("greenhouse:acme")).toMatchObject({ label: "Da tela", enabled: false, managedAt: NOW });
  });

  it("banco vazio continua nascendo do arquivo", async () => {
    const configs = await catalogForSync([
      { kind: "greenhouse", handle: "acme", label: "Acme", enabled: true },
      { kind: "lever", handle: "off", label: "Desligada", enabled: false },
    ]);
    expect(configs).toEqual([{ kind: "greenhouse", handle: "acme", label: "Acme" }]);
    expect((await linha("lever:off"))!.enabled).toBe(false);
  });

  it("o sync não seleciona fixture manual, kind sem adapter, aposentada nem ~terms, e a vaga do termo não fecha", async () => {
    await db.insert(source).values([
      { id: "manual:sample", kind: "manual", handle: "sample", label: "Fixture", enabled: true },
      { id: "recruiter:", kind: "recruiter", handle: "", label: "Recrutador", enabled: true },
      { id: "remotive:~terms", kind: "remotive", handle: "~terms", label: "Termos", enabled: true },
      { id: "lever:velha", kind: "lever", handle: "velha", label: "Velha", enabled: true, retiredAt: NOW, managedAt: NOW },
    ]);
    const [doTermo] = await db
      .insert(job)
      .values({
        fingerprint: "fp-termo",
        contentHash: "h",
        sourceId: "remotive:~terms",
        externalId: "t1",
        companyName: "Beta",
        title: "Staff Engineer",
        url: "https://remotive.com/jobs/t1",
        raw: {},
      })
      .returning({ id: job.id });
    setHttpPort(greenhouseBoard([1]));

    const configs = await catalogForSync([{ kind: "greenhouse", handle: "acme", label: "Acme", enabled: true }]);
    expect(configs.map((c) => `${c.kind}:${c.handle}`)).toEqual(["greenhouse:acme"]);
    expect(await syncableSources()).toEqual(configs);
    await syncAll(configs);

    const [termo] = await db.select({ closedAt: job.closedAt }).from(job).where(eq(job.id, doTermo!.id));
    expect(termo!.closedAt).toBeNull();
    // Nenhuma das linhas fora do catálogo foi desligada por não estar no arquivo.
    expect((await linha("manual:sample"))!.enabled).toBe(true);
    expect((await linha("remotive:~terms"))!.enabled).toBe(true);
  });

  it("import simula por padrão, e --apply grava o arquivo e passa toda linha a gerida", async () => {
    await ensureSources([{ kind: "greenhouse", handle: "acme", label: "Velho" }, { kind: "lever", handle: "orfa", label: "Órfã" }]);
    yamlFile(
      "sources:\n  - kind: greenhouse\n    handle: acme\n    label: Novo\n  - kind: ashby\n    handle: nova\n    label: Nova\n    enabled: false\n",
    );
    const antes = await db.select().from(source);

    const simulado = await importCatalog({ apply: false, now: NOW });
    expect(simulado.inserts.map((e) => e.handle)).toEqual(["nova"]);
    expect(simulado.mirrors.map((e) => e.handle)).toEqual(["acme"]);
    expect(simulado.orphans).toEqual(["lever:orfa"]);
    expect(await db.select().from(source)).toEqual(antes);

    await importCatalog({ apply: true, now: NOW });
    expect(await linha("greenhouse:acme")).toMatchObject({ label: "Novo", managedAt: NOW });
    expect(await linha("ashby:nova")).toMatchObject({ enabled: false, origin: "yaml", managedAt: NOW });
    expect(await linha("lever:orfa")).toMatchObject({ enabled: false, managedAt: NOW });

    // Depois da importação, o arquivo só insere o que falta.
    await ensureSources([{ kind: "greenhouse", handle: "acme", label: "Outro", enabled: false }], { wholeFile: true });
    expect(await linha("greenhouse:acme")).toMatchObject({ label: "Novo", enabled: true });
  });

  it("diff lista a divergência sem gravar nada", async () => {
    await ensureSources([{ kind: "greenhouse", handle: "acme", label: "Acme" }]);
    await editCatalogSource("greenhouse:acme", { label: "Da tela" }, NOW);
    yamlFile("sources:\n  - kind: greenhouse\n    handle: acme\n    label: Acme\n  - kind: lever\n    handle: nova\n    label: Nova\n");
    const antes = await db.select().from(source);

    const plan = await importCatalog({ apply: false, now: NOW });

    expect(plan.drift).toEqual([
      { id: "greenhouse:acme", kind: "changed", managed: true, fields: ["label"] },
      { id: "lever:nova", kind: "only_yaml" },
    ]);
    expect(await db.select().from(source)).toEqual(antes);
  });

  it("a sondagem classifica e não grava vaga nem saúde", async () => {
    await ensureSources([{ kind: "greenhouse", handle: "acme", label: "Acme" }]);
    const antes = await linha("greenhouse:acme");

    setHttpPort(greenhouseBoard([1, 2]));
    expect(await probeCatalogSource("greenhouse", "acme")).toMatchObject({ outcome: "reachable", count: 2, completeness: "complete" });

    setHttpPort(greenhouseBoard([]));
    expect(await probeCatalogSource("greenhouse", "acme")).toMatchObject({ outcome: "empty", count: 0 });

    setHttpPort(fixtureHttp({ "boards-api.greenhouse.io": { status: 403 } }));
    expect(await probeCatalogSource("greenhouse", "acme")).toMatchObject({ outcome: "blocked", status: 403 });

    setHttpPort(fixtureHttp({ "boards-api.greenhouse.io": { status: 503 } }));
    expect(await probeCatalogSource("greenhouse", "acme")).toMatchObject({ outcome: "failed", status: 503 });

    expect(await db.select({ n: count() }).from(job)).toEqual([{ n: 0 }]);
    expect(await linha("greenhouse:acme")).toEqual(antes);
    await expect(probeCatalogSource("manual", "x")).rejects.toThrow(/No adapter/);
  });
});
