import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetClock, setClock } from "../src/core/clock.ts";
import { createUser, type Session } from "../src/contexts/auth/index.ts";
import { createTrack, listCandidateTracks, suggestTrack, targetOf } from "../src/contexts/matching/index.ts";
import { seedCatalog } from "../src/contexts/skills/index.ts";
import { documentHistory, saveDocument } from "../src/core/candidate.ts";
import { loadProfile } from "../src/core/profile/load.ts";
import type { DB } from "../src/core/db/client.ts";
import { authUser, candidate, job, jobScore, scoreTask, source } from "../src/core/db/schema.ts";
import {
  candidateScoreQueueStatus,
  enqueueScore,
  runScoreQueue,
  scoreQueueDisplay,
} from "../src/core/scoring/queue.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * Candidato novo ganha trilha e nota em minutos, não na varredura do dia
 * seguinte (#280).
 *
 * Três peças, e cada uma tem um jeito de falhar em silêncio:
 *
 * - a fatia com prazo, que precisa parar ENTRE lotes, devolver a tarefa sem
 *   gastar tentativa e avançar sempre — senão um acervo grande nunca termina,
 *   ou termina marcado como falha;
 * - toda entrada de currículo, que precisa enfileirar E agendar a fatia depois
 *   da resposta — uma ação nova que esqueça a segunda metade volta a deixar a
 *   pessoa sem trilha até amanhã, e nada na tela acusa;
 * - a rota por segredo que o agendador chama para continuar o que não coube.
 */

const state = vi.hoisted(() => ({
  session: null as unknown,
  candidateId: 0,
  after: [] as Array<() => Promise<void> | void>,
  pdfText: "",
}));

vi.mock("../app/auth", async () => {
  const { authorize } = await import("../src/contexts/auth/index.ts");
  return {
    guard: async (action: Parameters<typeof authorize>[1]) => {
      authorize(state.session as Session | null, action, { kind: "global" });
      return state.session;
    },
    guardOwnCandidate: async () => ({ session: state.session, candidateId: state.candidateId }),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (callback: () => Promise<void> | void) => void state.after.push(callback),
}));
vi.mock("../src/core/pdf.ts", async (original) => ({
  ...(await original<typeof import("../src/core/pdf.ts")>()),
  readCvPdf: async () => ({ ok: true, text: state.pdfText, label: "cv" }),
}));

const actions = await import("../app/candidate/actions.ts");
const { GET } = await import("../app/api/cron/varredura/route.ts");

let db: DB;

const CURRICULO = [
  "Maria Souza — Senior AI Software Architect.",
  "Construí plataformas com rag e agentes em produção, com evals e guardrails.",
  "Experiência com typescript, python e postgres em ambientes multi-tenant.",
].join("\n");

/** Passa do mínimo de caracteres e não cita skill nenhuma do catálogo. */
const CURRICULO_FRACO = "Pessoa dedicada, pontual e comunicativa, com vontade de aprender coisas novas todos os dias da semana.";

const ORIGINAL_SECRET = process.env.CRON_SECRET;

beforeEach(async () => {
  db = await useTestDb();
  state.after = [];
  state.session = null;
  state.candidateId = 0;
  delete process.env.CRON_SECRET;
});

afterEach(async () => {
  resetClock();
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
  await releaseTestDb();
});

async function semearVagas(n: number): Promise<void> {
  await db
    .insert(source)
    .values({ id: "manual:fatia", kind: "manual", handle: "fatia", label: "Fatia" })
    .onConflictDoNothing();
  await db.insert(job).values(
    Array.from({ length: n }, (_, i) => ({
      sourceId: "manual:fatia",
      companyName: "Acme",
      externalId: `v${i}`,
      title: "AI Solutions Architect",
      descriptionText: "Remote LATAM. rag, agentes, typescript, python, postgres, multi-tenant.",
      locationRaw: "Remote LATAM",
      url: `manual://fatia/v${i}`,
      fingerprint: `v${i}`,
      contentHash: `v${i}`,
      raw: "{}",
    })),
  );
}

async function criarCandidato(slug: string): Promise<number> {
  const [c] = await db.insert(candidate).values({ slug, name: slug }).returning({ id: candidate.id });
  return c!.id;
}

async function tarefaDe(candidateId: number) {
  const [tarefa] = await db.select().from(scoreTask).where(eq(scoreTask.candidateId, candidateId));
  return tarefa;
}

async function notasDe(candidateId: number): Promise<number> {
  return (await db.select().from(jobScore).where(eq(jobScore.candidateId, candidateId))).length;
}

/** Relógio que anda um segundo a cada leitura: qualquer prazo curto vence entre dois lotes. */
function relogioQueCorre(): void {
  let agora = Date.parse("2026-09-23T12:00:00.000Z");
  setClock({
    now: () => (agora += 1_000),
    iso: () => new Date(agora).toISOString(),
  });
}

async function rodarDepoisDaResposta(): Promise<void> {
  const agendadas = state.after;
  state.after = [];
  for (const callback of agendadas) await callback();
}

describe("a fatia com prazo", () => {
  it("para entre lotes, devolve a tarefa sem gastar tentativa e termina nas fatias seguintes", async () => {
    await seedCatalog();
    await semearVagas(250);
    const id = await criarCandidato("maria");
    await saveDocument({ candidateId: id, label: "cv", content: CURRICULO });
    relogioQueCorre();

    const primeira = await runScoreQueue({ budgetMs: 1, worker: "teste" });

    // Um lote de 100 gravado, e a tarefa de volta à fila — não `failed`, não
    // `done`: o acervo só não coube, nada quebrou.
    expect(primeira).toMatchObject({ pontuadas: 100, adiadas: 1, interrompida: true, falhas: 0 });
    expect(await notasDe(id)).toBe(100);
    expect(await tarefaDe(id)).toMatchObject({ status: "pending", attempts: 0, scored: 100, claimedBy: null });

    // A trilha principal já existe depois da primeira fatia: é o que a tela
    // precisa para deixar de dizer "sem perfil".
    expect((await listCandidateTracks(id)).some((track) => track.isPrimary)).toBe(true);

    await runScoreQueue({ budgetMs: 1, worker: "teste" });
    const ultima = await runScoreQueue({ budgetMs: 1, worker: "teste" });

    // A terceira recomeça pelo que ainda está desatualizado, sem refazer nota.
    expect(ultima).toMatchObject({ pontuadas: 50, adiadas: 0, processadas: 1 });
    expect(await notasDe(id)).toBe(250);
    // O total é do pedido inteiro, somado entre as fatias.
    expect(await tarefaDe(id)).toMatchObject({ status: "done", scored: 250, lastError: null });
  });

  it("página inteira fora do alvo de uma trilha aceita não prende a fatia num laço", async () => {
    // A trilha PHP não é relevante para nenhuma destas vagas: a página não
    // grava nada. Parar no fim dela devolveria a tarefa à fila, e a fatia
    // seguinte recomeçaria da mesma página — para sempre.
    await seedCatalog();
    await semearVagas(1_100);
    const id = await criarCandidato("maria");
    await saveDocument({ candidateId: id, label: "cv", content: CURRICULO });
    await runScoreQueue({ worker: "teste" });
    const trilha = await createTrack(id, {
      name: "PHP",
      target: suggestTrack({ term: "PHP", catalog: [], primary: targetOf(await loadProfile(true)) }).target,
    });
    expect(trilha.ok).toBe(true);
    relogioQueCorre();

    const r = await runScoreQueue({ budgetMs: 1, worker: "teste" });

    expect(r).toMatchObject({ adiadas: 0, processadas: 1 });
    expect((await tarefaDe(id))!.status).toBe("done");
  });

  it("sem prazo drena tudo de uma vez, como a varredura e a CLI fazem", async () => {
    await seedCatalog();
    await semearVagas(250);
    const id = await criarCandidato("maria");
    await saveDocument({ candidateId: id, label: "cv", content: CURRICULO });
    relogioQueCorre();

    expect(await runScoreQueue({ worker: "teste" })).toMatchObject({ pontuadas: 250, adiadas: 0, interrompida: false });
    expect(await tarefaDe(id)).toMatchObject({ status: "done", scored: 250 });
  });

  it("depois do prazo não reivindica a tarefa seguinte, e diz que parou por isso", async () => {
    await seedCatalog();
    await semearVagas(1);
    const a = await criarCandidato("a");
    const b = await criarCandidato("b");
    await enqueueScore(a);
    await enqueueScore(b);
    relogioQueCorre();

    const r = await runScoreQueue({ budgetMs: 1, worker: "teste" });

    expect(r).toMatchObject({ processadas: 1, interrompida: true });
    expect((await tarefaDe(b))!.status).toBe("pending");
  });

  it("pedido novo zera a contagem das fatias anteriores", async () => {
    const id = await criarCandidato("maria");
    await enqueueScore(id);
    await db.update(scoreTask).set({ status: "done", scored: 999 }).where(eq(scoreTask.candidateId, id));

    await enqueueScore(id);

    expect((await tarefaDe(id))!.scored).toBeNull();
  });
});

describe("recusa visível", () => {
  it("currículo sem skill reconhecida vira `refused` com motivo, não `failed` genérico", async () => {
    await seedCatalog();
    await semearVagas(1);
    const id = await criarCandidato("maria");
    await saveDocument({ candidateId: id, label: "cv", content: CURRICULO_FRACO });

    await runScoreQueue({ worker: "teste" });

    expect(scoreQueueDisplay(await candidateScoreQueueStatus(id))).toEqual({
      state: "refused",
      scored: 0,
      reason: "weakCv",
    });
    expect(await notasDe(id)).toBe(0);
  });

  it("cada código gravado tem o seu motivo; erro de verdade continua `failed`", () => {
    const concluida = (lastError: string) => ({ pending: 0, scoring: 0, done: 1, failed: 0, scored: 0, lastError });

    expect(scoreQueueDisplay(concluida("sem-curriculo"))).toMatchObject({ state: "refused", reason: "noCv" });
    expect(scoreQueueDisplay(concluida("curriculo-fraco"))).toMatchObject({ state: "refused", reason: "weakCv" });
    expect(scoreQueueDisplay(concluida("catalogo-vazio"))).toMatchObject({ state: "refused", reason: "emptyCatalog" });
    // Erro cujo texto coincide com uma propriedade herdada de objeto não pode
    // virar recusa por acidente da busca na tabela.
    expect(scoreQueueDisplay(concluida("constructor"))).toEqual({ state: "failed", scored: 0 });
    expect(scoreQueueDisplay(concluida("conexão perdida"))).toEqual({ state: "failed", scored: 0 });
  });
});

describe("toda entrada de currículo enfileira E pontua depois da resposta", () => {
  function form(fields: Record<string, string | Blob>): FormData {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  }

  /** O critério de aceite da #280: trilha principal e nota logo depois de salvar. */
  async function esperarTrilhaENotas(candidateId: number): Promise<void> {
    expect((await tarefaDe(candidateId))?.status).toBe("pending");
    expect(state.after).toHaveLength(1);

    await rodarDepoisDaResposta();

    expect(await tarefaDe(candidateId)).toMatchObject({ status: "done", scored: 3, lastError: null });
    expect((await listCandidateTracks(candidateId)).some((track) => track.isPrimary)).toBe(true);
    expect(await notasDe(candidateId)).toBe(3);
  }

  beforeEach(async () => {
    await seedCatalog();
    await semearVagas(3);
  });

  it("colar o currículo (saveCvAction)", async () => {
    state.candidateId = await criarCandidato("maria");
    await actions.saveCvAction(form({ content: CURRICULO }));
    await esperarTrilhaENotas(state.candidateId);
  });

  it("importar o PDF (importPdfAction)", async () => {
    state.candidateId = await criarCandidato("maria");
    state.pdfText = CURRICULO;
    await actions.importPdfAction(form({ file: new File(["%PDF"], "cv.pdf", { type: "application/pdf" }) }));
    await esperarTrilhaENotas(state.candidateId);
  });

  it("restaurar uma versão anterior (restoreVersionAction)", async () => {
    const id = await criarCandidato("maria");
    state.candidateId = id;
    await saveDocument({ candidateId: id, label: "boa", content: CURRICULO });
    await saveDocument({ candidateId: id, label: "fraca", content: CURRICULO_FRACO });
    await runScoreQueue({ worker: "teste" });
    const anterior = (await documentHistory(id)).find((doc) => doc.label === "boa")!;

    expect(await actions.restoreVersionAction(anterior.id, "boa (restaurada)")).toEqual({ ok: true });
    await esperarTrilhaENotas(id);
  });

  async function sessaoDeContaNova(): Promise<number> {
    const { id: userId } = await createUser({ email: "maria@local.test", roles: ["candidate"] });
    state.session = {
      userId,
      candidateId: null,
      roles: ["candidate"],
      email: "maria@local.test",
      fullName: null,
      expiresAt: "2999-01-01T00:00:00.000Z",
      linkedCandidateIds: [],
      impersonatedBy: null,
    } satisfies Session;
    return userId;
  }

  async function candidatoDaConta(userId: number): Promise<number> {
    const [conta] = await db.select({ candidateId: authUser.candidateId }).from(authUser).where(eq(authUser.id, userId));
    return conta!.candidateId!;
  }

  it("criar o perfil colando o currículo (createProfileAction)", async () => {
    const userId = await sessaoDeContaNova();
    expect(await actions.createProfileAction(form({ name: "Maria Souza", cv: CURRICULO }))).toEqual({ ok: true });
    await esperarTrilhaENotas(await candidatoDaConta(userId));
  });

  it("criar o perfil enviando o PDF (createProfileAction, #278)", async () => {
    const userId = await sessaoDeContaNova();
    state.pdfText = CURRICULO;
    const pdf = new File(["%PDF"], "cv.pdf", { type: "application/pdf" });
    expect(await actions.createProfileAction(form({ name: "Maria Souza", cvFile: pdf }))).toMatchObject({ ok: true });
    await esperarTrilhaENotas(await candidatoDaConta(userId));
  });

  it("currículo fraco não fica mudo: a fatia roda e a tela recebe o motivo", async () => {
    state.candidateId = await criarCandidato("maria");
    await actions.saveCvAction(form({ content: CURRICULO_FRACO }));
    await rodarDepoisDaResposta();

    expect(scoreQueueDisplay(await candidateScoreQueueStatus(state.candidateId))).toMatchObject({
      state: "refused",
      reason: "weakCv",
    });
  });

  it("nenhuma action que grava currículo esquece de agendar a fatia", () => {
    // Rede estática para a PRÓXIMA entrada de currículo: uma action nova que
    // enfileire sem agendar a fatia devolveria a pessoa à espera da varredura
    // do dia seguinte, e nenhum teste de comportamento existente a veria.
    const ENFILEIRAM = /\b(saveDocument|restoreDocument|createOwnCandidate|requestCvRescore)\b/;
    const arquivos: string[] = [];
    const andar = (dir: string) => {
      for (const nome of readdirSync(dir)) {
        const caminho = join(dir, nome);
        if (statSync(caminho).isDirectory()) andar(caminho);
        else if (/\.tsx?$/.test(nome)) arquivos.push(caminho);
      }
    };
    andar("app");

    const faltando: string[] = [];
    const conferidas: string[] = [];
    for (const arquivo of arquivos) {
      const codigo = readFileSync(arquivo, "utf8");
      if (!codigo.includes('"use server"')) continue;
      for (const match of codigo.matchAll(/export async function (\w+)\s*\(/g)) {
        const corpo = codigo.slice(match.index, codigo.indexOf("\n}", match.index));
        if (!ENFILEIRAM.test(corpo)) continue;
        conferidas.push(`${arquivo}: ${match[1]}`);
        if (!/scoreAfterResponse\(\)/.test(corpo)) faltando.push(`${arquivo}: ${match[1]}`);
      }
    }

    expect(conferidas.length).toBeGreaterThanOrEqual(4);
    expect(faltando).toEqual([]);
  });
});

describe("a fatia `repontuar` que o agendador chama", () => {
  function pedido(authorization?: string): NextRequest {
    return new NextRequest("https://exemplo.test/api/cron/varredura?fatia=repontuar", {
      headers: authorization ? { authorization } : {},
    });
  }

  it("recusada não trabalha: a tarefa segue esperando", async () => {
    process.env.CRON_SECRET = "segredo-de-verdade";
    const id = await criarCandidato("maria");
    await enqueueScore(id);

    expect((await GET(pedido("Bearer outro"))).status).toBe(401);
    expect((await tarefaDe(id))!.status).toBe("pending");
  });

  it("com o segredo, drena a fila e diz o que fez e o que falta; chamar de novo é seguro", async () => {
    await seedCatalog();
    await semearVagas(3);
    const id = await criarCandidato("maria");
    await saveDocument({ candidateId: id, label: "cv", content: CURRICULO });
    process.env.CRON_SECRET = "segredo-de-verdade";

    const r = await GET(pedido("Bearer segredo-de-verdade"));

    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      slice: "repontuar",
      items: 1,
      errors: 0,
      detail: { scored: 3, deferred: 0, pending: 0 },
    });
    expect(await tarefaDe(id)).toMatchObject({ status: "done", scored: 3 });
    expect(await (await GET(pedido("Bearer segredo-de-verdade"))).json()).toMatchObject({
      items: 0,
      detail: { scored: 0, pending: 0 },
    });
    expect(await notasDe(id)).toBe(3);
  });
});
