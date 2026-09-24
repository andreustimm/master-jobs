/**
 * Identidade estável da vaga por (fonte, id externo) — #291.
 *
 * O fingerprint (empresa, título, local) muda quando a empresa edita o título.
 * Antes, a edição virava vaga nova e a candidatura ficava presa na linha velha,
 * que fechava por ausência. Dentro da fonte, o id externo é a identidade; o
 * fingerprint continua sendo a ponte entre fontes.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { application, candidate, job } from "../src/core/db/schema.ts";
import { ambiguousExternalIds, resolveObservedIdentity, usableExternalId } from "../src/core/ingest/identity.ts";
import { observeRawJobs } from "../src/core/ingest/observe.ts";
import { syncAll } from "../src/core/ingest/run.ts";
import { fixtureHttp, resetHttpPort, setHttpPort } from "../src/core/sources/http-port.ts";
import "../src/core/sources/http.ts";
import type { SourceConfig } from "../src/core/sources/types.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

const row = (id: number, fingerprint: string, closedAt: string | null = null) => ({ id, fingerprint, closedAt });

describe("resolveObservedIdentity", () => {
  it("sem id externo conhecido, vale o fingerprint como antes", () => {
    const byFingerprint = row(7, "novo");
    expect(resolveObservedIdentity({ fingerprint: "novo", byExternal: [], byFingerprint })).toEqual({
      existing: byFingerprint,
      fingerprint: "novo",
      matchedBy: "fingerprint",
    });
    expect(resolveObservedIdentity({ fingerprint: "novo", byExternal: [], byFingerprint: null })).toEqual({
      existing: null,
      fingerprint: "novo",
      matchedBy: "none",
    });
  });

  it("título editado: acha pelo id externo e grava o fingerprint novo", () => {
    const antiga = row(3, "velho");
    expect(resolveObservedIdentity({ fingerprint: "novo", byExternal: [antiga], byFingerprint: null })).toEqual({
      existing: antiga,
      fingerprint: "novo",
      matchedBy: "external-id",
    });
  });

  it("fingerprint novo já é de outra linha: mantém o antigo, nunca junta linhas", () => {
    const daFonte = row(3, "velho");
    const deOutraFonte = row(9, "novo");
    const decision = resolveObservedIdentity({ fingerprint: "novo", byExternal: [daFonte], byFingerprint: deOutraFonte });
    expect(decision).toEqual({ existing: daFonte, fingerprint: "velho", matchedBy: "external-id" });
  });

  it("duplicatas herdadas: prefere o fingerprint igual, depois a aberta, depois a mais antiga", () => {
    const fechada = row(1, "a", "2026-09-01T00:00:00.000Z");
    const aberta = row(2, "b");
    const outraAberta = row(5, "c");
    expect(resolveObservedIdentity({ fingerprint: "c", byExternal: [fechada, aberta, outraAberta], byFingerprint: outraAberta }).existing).toBe(outraAberta);
    expect(resolveObservedIdentity({ fingerprint: "z", byExternal: [outraAberta, fechada, aberta], byFingerprint: null }).existing).toBe(aberta);
    expect(resolveObservedIdentity({ fingerprint: "z", byExternal: [row(8, "x", "t"), row(4, "y", "t")], byFingerprint: null }).existing?.id).toBe(4);
  });
});

describe("usableExternalId e ambiguousExternalIds", () => {
  it("vazio não identifica nada (regra 17)", () => {
    expect(usableExternalId("", new Set())).toBeNull();
    expect(usableExternalId("   ", new Set())).toBeNull();
    expect(usableExternalId(null, new Set())).toBeNull();
    expect(usableExternalId(" 42 ", new Set())).toBe("42");
  });

  it("id repetido com fingerprints diferentes na mesma listagem é ambíguo", () => {
    const ambiguous = ambiguousExternalIds([
      { externalId: "1", fingerprint: "a" },
      { externalId: "1", fingerprint: "a" },
      { externalId: "2", fingerprint: "b" },
      { externalId: "2", fingerprint: "c" },
      { externalId: "", fingerprint: "d" },
    ]);
    expect([...ambiguous]).toEqual(["2"]);
    expect(usableExternalId("2", ambiguous)).toBeNull();
    expect(usableExternalId("1", ambiguous)).toBe("1");
  });
});

describe("sincronização com identidade por id externo", () => {
  let db: DB;
  beforeEach(async () => {
    db = await useTestDb();
  });
  afterEach(async () => {
    resetHttpPort();
    await releaseTestDb();
  });

  const acme: SourceConfig = { kind: "greenhouse", handle: "acme", label: "Acme" };
  const vaga = (id: number, title: string) => ({
    id,
    title,
    absolute_url: `https://boards.greenhouse.io/acme/jobs/${id}`,
    content: `&lt;p&gt;Descrição ${id}.&lt;/p&gt;`,
  });
  const board = (jobs: unknown[]) => setHttpPort(fixtureHttp({ "boards-api.greenhouse.io": { jobs } }));

  it("título editado atualiza a mesma linha, e a candidatura continua na vaga aberta", async () => {
    board([vaga(1, "Staff Engineer")]);
    await syncAll([acme]);
    const [antes] = await db.select().from(job);
    const [pessoa] = await db.insert(candidate).values({ slug: "dono", name: "Dono" }).returning({ id: candidate.id });
    await db.insert(application).values({ candidateId: pessoa!.id, jobId: antes!.id, status: "applied", notes: "enviei" });

    board([vaga(1, "Principal Engineer")]);
    const r = await syncAll([acme]);

    // Listagem completa: antes da #291 a linha velha fechava por ausência e
    // uma nova nascia. Agora é a mesma linha, com o título novo.
    expect(r.totals).toMatchObject({ inserted: 0, closed: 0, changed: 1 });
    const linhas = await db.select().from(job);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ id: antes!.id, title: "Principal Engineer", closedAt: null });
    expect(linhas[0]!.fingerprint).not.toBe(antes!.fingerprint);
    const [candidatura] = await db.select().from(application);
    expect(candidatura).toMatchObject({ jobId: antes!.id, status: "applied", notes: "enviei" });
  });

  it("fingerprint novo já pertence a outra fonte: as duas linhas continuam separadas", async () => {
    // Outra fonte (mesmo empregador, outro board) já tem a vaga com o título
    // que a Acme passa a usar — o mesmo fingerprint.
    const espelho: SourceConfig = { kind: "greenhouse", handle: "acme-espelho", label: "Acme" };
    board([vaga(1, "Staff Engineer")]);
    await syncAll([acme]);
    board([vaga(77, "Principal Engineer")]);
    await syncAll([espelho]);
    const [daFonte] = await db.select().from(job).where(eq(job.sourceId, "greenhouse:acme"));
    const [doEspelho] = await db.select().from(job).where(eq(job.sourceId, "greenhouse:acme-espelho"));

    board([vaga(1, "Principal Engineer")]);
    const r = await syncAll([acme]);

    // Juntar as linhas seria mover candidatura; a da Acme fica com o
    // fingerprint antigo, e o índice único não é violado.
    expect(r.totals).toMatchObject({ failed: 0, inserted: 0 });
    const [depois] = await db.select().from(job).where(eq(job.id, daFonte!.id));
    expect(depois).toMatchObject({ title: "Principal Engineer", fingerprint: daFonte!.fingerprint, closedAt: null });
    const [espelhoDepois] = await db.select().from(job).where(eq(job.id, doEspelho!.id));
    expect(espelhoDepois).toMatchObject({ sourceId: "greenhouse:acme-espelho", closedAt: null });
    await expect(db.select().from(job)).resolves.toHaveLength(2);
  });

  it("captura por termo não identifica por id externo de outra fonte", async () => {
    board([vaga(1, "Staff Engineer")]);
    await syncAll([acme]);

    // Mesmo id externo "1", mas título diferente e a observação é de captura
    // (keepExistingSource): continua valendo só o fingerprint.
    await observeRawJobs(
      [{ externalId: "1", companyName: "Outra", title: "Designer", url: "https://example.test/d", raw: {} }],
      "greenhouse:acme",
      { keepExistingSource: true },
    );

    const linhas = await db.select().from(job);
    expect(linhas).toHaveLength(2);
    expect(linhas.find((l) => l.externalId === "1" && l.title === "Staff Engineer")).toBeDefined();
  });
});
