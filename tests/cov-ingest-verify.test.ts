/**
 * Suíte: `src/core/ingest/verify.ts` — a varredura em lote que reconfere links.
 *
 * O problema medido no acervo real: 5 de 26 links do Jobgether devolvem 404
 * enquanto a API ainda os lista como abertos. Um quadro em que um link em cada
 * cinco está morto é um quadro em que se para de confiar — e o custo não é o
 * clique perdido, é passar a duvidar também do ranking.
 *
 * > **Invariante:** só 404 e 410 fecham. Bloqueio de robô (401/403/429), 5xx e
 * > falha de rede não decidem nada. Um fechamento errado some com a vaga sem
 * > aviso e não se desfaz sozinho.
 *
 * Fronteira DENTRO: seleção de candidatas, concorrência, contagem por fonte e
 * escrita de `closed_at`.
 * Fronteira FORA: rede (via `fetchImpl`) e DNS (via `lookupHost`) — nenhum caso
 * abre socket. A classificação de código HTTP em si é de `probe.ts`, testada em
 * `verify-queue.test.ts`.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { candidate, company, job, jobScore, source } from "../src/core/db/schema.ts";
import { verifyJobs } from "../src/core/ingest/verify.ts";
import type { LookupHost } from "../src/core/remote-url.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;
let candidateId: number;
let sequencia = 0;

/** DNS falso que resolve tudo para um endereço público, longe da rede interna. */
const lookupPublico: LookupHost = async () => [{ address: "93.184.216.34", family: 4 }];

/** Responde por URL, para um único lote poder misturar veredictos. */
function fetchPorUrl(porUrl: Record<string, number>, padrao = 200): typeof fetch {
  return (async (input: string | URL) => {
    const url = String(input);
    const achado = Object.entries(porUrl).find(([chave]) => url.includes(chave));
    return new Response(null, { status: achado?.[1] ?? padrao });
  }) as unknown as typeof fetch;
}

beforeEach(async () => {
  db = await useTestDb();
  sequencia = 0;
  await db.insert(company).values({ slug: "acme", name: "Acme" });
  const [pessoa] = await db
    .insert(candidate)
    .values({ slug: "dono", name: "Dono", isDefault: true })
    .returning({ id: candidate.id });
  candidateId = pessoa!.id;
});

afterEach(() => {
  releaseTestDb();
});

async function seedVaga(opts: {
  fit?: number;
  sourceId?: string;
  url?: string;
  applyUrl?: string | null;
}): Promise<number> {
  sequencia++;
  const sourceId = opts.sourceId ?? "lever:acme";
  await db
    .insert(source)
    .values({
      id: sourceId,
      kind: sourceId.split(":")[0]!,
      handle: sourceId.split(":")[1]!,
      label: sourceId,
    })
    .onConflictDoNothing();
  const [linha] = await db
    .insert(job)
    .values({
      sourceId,
      companyName: "Acme",
      externalId: `ext-${sequencia}`,
      title: `Vaga ${sequencia}`,
      url: opts.url ?? `https://exemplo.test/${sequencia}`,
      applyUrl: opts.applyUrl === undefined ? null : opts.applyUrl,
      fingerprint: `fp-${sequencia}`,
      contentHash: `ch-${sequencia}`,
      raw: "{}",
    })
    .returning({ id: job.id });
  if (opts.fit !== undefined) {
    await db.insert(jobScore).values({
      candidateId,
      jobId: linha!.id,
      fit: opts.fit,
      titleScore: opts.fit,
      keywordScore: 0,
      seniorityScore: 0,
      geoScore: 0,
      compScore: 0,
      freshnessScore: 0,
      benefitScore: 0,
      penalty: 0,
      cluster: "architect",
      matchedKeywords: [],
      missingKeywords: [],
      detectedBenefits: [],
      ageDays: null,
      reasons: [],
      blockers: [],
      scorerVersion: "teste",
    });
  }
  return linha!.id;
}

const opcoesBase = { delayMs: 0, lookupHost: lookupPublico, concurrency: 2 };

describe("verifyJobs", () => {
  it("fecha só o que provou ausência e deixa o resto intacto", async () => {
    // Os três veredictos no mesmo lote, porque é assim que um lote real é. O 403
    // é o caso caro: o Himalayas responde assim em toda requisição, e fechar
    // nele apagaria uma fonte viva inteira.
    const morta = await seedVaga({ fit: 90, url: "https://exemplo.test/morta" });
    const viva = await seedVaga({ fit: 80, url: "https://exemplo.test/viva" });
    const barrada = await seedVaga({ fit: 70, url: "https://exemplo.test/barrada" });
    const instavel = await seedVaga({ fit: 60, url: "https://exemplo.test/instavel" });

    const r = await verifyJobs({
      ...opcoesBase,
      fetchImpl: fetchPorUrl({
        morta: 410,
        viva: 200,
        barrada: 403,
        instavel: 503,
      }),
    });

    expect(r).toMatchObject({ checked: 4, gone: 1, alive: 1, inconclusive: 2 });
    const linhas = await db.select().from(job);
    const fechadas = linhas.filter((l) => l.closedAt !== null).map((l) => l.id);
    expect(fechadas).toEqual([morta]);
    expect([viva, barrada, instavel].every((id) => !fechadas.includes(id))).toBe(true);
  });

  it("agrupa o resultado pelo tipo de fonte, que é o que se decide desligar", async () => {
    // O recorte por `kind` é o que responde "vale manter esta fonte?". Agrupar
    // pelo id inteiro daria um grupo por board e nenhuma comparação.
    await seedVaga({ fit: 90, sourceId: "lever:jobgether", url: "https://exemplo.test/a-morta" });
    await seedVaga({ fit: 90, sourceId: "lever:outro", url: "https://exemplo.test/b-morta" });
    await seedVaga({ fit: 90, sourceId: "ashby:acme", url: "https://exemplo.test/c-viva" });

    const r = await verifyJobs({
      ...opcoesBase,
      fetchImpl: fetchPorUrl({ morta: 404, viva: 200 }),
    });

    expect(r.bySource).toEqual({
      lever: { gone: 2, alive: 0, inconclusive: 0 },
      ashby: { gone: 0, alive: 1, inconclusive: 0 },
    });
  });

  it("conta sem fechar quando é ensaio", async () => {
    // `--dry-run` existe porque o resultado desta varredura é destrutivo do
    // ponto de vista de quem usa. Ver o que seria fechado antes de fechar é a
    // única forma de auditar a regra contra o acervo real.
    const jobId = await seedVaga({ fit: 90 });

    const r = await verifyJobs({
      ...opcoesBase,
      dryRun: true,
      fetchImpl: fetchPorUrl({}, 404),
    });

    expect(r.gone).toBe(1);
    const [linha] = await db.select().from(job).where(eq(job.id, jobId));
    expect(linha!.closedAt).toBeNull();
  });

  it("verifica só o que o usuário poderia clicar, do melhor fit para o pior", async () => {
    // Conferir 6.000 links para policiar linhas que ninguém vai ver seria
    // grosseria com os boards e desperdício aqui. O corte padrão é 55.
    await seedVaga({ fit: 90, url: "https://exemplo.test/alta" });
    await seedVaga({ fit: 56, url: "https://exemplo.test/no-limite" });
    await seedVaga({ fit: 20, url: "https://exemplo.test/baixa" });
    await seedVaga({ url: "https://exemplo.test/sem-score" });
    const visitadas: string[] = [];

    const r = await verifyJobs({
      ...opcoesBase,
      concurrency: 1,
      fetchImpl: (async (input: string | URL) => {
        visitadas.push(String(input));
        return new Response(null, { status: 200 });
      }) as unknown as typeof fetch,
    });

    expect(r.checked).toBe(2);
    expect(visitadas).toEqual([
      "https://exemplo.test/alta",
      "https://exemplo.test/no-limite",
    ]);
  });

  it("aceita um corte mais baixo para varrer o acervo inteiro", async () => {
    // Vaga sem score fica de fora mesmo com corte zero: `coalesce(..., 0) >= 0`
    // a incluiria, e é isso que o caso fixa — o corte é sobre pontuação, não
    // sobre existência de pontuação.
    await seedVaga({ fit: 10, url: "https://exemplo.test/baixa" });
    await seedVaga({ url: "https://exemplo.test/sem-score" });

    const r = await verifyJobs({ ...opcoesBase, minFit: 0, fetchImpl: fetchPorUrl({}, 200) });

    expect(r.checked).toBe(2);
  });

  it("ignora URL sintética sem gastar o limite com ela", async () => {
    // Vaga de comparação manual tem `manual://local/...` como origem. Ela nunca
    // pode chegar ao fetch; e o filtro acontece antes do corte por limite, senão
    // uma linha inverificável consumiria a vez de uma verificável.
    await seedVaga({ fit: 90, url: "manual://local/abc" });
    await seedVaga({ fit: 85, url: "https://exemplo.test/real" });
    const visitadas: string[] = [];

    const r = await verifyJobs({
      ...opcoesBase,
      limit: 1,
      fetchImpl: (async (input: string | URL) => {
        visitadas.push(String(input));
        return new Response(null, { status: 200 });
      }) as unknown as typeof fetch,
    });

    expect(r.checked).toBe(1);
    expect(visitadas).toEqual(["https://exemplo.test/real"]);
  });

  it("descarta URL malformada que passou pelo filtro grosseiro de prefixo", async () => {
    // O SQL só compara prefixo: `https://` sozinho casa com `like 'https://%'` e
    // ainda assim não é URL. Por isso a análise acontece depois do filtro e
    // antes do corte por limite — do contrário uma linha impossível de conferir
    // ocuparia a vez de uma conferível, e o valor iria parar dentro de um fetch.
    await seedVaga({ fit: 95, url: "https://" });
    await seedVaga({ fit: 85, url: "https://exemplo.test/real" });
    const visitadas: string[] = [];

    const r = await verifyJobs({
      ...opcoesBase,
      limit: 1,
      fetchImpl: (async (input: string | URL) => {
        visitadas.push(String(input));
        return new Response(null, { status: 200 });
      }) as unknown as typeof fetch,
    });

    expect(r.checked).toBe(1);
    expect(visitadas).toEqual(["https://exemplo.test/real"]);
  });

  it("espaça as requisições e limita a concorrência por padrão", async () => {
    // Estes boards são serviços gratuitos de terceiros. Os padrões — quatro em
    // paralelo, 250 ms entre uma e outra — são a diferença entre conferir links
    // e ser confundido com um raspador.
    await seedVaga({ fit: 90 });
    const inicio = Date.now();

    const r = await verifyJobs({
      lookupHost: lookupPublico,
      fetchImpl: fetchPorUrl({}, 200),
    });

    expect(r.checked).toBe(1);
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(200);
  });

  it("confere o link de candidatura quando ele existe, não o do anúncio", async () => {
    // É o link que a pessoa vai abrir. O do anúncio pode continuar de pé num
    // agregador depois de o formulário do empregador sair do ar.
    await seedVaga({
      fit: 90,
      url: "https://exemplo.test/anuncio",
      applyUrl: "https://exemplo.test/candidatura",
    });
    const visitadas: string[] = [];

    await verifyJobs({
      ...opcoesBase,
      fetchImpl: (async (input: string | URL) => {
        visitadas.push(String(input));
        return new Response(null, { status: 200 });
      }) as unknown as typeof fetch,
    });

    expect(visitadas).toEqual(["https://exemplo.test/candidatura"]);
  });

  it("reporta progresso contra o total realmente verificável", async () => {
    // A barra da CLI usa esses dois números. Se o total fosse o de candidatas
    // brutas, ela pararia antes do fim toda vez que houvesse URL sintética.
    await seedVaga({ fit: 90, url: "manual://local/abc" });
    await seedVaga({ fit: 85 });
    await seedVaga({ fit: 80 });
    const progresso: Array<[number, number]> = [];

    await verifyJobs({
      ...opcoesBase,
      concurrency: 1,
      fetchImpl: fetchPorUrl({}, 200),
      onProgress: (feito, total) => progresso.push([feito, total]),
    });

    expect(progresso).toEqual([[1, 2], [2, 2]]);
  });

  it("não fecha vaga já fechada nem a reabre", async () => {
    // Vaga fechada saiu do quadro; reconferi-la gastaria requisição para
    // confirmar o que já se sabe, e um 200 acidental a traria de volta.
    const jobId = await seedVaga({ fit: 90 });
    await db
      .update(job)
      .set({ closedAt: "2026-01-01T00:00:00.000Z" })
      .where(eq(job.id, jobId));

    const r = await verifyJobs({ ...opcoesBase, fetchImpl: fetchPorUrl({}, 200) });

    expect(r.checked).toBe(0);
    const [linha] = await db.select().from(job).where(eq(job.id, jobId));
    expect(linha!.closedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("termina sem abrir requisição quando não há nada para conferir", async () => {
    // Com a fila vazia, o número de workers é zero. Sem esse mínimo, a varredura
    // esperaria para sempre por um worker que ninguém criou.
    let chamadas = 0;

    const r = await verifyJobs({
      ...opcoesBase,
      fetchImpl: (async () => {
        chamadas++;
        return new Response(null, { status: 200 });
      }) as unknown as typeof fetch,
    });

    expect(r).toEqual({ checked: 0, gone: 0, alive: 0, inconclusive: 0, bySource: {} });
    expect(chamadas).toBe(0);
  });

  it("trata falha de rede como inconclusiva, jamais como ausência", async () => {
    // Wi-Fi caindo no meio da varredura não pode fechar o acervo. É o modo de
    // falha mais provável de todos e o mais destrutivo se classificado errado.
    const jobId = await seedVaga({ fit: 90 });

    const r = await verifyJobs({
      ...opcoesBase,
      fetchImpl: (async () => {
        throw new Error("ENOTFOUND");
      }) as unknown as typeof fetch,
    });

    expect(r).toMatchObject({ checked: 1, gone: 0, alive: 0, inconclusive: 1 });
    const [linha] = await db.select().from(job).where(eq(job.id, jobId));
    expect(linha!.closedAt).toBeNull();
  });
});
