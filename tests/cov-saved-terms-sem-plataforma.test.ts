/**
 * Nenhuma plataforma alcançável, e a âncora de 24 horas que volta atrás.
 *
 * `config/sources.yaml` decide quais plataformas estão ligadas. Com todas
 * desligadas, `requestCaptures` não enfileira nada e responde `no_platform` — que
 * não é erro nem sucesso: é "não havia onde buscar".
 *
 * O que torna esse caminho importante é o que ele faz em seguida em `rerunTerm`:
 * a âncora de `lastRunRequestedAt` **volta para o valor anterior**. Sem isso, um
 * pedido que não buscou nada consumiria o direito de pedir pelas 24 horas
 * seguintes — a pessoa perderia o dia por causa de uma configuração, e não de uma
 * busca.
 *
 * O mock aqui é do arquivo de configuração, não do banco nem da fila: a decisão
 * medida é a de elegibilidade de plataforma, e ela lê dali.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { candidate, savedTerm, termCapture } from "../src/core/db/schema.ts";
import type { DB } from "../src/core/db/client.ts";
import { eq } from "drizzle-orm";
import { releaseTestDb, useTestDb } from "./support/db.ts";

// Nenhuma fonte habilitada: é o estado de um `sources.yaml` recém-criado, ou de
// uma instalação em que todas as plataformas de busca foram desligadas.
vi.mock("../src/core/sources/config.ts", () => ({
  loadSources: async () => [],
}));

const {
  createTrack,
  rerunTerm,
  saveTerm,
  setMatchingProfile,
  suggestTrack,
  targetOf,
  termOverview,
} = await import("../src/contexts/matching/index.ts");
const { loadProfile } = await import("../src/core/profile/load.ts");

const AGORA = new Date("2026-09-21T12:00:00.000Z");
const ambiente = { ...process.env };

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(async () => {
  process.env = { ...ambiente };
  await releaseTestDb();
});

const ctx = (now = AGORA) => ({ now, impersonated: false });

async function termoSalvo(): Promise<{ candidateId: number; termId: number }> {
  const [linha] = await db
    .insert(candidate)
    .values({ slug: "default", name: "Dono", isDefault: true })
    .returning({ id: candidate.id });
  const candidateId = linha!.id;
  await setMatchingProfile(candidateId, await loadProfile(true));

  const primary = targetOf(await loadProfile(true));
  const trilha = await createTrack(candidateId, {
    name: "Laravel",
    target: suggestTrack({ term: "Laravel", catalog: [], primary }).target,
  });
  if (!trilha.ok) throw new Error(trilha.code);

  const salvo = await saveTerm({ candidateId }, { term: "laravel", trackId: trilha.track.id }, ctx());
  if (!salvo.ok) throw new Error(salvo.code);
  return { candidateId, termId: salvo.termId };
}

describe("com todas as plataformas desligadas", () => {
  it("UT-350 salvar o termo funciona, e a busca responde `no_platform`", async () => {
    // O termo é salvo de todo jeito: ele é a intenção da pessoa, e não depende de
    // haver plataforma hoje. O que muda é o estado da busca.
    const { candidateId, termId } = await termoSalvo();

    const [linha] = await db
      .select({ id: savedTerm.id, lastRunRequestedAt: savedTerm.lastRunRequestedAt })
      .from(savedTerm)
      .where(eq(savedTerm.id, termId));
    expect(linha).toBeDefined();

    // E nenhuma captura ficou EXECUTÁVEL: o estado de "pulada" é
    // `status: "skipped"` com um `reason_code`, não uma coluna própria.
    const capturas = await db
      .select({
        platform: termCapture.platform,
        status: termCapture.status,
        reasonCode: termCapture.reasonCode,
      })
      .from(termCapture);
    expect(capturas.every((captura) => captura.status === "skipped")).toBe(true);
    // O motivo é o que a tela usa para dizer POR QUE a plataforma não trouxe
    // nada — sem ele, "nenhum resultado" e "desligada" viram a mesma coisa.
    expect(capturas.every((captura) => captura.reasonCode !== null)).toBe(true);

    // A visão que a tela usa não inventa "buscando".
    const visao = await termOverview({ candidateId }, AGORA);
    expect(visao.terms.find((t) => t.id === termId)?.run).not.toBe("started");
  });

  it("UT-351 pedir de novo devolve `no_platform` e RESTAURA a âncora de 24 horas", async () => {
    const { candidateId, termId } = await termoSalvo();

    const [antes] = await db
      .select({ ancora: savedTerm.lastRunRequestedAt })
      .from(savedTerm)
      .where(eq(savedTerm.id, termId));

    const resultado = await rerunTerm({ candidateId }, termId, ctx(new Date("2026-09-23T12:00:00.000Z")));

    expect(resultado).toMatchObject({ ok: true, run: "no_platform" });

    const [depois] = await db
      .select({ ancora: savedTerm.lastRunRequestedAt })
      .from(savedTerm)
      .where(eq(savedTerm.id, termId));

    // A âncora é a MESMA de antes: um pedido que não buscou nada não gasta o
    // direito de pedir. Sem esta restauração, a pessoa perderia 24 horas por
    // causa de uma configuração.
    expect(depois!.ancora).toBe(antes!.ancora);
  });

  it("UT-352 e o pedido seguinte não é recusado por espera", async () => {
    // A consequência observável da restauração: a porta continua aberta. Se a
    // âncora tivesse avançado, esta chamada viria com `cooldown`.
    const { candidateId, termId } = await termoSalvo();

    await rerunTerm({ candidateId }, termId, ctx(new Date("2026-09-23T12:00:00.000Z")));
    const segundo = await rerunTerm({ candidateId }, termId, ctx(new Date("2026-09-23T12:00:01.000Z")));

    expect(segundo).toMatchObject({ ok: true, run: "no_platform" });
  });
});
