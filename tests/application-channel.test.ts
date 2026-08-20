import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { application, company, job, source } from "../src/core/db/schema.ts";
import { setApplicationStatus } from "../src/core/db/repo.ts";
import { ensureCandidate } from "../src/core/candidate.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * Por onde a candidatura foi.
 *
 * `application.channel` existia desde o começo, o funil a renderizava, o
 * CLAUDE.md documentava `jho track <id> applied --channel referral` e o
 * `jho prep` imprimia exatamente essa linha como próximo passo — e nada no
 * sistema escrevia nela. A flag era aceita e descartada em silêncio.
 *
 * O custo não é de completude: referral é ~7% dos candidatos e ~40% das
 * contratações. Sem esse campo o funil não consegue medir a única alavanca que
 * o próprio produto diz ser a mais forte, e a pessoa que digitou o canal
 * acredita tê-lo registrado.
 */

let db: DB;
let candidateId: number;
let jobId: number;

beforeEach(async () => {
  db = await useTestDb();
  candidateId = await ensureCandidate({ name: "Andreus Timm" });
  await db.insert(source).values({ id: "lever:acme", kind: "lever", handle: "acme", label: "Acme" });
  await db.insert(company).values({ slug: "acme", name: "Acme" });
  const [row] = await db
    .insert(job)
    .values({
      sourceId: "lever:acme",
      companyName: "Acme",
      externalId: "job-1",
      title: "Staff AI Engineer",
      url: "https://example.test/1",
      fingerprint: "fp-1",
      contentHash: "ch-1",
      raw: "{}",
    })
    .returning({ id: job.id });
  jobId = row!.id;
});

afterEach(() => {
  releaseTestDb();
});

async function candidatura() {
  const [row] = await db
    .select()
    .from(application)
    .where(and(eq(application.candidateId, candidateId), eq(application.jobId, jobId)));
  return row;
}

describe("canal da candidatura", () => {
  it("é gravado ao criar", async () => {
    await setApplicationStatus(candidateId, jobId, "applied", undefined, "referral");
    expect((await candidatura())?.channel).toBe("referral");
  });

  it("fica nulo quando não informado", async () => {
    await setApplicationStatus(candidateId, jobId, "applied");
    expect((await candidatura())?.channel).toBeNull();
  });

  it("é gravado numa transição posterior", async () => {
    // Caminho legal da máquina de estados: shortlisted → preparing → applied.
    await setApplicationStatus(candidateId, jobId, "shortlisted");
    await setApplicationStatus(candidateId, jobId, "preparing");
    await setApplicationStatus(candidateId, jobId, "applied", undefined, "referral");
    expect((await candidatura())?.channel).toBe("referral");
  });

  it("é gravado MESMO quando o status não muda", async () => {
    // O canal é propriedade da candidatura, não da transição: registrar que uma
    // candidatura já enviada saiu por referral é informação nova sobre um fato
    // antigo. Sair cedo por "nada mudou" descartaria o que a pessoa informou.
    await setApplicationStatus(candidateId, jobId, "applied");
    await setApplicationStatus(candidateId, jobId, "applied", undefined, "referral");
    expect((await candidatura())?.channel).toBe("referral");
  });

  it("um track SEM canal não apaga o que já estava lá", async () => {
    // Sobrescrever com null transformaria cada mudança de status numa perda
    // silenciosa do dado mais valioso do funil.
    await setApplicationStatus(candidateId, jobId, "applied", undefined, "referral");
    await setApplicationStatus(candidateId, jobId, "screening");
    expect((await candidatura())?.channel).toBe("referral");
  });

  it("um canal novo substitui o anterior", async () => {
    await setApplicationStatus(candidateId, jobId, "applied", undefined, "ats");
    await setApplicationStatus(candidateId, jobId, "screening", undefined, "referral");
    expect((await candidatura())?.channel).toBe("referral");
  });
});
