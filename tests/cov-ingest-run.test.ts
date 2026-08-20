/**
 * Suíte: `src/core/ingest/run.ts` — o pipeline de sync.
 *
 * Três invariantes, e todo caso aqui defende um deles:
 *
 *  1. **Sync nunca escreve em `application`.** As decisões do usuário sobrevivem
 *     a toda re-execução. É o único dado irrecuperável do sistema.
 *  2. **Fonte que falha é registrada e pulada.** Uma API fora do ar não pode
 *     derrubar as outras doze.
 *  3. **Vaga que some é fechada, não deletada.** Deletar quebraria a chave
 *     estrangeira da candidatura que aponta para ela.
 *
 * Fronteira DENTRO: orquestração, contadores, fechamento e poda.
 * Fronteira FORA: rede — a porta HTTP é dublê.
 */
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { application, candidate, job, jobScore, source } from "../src/core/db/schema.ts";
import { ensureSources, pruneClosed, syncAll } from "../src/core/ingest/run.ts";
import { fixtureHttp, resetHttpPort, setHttpPort } from "../src/core/sources/http-port.ts";
import "../src/core/sources/http.ts";
import type { SourceConfig } from "../src/core/sources/types.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(() => {
  resetHttpPort();
  releaseTestDb();
});

const config = (handle: string, label = "Acme"): SourceConfig => ({
  kind: "greenhouse",
  handle,
  label,
});

/** Uma vaga no formato que a API do Greenhouse devolve. */
const vaga = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  title: `Vaga ${id}`,
  absolute_url: `https://boards.greenhouse.io/acme/jobs/${id}`,
  content: `&lt;p&gt;Descrição da vaga ${id}.&lt;/p&gt;`,
  ...over,
});

function boardCom(jobs: unknown[]): void {
  setHttpPort(fixtureHttp({ "boards-api.greenhouse.io": { jobs } }));
}

describe("ensureSources", () => {
  it("faz do YAML a fonte da verdade, reescrevendo rótulo e reabilitando", async () => {
    // A configuração é o que o usuário edita; o banco é cache. Uma fonte
    // desabilitada à mão que volta ao YAML precisa voltar a ser varrida, senão
    // a única forma de reativá-la seria mexer em SQL.
    await db.insert(source).values({
      id: "greenhouse:acme",
      kind: "greenhouse",
      handle: "acme",
      label: "Rótulo velho",
      enabled: false,
      rationale: "motivo antigo",
    });

    await ensureSources([{ ...config("acme", "Acme Corp"), rationale: "empresa alvo" }]);

    const [linha] = await db.select().from(source).where(eq(source.id, "greenhouse:acme"));
    expect(linha!.label).toBe("Acme Corp");
    expect(linha!.rationale).toBe("empresa alvo");
    expect(linha!.enabled).toBe(true);
  });
});

describe("syncAll", () => {
  it("registra sucesso na fonte com contagem e data da última varredura", async () => {
    // `jho sources list` lê exatamente essas colunas. Sem elas, "a fonte está
    // saudável?" só se responde rodando o sync de novo.
    boardCom([vaga(1), vaga(2)]);

    const r = await syncAll([config("acme")]);

    expect(r.totals).toMatchObject({ fetched: 2, inserted: 2, failed: 0 });
    const [linha] = await db.select().from(source).where(eq(source.id, "greenhouse:acme"));
    expect(linha!.lastStatus).toBe("ok");
    expect(linha!.lastError).toBeNull();
    expect(linha!.lastJobCount).toBe(2);
    expect(linha!.lastSyncedAt).toBeTruthy();
  });

  it("descarta item sem título ou sem link antes de tentar gravar", async () => {
    // Board devolve entrada meia-boca em rascunho e em vaga despublicada. Gravar
    // criaria linha sem identidade estável, que nunca deduplica.
    boardCom([
      vaga(1),
      { id: 2, title: "", absolute_url: "https://boards.greenhouse.io/acme/jobs/2" },
      { id: 3, title: "Sem link", absolute_url: "" },
    ]);

    const r = await syncAll([config("acme")]);

    expect(r.totals.fetched).toBe(3);
    expect(r.totals.inserted).toBe(1);
    await expect(db.select().from(job)).resolves.toHaveLength(1);
  });

  it("fecha a vaga que sumiu do board e invalida o score da que mudou", async () => {
    // As duas metades do que uma segunda varredura descobre. Fechar preserva o
    // histórico (regra 3); invalidar o score impede que a pontuação antiga
    // continue ranqueando um anúncio que já não é aquele.
    const [pessoa] = await db
      .insert(candidate)
      .values({ slug: "dono", name: "Dono", isDefault: true })
      .returning({ id: candidate.id });
    boardCom([vaga(1), vaga(2)]);
    await syncAll([config("acme")]);

    const linhas = await db.select().from(job);
    for (const linha of linhas) {
      await db.insert(jobScore).values({
        candidateId: pessoa!.id,
        jobId: linha.id,
        fit: 70,
        titleScore: 30,
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

    // A vaga 2 sumiu; a 1 foi editada.
    boardCom([vaga(1, { content: "&lt;p&gt;Escopo completamente outro.&lt;/p&gt;" })]);
    const r = await syncAll([config("acme")]);

    expect(r.totals).toMatchObject({ closed: 1, changed: 1, updated: 1, rescored: 1 });
    const [fechada] = await db.select().from(job).where(eq(job.externalId, "2"));
    expect(fechada!.closedAt).toBeTruthy();
    // Fechada, jamais apagada.
    await expect(db.select().from(job)).resolves.toHaveLength(2);
    await expect(db.select().from(jobScore)).resolves.toHaveLength(1);
  });

  it("não fecha nada quando a fonte devolve lista vazia", async () => {
    // Lista vazia é ambígua: pode ser "a empresa não tem vaga" ou "a API mudou o
    // formato". Fechar o acervo inteiro por causa da segunda hipótese é
    // exatamente o fechamento em massa que não se desfaz.
    boardCom([vaga(1), vaga(2)]);
    await syncAll([config("acme")]);

    boardCom([]);
    const r = await syncAll([config("acme")]);

    expect(r.totals.closed).toBe(0);
    const linhas = await db.select().from(job);
    expect(linhas.every((l) => l.closedAt === null)).toBe(true);
  });

  it("não encosta na candidatura ao reprocessar a mesma vaga", async () => {
    // Invariante 1, verificado de verdade: o sync roda de novo com o anúncio
    // editado e o funil continua exatamente onde o usuário o deixou.
    const [pessoa] = await db
      .insert(candidate)
      .values({ slug: "dono", name: "Dono", isDefault: true })
      .returning({ id: candidate.id });
    boardCom([vaga(1)]);
    await syncAll([config("acme")]);
    const [linha] = await db.select().from(job);
    await db
      .insert(application)
      .values({ candidateId: pessoa!.id, jobId: linha!.id, status: "applied", notes: "enviei" });

    boardCom([vaga(1, { content: "&lt;p&gt;Outro escopo.&lt;/p&gt;" })]);
    await syncAll([config("acme")]);

    const [candidatura] = await db.select().from(application);
    expect(candidatura!.status).toBe("applied");
    expect(candidatura!.notes).toBe("enviei");
  });

  it("isola a falha de uma fonte e conclui as demais", async () => {
    // Invariante 2. O erro fica gravado em `source.lastError` para
    // `jho sources list` mostrar, e o total de `failed` é o que diz se a
    // varredura foi completa.
    setHttpPort({
      // `<T>` explícito: a porta declara `json<T = unknown>`, e um dublê com
      // retorno concreto não é atribuível à assinatura genérica.
      async json<T>(url: string) {
        if (url.includes("quebrada")) throw new Error("GET -> 500");
        return { jobs: [vaga(1)] } as T;
      },
      async text() {
        return null;
      },
    });

    const r = await syncAll([config("acme"), config("quebrada", "Quebrada")]);

    expect(r.totals.failed).toBe(1);
    expect(r.totals.inserted).toBe(1);
    const boa = r.sources.find((s) => s.sourceId === "greenhouse:acme")!;
    const ruim = r.sources.find((s) => s.sourceId === "greenhouse:quebrada")!;
    expect(boa.ok).toBe(true);
    expect(ruim.ok).toBe(false);
    expect(ruim.error).toContain("500");
    const [linha] = await db.select().from(source).where(eq(source.id, "greenhouse:quebrada"));
    expect(linha!.lastStatus).toBe("error");
    expect(linha!.lastError).toContain("500");
  });

  it("descreve falha que não é Error sem virar '[object Object]'", async () => {
    // Adapter de terceiro pode rejeitar com string ou objeto simples. Um erro
    // ilegível em `source.lastError` é pior que nenhum: parece diagnóstico.
    setHttpPort({
      async json(): Promise<never> {
        throw "timeout bruto";
      },
      async text() {
        return null;
      },
    });

    const r = await syncAll([config("acme")]);

    expect(r.sources[0]!.error).toBe("timeout bruto");
  });

  it("chama o progresso uma vez por fonte, para a CLI poder desenhar a barra", async () => {
    boardCom([vaga(1)]);
    const vistas: string[] = [];

    await syncAll([config("a"), config("b"), config("c")], {
      concurrency: 2,
      onProgress: (r) => vistas.push(r.sourceId),
    });

    expect(vistas.sort()).toEqual([
      "greenhouse:a",
      "greenhouse:b",
      "greenhouse:c",
    ]);
  });

  it("devolve totais zerados e janela de tempo coerente sem fonte nenhuma", async () => {
    // `syncAll([])` acontece quando toda fonte está desabilitada. Precisa
    // terminar em vez de esperar por um worker que nunca é criado.
    const r = await syncAll([]);

    expect(r.sources).toEqual([]);
    expect(r.totals).toEqual({
      fetched: 0,
      inserted: 0,
      unchanged: 0,
      changed: 0,
      updated: 0,
      reopened: 0,
      closed: 0,
      rescored: 0,
      failed: 0,
    });
    expect(Date.parse(r.finishedAt)).toBeGreaterThanOrEqual(Date.parse(r.startedAt));
  });
});

describe("pruneClosed", () => {
  it("esquece vaga fechada há muito tempo, mas nunca a que tem candidatura", async () => {
    // A poda existe para o acervo não crescer para sempre. A cláusula que
    // protege candidatura é o que impede a manutenção de destruir o histórico —
    // é a mesma razão da regra 3, aplicada ao lado oposto do ciclo de vida.
    const [pessoa] = await db
      .insert(candidate)
      .values({ slug: "dono", name: "Dono", isDefault: true })
      .returning({ id: candidate.id });
    await db
      .insert(source)
      .values({ id: "lever:acme", kind: "lever", handle: "acme", label: "Acme" });

    const antiga = "2020-01-01T00:00:00.000Z";
    const recente = new Date(Date.now() - 5 * 86_400_000).toISOString();
    for (const [n, closedAt] of [[1, antiga], [2, antiga], [3, recente]] as const) {
      await db.insert(job).values({
        sourceId: "lever:acme",
        companyName: "Acme",
        externalId: `ext-${n}`,
        title: `Vaga ${n}`,
        url: `https://exemplo.test/${n}`,
        fingerprint: `fp-${n}`,
        contentHash: `ch-${n}`,
        raw: "{}",
        closedAt,
      });
    }
    const [comCandidatura] = await db.select().from(job).where(eq(job.externalId, "ext-1"));
    await db
      .insert(application)
      .values({ candidateId: pessoa!.id, jobId: comCandidatura!.id, status: "rejected" });

    const removidas = await pruneClosed();

    expect(removidas).toBe(1);
    const restantes = await db.select().from(job);
    expect(restantes.map((l) => l.externalId).sort()).toEqual(["ext-1", "ext-3"]);
  });

  it("respeita a janela pedida e nunca toca em vaga aberta", async () => {
    // O parâmetro é o que separa "limpeza de rotina" de "apagar o acervo". Vaga
    // aberta tem `closed_at` nulo e a comparação a exclui — sem isso, um corte
    // agressivo levaria o quadro inteiro.
    await db
      .insert(source)
      .values({ id: "lever:acme", kind: "lever", handle: "acme", label: "Acme" });
    await db.insert(job).values([
      {
        sourceId: "lever:acme",
        companyName: "Acme",
        externalId: "aberta",
        title: "Aberta",
        url: "https://exemplo.test/aberta",
        fingerprint: "fp-aberta",
        contentHash: "ch-aberta",
        raw: "{}",
      },
      {
        sourceId: "lever:acme",
        companyName: "Acme",
        externalId: "fechada",
        title: "Fechada",
        url: "https://exemplo.test/fechada",
        fingerprint: "fp-fechada",
        contentHash: "ch-fechada",
        raw: "{}",
        closedAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      },
    ]);

    await expect(pruneClosed(30)).resolves.toBe(0);
    await expect(pruneClosed(5)).resolves.toBe(1);

    const [linha] = await db.select().from(job);
    expect(linha!.externalId).toBe("aberta");
    const [contagem] = await db.all<{ total: number }>(
      sql.raw("select count(*) as total from job"),
    );
    expect(Number(contagem!.total)).toBe(1);
  });
});
