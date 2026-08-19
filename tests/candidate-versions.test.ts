import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteDocument,
  documentById,
  documentHistory,
  ensureCandidate,
  renameDocument,
  restoreDocument,
  saveDocument,
} from "../src/core/candidate.ts";
import type { DB } from "../src/core/db/client.ts";
import { application, candidateDocument, company, job, source } from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * Regras do histórico de versões do currículo.
 *
 * O que está travado aqui não é código: são decisões de produto que, quando
 * violadas, só aparecem semanas depois e sem sintoma. Excluir a versão atual
 * deixa três telas sem conteúdo. Excluir uma versão citada pelo funil faz o
 * sistema afirmar ter enviado um documento que não existe mais — e continuar
 * parecendo íntegro, que é o pior modo de falhar de um registro de auditoria.
 *
 * Ver UI-02 em `docs/product/backlog.md`.
 */

let db: DB;
let candidateId: number;

const CV = "Andreus Timm\nSenior AI Software Architect\n" + "conteúdo de currículo ".repeat(10);

beforeEach(async () => {
  db = await useTestDb();
  candidateId = await ensureCandidate({ name: "Andreus Timm" });
});

afterEach(() => {
  releaseTestDb();
});

async function seedJobWithVariant(variant: string): Promise<void> {
  await db
    .insert(source)
    .values({ id: "greenhouse:acme", kind: "greenhouse", handle: "acme", label: "Acme" });
  const [c] = await db
    .insert(company)
    .values({ slug: "acme", name: "Acme" })
    .returning({ id: company.id });
  const [j] = await db
    .insert(job)
    .values({
      sourceId: "greenhouse:acme",
      companyId: c!.id,
      companyName: "Acme",
      externalId: "job-1",
      title: "Staff AI Engineer",
      url: "https://example.test/job-1",
      fingerprint: "fp-1",
      contentHash: "ch-1",
      raw: "{}",
    })
    .returning({ id: job.id });
  await db.insert(application).values({ jobId: j!.id, status: "applied", cvVariant: variant });
}

describe("saveDocument", () => {
  it("não cria versão quando o conteúdo não mudou", async () => {
    const first = await saveDocument({ candidateId, label: "v1", content: CV });
    const second = await saveDocument({ candidateId, label: "v2", content: CV });

    expect(second.unchanged).toBe(true);
    expect(second.id).toBe(first.id);
    // O rótulo NÃO muda por salvamento repetido: renomear é operação própria.
    expect(await documentHistory(candidateId)).toHaveLength(1);
  });

  it("cria versão quando o conteúdo mudou", async () => {
    await saveDocument({ candidateId, label: "v1", content: CV });
    await saveDocument({ candidateId, label: "v2", content: CV + " mais uma linha" });

    const history = await documentHistory(candidateId);
    expect(history).toHaveLength(2);
    expect(history.filter((h) => h.isCurrent)).toHaveLength(1);
  });
});

describe("renameDocument", () => {
  it("renomeia sem tocar no conteúdo", async () => {
    const { id } = await saveDocument({ candidateId, label: "ATS EN 2026-07", content: CV });

    expect(await renameDocument(candidateId, id, "  ATS EN — versão longa  ")).toEqual({ ok: true });

    const doc = await documentById(candidateId, id);
    expect(doc?.label).toBe("ATS EN — versão longa");
    expect(doc?.content).toBe(CV);
  });

  it("recusa rótulo vazio", async () => {
    const { id } = await saveDocument({ candidateId, label: "v1", content: CV });
    expect(await renameDocument(candidateId, id, "   ")).toEqual({ ok: false, error: "empty-label" });
  });

  it("recusa rótulo longo demais", async () => {
    const { id } = await saveDocument({ candidateId, label: "v1", content: CV });
    expect(await renameDocument(candidateId, id, "x".repeat(200))).toEqual({
      ok: false,
      error: "label-too-long",
    });
  });

  it("não alcança documento de outro candidato", async () => {
    const other = await ensureCandidate({ slug: "outro", name: "Outra Pessoa" });
    const { id } = await saveDocument({ candidateId: other, label: "alheio", content: CV });

    // O id vem de formulário, e id em formulário é pedido, não prova.
    expect(await renameDocument(candidateId, id, "sequestrado")).toEqual({
      ok: false,
      error: "not-found",
    });
    expect((await documentById(other, id))?.label).toBe("alheio");
  });
});

describe("deleteDocument", () => {
  it("recusa a versão atual", async () => {
    const { id } = await saveDocument({ candidateId, label: "v1", content: CV });

    // /candidate renderiza a partir dela, e as análises comparam contra ela.
    expect(await deleteDocument(candidateId, id)).toEqual({ ok: false, error: "is-current" });
    expect(await documentHistory(candidateId)).toHaveLength(1);
  });

  it("exclui uma versão antiga", async () => {
    const first = await saveDocument({ candidateId, label: "v1", content: CV });
    await saveDocument({ candidateId, label: "v2", content: CV + " mudou" });

    expect(await deleteDocument(candidateId, first.id)).toEqual({ ok: true });
    expect(await documentHistory(candidateId)).toHaveLength(1);
  });

  it("recusa versão que o funil diz ter enviado", async () => {
    const first = await saveDocument({ candidateId, label: "ATS EN 2026-07", content: CV });
    await saveDocument({ candidateId, label: "ATS EN 2026-08", content: CV + " mudou" });
    await seedJobWithVariant("ATS EN 2026-07");

    const result = await deleteDocument(candidateId, first.id);
    if (result.ok) throw new Error("esperava recusa");
    expect(result.error).toBe("referenced");
    // A recusa nomeia quem prende: "não dá" sem "por quê" vira suporte.
    expect(result.detail).toContain("Acme");

    expect(await documentById(candidateId, first.id)).not.toBeNull();
  });

  it("não alcança documento de outro candidato", async () => {
    const other = await ensureCandidate({ slug: "outro", name: "Outra Pessoa" });
    await saveDocument({ candidateId: other, label: "atual alheia", content: CV });
    const old = await saveDocument({ candidateId: other, label: "antiga alheia", content: CV + "x" });

    expect(await deleteDocument(candidateId, old.id)).toEqual({ ok: false, error: "not-found" });
  });
});

describe("restoreDocument", () => {
  it("acrescenta uma versão nova em vez de rebobinar o ponteiro", async () => {
    const first = await saveDocument({ candidateId, label: "julho", content: CV });
    await saveDocument({ candidateId, label: "agosto", content: CV + " agosto" });

    expect((await restoreDocument(candidateId, first.id, "julho (restaurada)")).ok).toBe(true);

    const history = await documentHistory(candidateId);
    expect(history).toHaveLength(3);

    // A última linha e o currículo atual continuam sendo a mesma coisa. Mover
    // `is_current` de volta manteria as linhas, mas faria o topo da lista
    // deixar de ser o estado corrente — e todo código que lê o topo mentiria.
    expect(history[0]?.isCurrent).toBe(true);
    expect(history[0]?.label).toBe("julho (restaurada)");

    const rows = await db
      .select()
      .from(candidateDocument)
      .where(eq(candidateDocument.isCurrent, true));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.content).toBe(CV);

    // A original continua lá: restaurar não consome o que se restaurou.
    expect(await documentById(candidateId, first.id)).not.toBeNull();
  });

  it("restaura mesmo quando o texto coincide com o da atual", async () => {
    const first = await saveDocument({ candidateId, label: "julho", content: CV });
    await saveDocument({ candidateId, label: "agosto", content: CV + " agosto" });
    // Volta ao conteúdo de julho por um caminho que não é a restauração.
    await saveDocument({ candidateId, label: "setembro", content: CV });

    // O guard de conteúdo idêntico existe para salvamento repetido, não para
    // restauração: pedir de volta uma versão anterior é intenção explícita.
    expect((await restoreDocument(candidateId, first.id, "julho (restaurada)")).ok).toBe(true);
    expect(await documentHistory(candidateId)).toHaveLength(4);
  });

  it("recusa restaurar a versão que já é a atual", async () => {
    const { id } = await saveDocument({ candidateId, label: "v1", content: CV });
    expect(await restoreDocument(candidateId, id, "v1 (restaurada)")).toEqual({
      ok: false,
      error: "is-current",
    });
  });

  it("não alcança documento de outro candidato", async () => {
    const other = await ensureCandidate({ slug: "outro", name: "Outra Pessoa" });
    await saveDocument({ candidateId: other, label: "atual", content: CV });
    const old = await saveDocument({ candidateId: other, label: "antiga", content: CV + "x" });

    expect(await restoreDocument(candidateId, old.id, "roubada")).toEqual({
      ok: false,
      error: "not-found",
    });
  });
});

describe("documentHistory", () => {
  it("ordena de forma estável quando o instante empata", async () => {
    const at = "2026-08-19T12:00:00.000Z";
    for (const label of ["a", "b", "c"]) {
      await db.insert(candidateDocument).values({
        candidateId,
        kind: "cv",
        label,
        content: CV + label,
        isCurrent: false,
        createdAt: at,
      });
    }

    // Várias versões no mesmo instante é o caso real: um import gera mais de
    // uma. Sem desempate a ordem varia entre dois carregamentos, e o usuário
    // clica na linha que não queria.
    const first = (await documentHistory(candidateId)).map((h) => h.label);
    const second = (await documentHistory(candidateId)).map((h) => h.label);
    expect(first).toEqual(second);
    expect(first).toEqual(["c", "b", "a"]);
  });
});
