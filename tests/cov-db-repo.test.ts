/**
 * Suíte: as leituras e escritas de `src/core/db/repo.ts` que o quadro principal
 * não exercita.
 *
 * Invariante que atravessa o arquivo inteiro: **CLI e dashboard leem pela mesma
 * função**. Por isso os casos aqui atacam o que só uma das duas superfícies usa
 * hoje — ordenações alternativas do quadro, os números do cockpit, o funil e o
 * vínculo entre candidatura e documento enviado. Query duplicada em página é o
 * jeito de as duas passarem a discordar sem ninguém perceber.
 *
 * Fronteira DENTRO: libSQL real, migrations reais, transações reais.
 * Fronteira FORA: renderização e sessão.
 */
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import {
  ApplicationTransitionConflictError,
  boardFacets,
  clusterBreakdown,
  corpusStats,
  countBoard,
  getJobDetail,
  getJobScoringDetail,
  listBoard,
  pipelineRows,
  setApplicationDocument,
  setApplicationStatus,
  setApplicationStatusInTransaction,
} from "../src/core/db/repo.ts";
import {
  application,
  applicationEvent,
  candidate,
  candidateDocument,
  company,
  job,
  jobScore,
  source,
} from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(() => {
  releaseTestDb();
});

async function seedCandidato(slug: string, isDefault = false): Promise<number> {
  const [row] = await db
    .insert(candidate)
    .values({ slug, name: `Candidato ${slug}`, isDefault })
    .returning({ id: candidate.id });
  return row!.id;
}

type VagaEntrada = {
  n: number;
  sourceId?: string;
  postedAt?: string | null;
  compMax?: number | null;
  descriptionText?: string | null;
  companyName?: string;
};

async function seedVaga(entrada: VagaEntrada): Promise<number> {
  const sourceId = entrada.sourceId ?? "lever:acme";
  await db
    .insert(source)
    .values({
      id: sourceId,
      kind: sourceId.split(":")[0]!,
      handle: sourceId.split(":")[1]!,
      label: `Rótulo ${sourceId}`,
    })
    .onConflictDoNothing();
  const [empresa] = await db
    .insert(company)
    .values({ slug: `empresa-${entrada.n}`, name: `Empresa ${entrada.n}` })
    .returning({ id: company.id });
  const [vaga] = await db
    .insert(job)
    .values({
      sourceId,
      companyId: empresa!.id,
      companyName: entrada.companyName ?? `Empresa ${entrada.n}`,
      externalId: `ext-${entrada.n}`,
      title: `Arquiteto ${entrada.n}`,
      url: `https://exemplo.test/${entrada.n}`,
      fingerprint: `fp-${entrada.n}`,
      contentHash: `ch-${entrada.n}`,
      postedAt: entrada.postedAt ?? null,
      compMax: entrada.compMax ?? null,
      descriptionText: entrada.descriptionText ?? null,
      raw: "{}",
    })
    .returning({ id: job.id });
  return vaga!.id;
}

async function seedScore(
  candidateId: number,
  jobId: number,
  fit: number,
  cluster = "architect",
): Promise<void> {
  await db.insert(jobScore).values({
    candidateId,
    jobId,
    fit,
    titleScore: fit,
    keywordScore: 0,
    seniorityScore: 0,
    geoScore: 0,
    compScore: 0,
    freshnessScore: 0,
    benefitScore: 0,
    penalty: 0,
    cluster,
    matchedKeywords: [],
    missingKeywords: [],
    detectedBenefits: [],
    ageDays: null,
    reasons: [],
    blockers: [],
    scorerVersion: "teste",
  });
}

describe("filtros e ordenação do quadro", () => {
  it("filtra por cluster e por tipo de fonte com o mesmo predicado da contagem", async () => {
    // Lista e contagem compartilham `boardConditions` de propósito: paginação
    // que mostra "50 de N" com N calculado por outro predicado é a forma mais
    // silenciosa de o rodapé mentir.
    const candidateId = await seedCandidato("dono", true);
    const arquiteto = await seedVaga({ n: 1, sourceId: "lever:acme" });
    const backend = await seedVaga({ n: 2, sourceId: "greenhouse:acme" });
    await seedScore(candidateId, arquiteto, 80, "architect");
    await seedScore(candidateId, backend, 70, "backend");

    const porCluster = await listBoard(candidateId, { cluster: "backend" });
    expect(porCluster.map((r) => r.jobId)).toEqual([backend]);
    await expect(countBoard(candidateId, { cluster: "backend" })).resolves.toBe(1);

    const porFonte = await listBoard(candidateId, { sourceKind: "lever" });
    expect(porFonte.map((r) => r.jobId)).toEqual([arquiteto]);
    await expect(countBoard(candidateId, { sourceKind: "lever" })).resolves.toBe(1);
  });

  it("ordena por publicação recente usando a data vista quando não há a declarada", async () => {
    // Regra 8: vaga sem data de publicação não é vaga velha. Na ordenação isso
    // vira `coalesce(posted_at, first_seen_at)` — sem o coalesce ela iria para o
    // fim da lista por não ter dado, e não por ser antiga.
    const candidateId = await seedCandidato("dono", true);
    const antiga = await seedVaga({ n: 1, postedAt: "2026-01-01T00:00:00.000Z" });
    const nova = await seedVaga({ n: 2, postedAt: "2026-08-01T00:00:00.000Z" });
    const semData = await seedVaga({ n: 3, postedAt: null });
    await db
      .update(job)
      .set({ firstSeenAt: "2026-04-01T00:00:00.000Z" })
      .where(eq(job.id, semData));

    const linhas = await listBoard(candidateId, { sort: "recent" });

    expect(linhas.map((r) => r.jobId)).toEqual([nova, semData, antiga]);
  });

  it("ordena por remuneração e desempata pelo fit", async () => {
    // Quem ordena por dinheiro ainda quer as melhores primeiro dentro da mesma
    // faixa; sem o desempate a ordem entre iguais seria a do rowid.
    const candidateId = await seedCandidato("dono", true);
    const rica = await seedVaga({ n: 1, compMax: 200_000 });
    const empateBom = await seedVaga({ n: 2, compMax: 100_000 });
    const empateRuim = await seedVaga({ n: 3, compMax: 100_000 });
    const semSalario = await seedVaga({ n: 4, compMax: null });
    await seedScore(candidateId, rica, 40);
    await seedScore(candidateId, empateBom, 90);
    await seedScore(candidateId, empateRuim, 10);
    await seedScore(candidateId, semSalario, 99);

    const linhas = await listBoard(candidateId, { sort: "comp" });

    expect(linhas.map((r) => r.jobId)).toEqual([rica, empateBom, empateRuim, semSalario]);
  });

  it("lista os clusters presentes no recorte, ordenados, para os chips de filtro", async () => {
    // O chip precisa mostrar o que o filtro renderia. Cluster nulo (vaga ainda
    // não pontuada) não vira chip: seria um botão que filtra por nada.
    const candidateId = await seedCandidato("dono", true);
    const a = await seedVaga({ n: 1 });
    const b = await seedVaga({ n: 2 });
    const semScore = await seedVaga({ n: 3 });
    await seedScore(candidateId, a, 80, "staff");
    await seedScore(candidateId, b, 70, "ai-lead");

    const facetas = await boardFacets(candidateId);

    expect(facetas.total).toBe(3);
    expect(facetas.clusters).toEqual(["ai-lead", "staff"]);
    expect(facetas.sources).toEqual(["lever"]);
    expect(semScore).toBeGreaterThan(0);
  });
});

describe("detalhe de vaga", () => {
  it("devolve nulo para vaga inexistente em vez de estourar na página", async () => {
    // A URL /jobs/<id> é digitável. Vaga podada por `jho db prune` deixa link
    // antigo apontando para o vazio, e isso é um 404, não um 500.
    const candidateId = await seedCandidato("dono", true);

    await expect(getJobDetail(candidateId, 9_999)).resolves.toBeNull();
    await expect(getJobScoringDetail(candidateId, 9_999)).resolves.toBeNull();
  });

  it("separa o detalhe com funil do detalhe só de pontuação", async () => {
    // A segunda leitura existe para telas que mostram a vaga sem revelar a
    // decisão do usuário — o funil é dado privado do candidato.
    const candidateId = await seedCandidato("dono", true);
    const jobId = await seedVaga({ n: 1 });
    await seedScore(candidateId, jobId, 77);
    await setApplicationStatus(candidateId, jobId, "shortlisted");

    const completo = await getJobDetail(candidateId, jobId);
    const publico = await getJobScoringDetail(candidateId, jobId);

    expect(completo!.application!.status).toBe("shortlisted");
    expect(completo!.score!.fit).toBe(77);
    expect(publico!.score!.fit).toBe(77);
    expect(publico).not.toHaveProperty("application");
    expect(publico!.source!.label).toBe("Rótulo lever:acme");
  });
});

describe("números do cockpit", () => {
  it("conta acervo aberto, empresas, fontes ativas e os cortes de fit", async () => {
    // Cada corte é um degrau de decisão: 45 é "olhar", 60 é "vale preparar", 70
    // é "candidatar". Vaga fechada some de todos eles porque histórico não é
    // fila de trabalho.
    const candidateId = await seedCandidato("dono", true);
    const baixa = await seedVaga({ n: 1 });
    const media = await seedVaga({ n: 2 });
    const alta = await seedVaga({ n: 3 });
    const fechada = await seedVaga({ n: 4 });
    await seedScore(candidateId, baixa, 50);
    await seedScore(candidateId, media, 65);
    await seedScore(candidateId, alta, 86);
    await seedScore(candidateId, fechada, 99);
    await db
      .update(job)
      .set({ closedAt: "2026-02-02T00:00:00.000Z" })
      .where(eq(job.id, fechada));
    await db.update(source).set({ enabled: false }).where(eq(source.id, "lever:acme"));

    const stats = await corpusStats(candidateId);

    expect(Number(stats!.open)).toBe(3);
    expect(Number(stats!.companies)).toBe(4);
    expect(Number(stats!.sources)).toBe(0);
    expect(Number(stats!.above45)).toBe(3);
    expect(Number(stats!.above60)).toBe(2);
    expect(Number(stats!.above70)).toBe(1);
    expect(Number(stats!.best)).toBe(86);
  });

  it("não deixa o acervo de outro candidato aparecer nos cortes", async () => {
    const primeiro = await seedCandidato("primeiro", true);
    const segundo = await seedCandidato("segundo");
    const jobId = await seedVaga({ n: 1 });
    await seedScore(segundo, jobId, 95);

    const stats = await corpusStats(primeiro);

    expect(Number(stats!.open)).toBe(1);
    expect(Number(stats!.above45)).toBe(0);
    expect(Number(stats!.best)).toBe(0);
  });

  it("agrupa por cluster acima do corte, do maior grupo para o menor", async () => {
    // O gráfico responde "onde está o volume aproveitável". Incluir vaga abaixo
    // do corte encheria a barra de coisa que ninguém vai abrir.
    const candidateId = await seedCandidato("dono", true);
    for (let i = 0; i < 5; i++) {
      await seedScore(candidateId, await seedVaga({ n: i }), 70, "architect");
    }
    for (let i = 5; i < 7; i++) {
      await seedScore(candidateId, await seedVaga({ n: i }), 60, "backend");
    }
    await seedScore(candidateId, await seedVaga({ n: 8 }), 10, "other");

    const padrao = await clusterBreakdown(candidateId);
    expect(padrao.map((r) => r.cluster)).toEqual(["architect", "backend"]);
    expect(Number(padrao[0]!.n)).toBe(5);
    expect(Number(padrao[0]!.best)).toBe(70);

    // Corte explícito é o que a tela usa quando o usuário move o filtro.
    const exigente = await clusterBreakdown(candidateId, 65);
    expect(exigente.map((r) => r.cluster)).toEqual(["architect"]);
  });

  it("ignora vaga fechada no agrupamento por cluster", async () => {
    const candidateId = await seedCandidato("dono", true);
    const fechada = await seedVaga({ n: 1 });
    await seedScore(candidateId, fechada, 90, "architect");
    await db
      .update(job)
      .set({ closedAt: "2026-02-02T00:00:00.000Z" })
      .where(eq(job.id, fechada));

    await expect(clusterBreakdown(candidateId)).resolves.toEqual([]);
  });
});

describe("pipelineRows", () => {
  it("lista o funil do candidato com a vaga, o fit e a última mexida primeiro", async () => {
    // A ordenação por `updated_at` é o que faz a tela abrir no que o usuário
    // acabou de mexer, em vez de na candidatura mais antiga.
    const candidateId = await seedCandidato("dono", true);
    const outro = await seedCandidato("outro");
    const primeira = await seedVaga({ n: 1 });
    const segunda = await seedVaga({ n: 2 });
    await seedScore(candidateId, primeira, 81);
    await setApplicationStatus(candidateId, primeira, "applied");
    await setApplicationStatus(candidateId, segunda, "shortlisted");
    await setApplicationStatus(outro, primeira, "applied");
    await db
      .update(application)
      .set({ updatedAt: "2026-08-19T00:00:00.000Z", notes: "mais antiga" })
      .where(and(eq(application.candidateId, candidateId), eq(application.jobId, primeira)));
    await db
      .update(application)
      .set({ updatedAt: "2026-08-20T00:00:00.000Z", nextAction: "follow-up" })
      .where(and(eq(application.candidateId, candidateId), eq(application.jobId, segunda)));

    const linhas = await pipelineRows(candidateId);

    expect(linhas.map((r) => r.jobId)).toEqual([segunda, primeira]);
    expect(linhas[0]!.nextAction).toBe("follow-up");
    expect(linhas[1]!.notes).toBe("mais antiga");
    expect(linhas[1]!.fit).toBe(81);
    // Sem score do candidato, o fit é ausente e não zero.
    expect(linhas[0]!.fit).toBeNull();
  });
});

describe("setApplicationDocument", () => {
  it("registra o documento exato enviado com a candidatura", async () => {
    // Sem isso, "qual versão do CV eu mandei?" vira arqueologia de arquivo. O
    // vínculo é o que permite comparar retorno por variante de currículo.
    const candidateId = await seedCandidato("dono", true);
    const jobId = await seedVaga({ n: 1 });
    await setApplicationStatus(candidateId, jobId, "applied");
    const [documento] = await db
      .insert(candidateDocument)
      .values({ candidateId, kind: "cv", label: "ATS EN 2026-08", content: "…" })
      .returning({ id: candidateDocument.id });

    await setApplicationDocument(candidateId, jobId, documento!.id);

    const [linha] = await db.select().from(application).where(eq(application.jobId, jobId));
    expect(linha!.candidateDocumentId).toBe(documento!.id);
  });

  it("aceita desvincular o documento", async () => {
    // Corrigir um vínculo errado não pode exigir mexer no banco à mão.
    const candidateId = await seedCandidato("dono", true);
    const jobId = await seedVaga({ n: 1 });
    await setApplicationStatus(candidateId, jobId, "applied");
    const [documento] = await db
      .insert(candidateDocument)
      .values({ candidateId, kind: "cv", label: "v1", content: "…" })
      .returning({ id: candidateDocument.id });
    await setApplicationDocument(candidateId, jobId, documento!.id);

    await setApplicationDocument(candidateId, jobId, null);

    const [linha] = await db.select().from(application).where(eq(application.jobId, jobId));
    expect(linha!.candidateDocumentId).toBeNull();
  });

  it("recusa documento de outro candidato sem deixar rastro na candidatura", async () => {
    // Documento é dado pessoal. Aceitar um id vindo de fora seria leitura de CV
    // alheio por procuração — a mesma classe de falha que a regra 15 fecha nas
    // Server Actions.
    const dono = await seedCandidato("dono", true);
    const alheio = await seedCandidato("alheio");
    const jobId = await seedVaga({ n: 1 });
    await setApplicationStatus(dono, jobId, "applied");
    const [documento] = await db
      .insert(candidateDocument)
      .values({ candidateId: alheio, kind: "cv", label: "CV do outro", content: "…" })
      .returning({ id: candidateDocument.id });

    await expect(setApplicationDocument(dono, jobId, documento!.id)).rejects.toThrow(
      /não pertence ao candidato/,
    );

    const [linha] = await db.select().from(application).where(eq(application.jobId, jobId));
    expect(linha!.candidateDocumentId).toBeNull();
  });

  it("recusa vincular documento a candidatura que não existe", async () => {
    const candidateId = await seedCandidato("dono", true);
    const jobId = await seedVaga({ n: 1 });

    await expect(setApplicationDocument(candidateId, jobId, null)).rejects.toThrow(
      /Candidatura não encontrada/,
    );
  });
});

describe("concorrência otimista na transição", () => {
  it("recusa a transição quando a linha lida deixou de casar com o UPDATE", async () => {
    // O status é o token de concorrência do agregado: o UPDATE só casa se a
    // linha ainda estiver no estado que o SELECT leu. Duas abas do dashboard
    // clicando ao mesmo tempo precisam produzir uma vencedora e um erro
    // nomeado — nunca dois eventos contando histórias incompatíveis sobre a
    // mesma candidatura.
    //
    // A perda de atualização é forçada por um gatilho `RAISE(IGNORE)`, que faz
    // o UPDATE não afetar linha nenhuma. Do ponto de vista do caso de uso é
    // indistinguível de outra transação ter commitado primeiro, e é
    // determinístico em vez de depender de escalonamento.
    const candidateId = await seedCandidato("dono", true);
    const jobId = await seedVaga({ n: 1 });
    await setApplicationStatus(candidateId, jobId, "shortlisted");
    await db.run(sql.raw(`
      create trigger perde_update
      before update on application
      begin
        select raise(ignore);
      end
    `));

    await expect(
      setApplicationStatus(candidateId, jobId, "preparing"),
    ).rejects.toBeInstanceOf(ApplicationTransitionConflictError);

    // Nada foi gravado pela metade: nem status novo, nem evento órfão.
    await db.run(sql.raw("drop trigger perde_update"));
    const [linha] = await db.select().from(application).where(eq(application.jobId, jobId));
    expect(linha!.status).toBe("shortlisted");
    const eventos = await db
      .select()
      .from(applicationEvent)
      .where(eq(applicationEvent.applicationId, linha!.id));
    expect(eventos).toHaveLength(1);
  });

  it("nomeia o candidato e a vaga no erro de conflito", async () => {
    // Log de conflito sem os dois ids é indistinguível de qualquer outro
    // conflito, e a investigação começa do zero.
    const erro = new ApplicationTransitionConflictError(7, 42);

    expect(erro.code).toBe("application_transition_conflict");
    expect(erro.name).toBe("ApplicationTransitionConflictError");
    expect(erro.message).toContain("candidate 7");
    expect(erro.message).toContain("job 42");
  });
});

describe("setApplicationStatusInTransaction", () => {
  it("commita junto com o chamador — ou não commita nada", async () => {
    // Este é o motivo de a função existir separada: aceitar uma sugestão de
    // e-mail precisa mover o funil e marcar a sugestão como aceita na mesma
    // transação. Meia operação aqui significaria funil dizendo uma coisa e
    // caixa de entrada outra, sem forma de saber qual está certa.
    const candidateId = await seedCandidato("dono", true);
    const jobId = await seedVaga({ n: 1 });

    await expect(
      db.transaction(async (tx) => {
        await setApplicationStatusInTransaction(tx, candidateId, jobId, "applied", "por e-mail");
        throw new Error("o outro contexto falhou");
      }),
    ).rejects.toThrow("o outro contexto falhou");

    await expect(db.select().from(application)).resolves.toHaveLength(0);
    await expect(db.select().from(applicationEvent)).resolves.toHaveLength(0);
  });

  it("não gera evento quando o estado pedido já é o atual", async () => {
    // Idempotência: reprocessar o mesmo e-mail duas vezes não pode inflar o
    // histórico com transições que nunca aconteceram.
    const candidateId = await seedCandidato("dono", true);
    const jobId = await seedVaga({ n: 1 });

    await db.transaction(async (tx) => {
      await setApplicationStatusInTransaction(tx, candidateId, jobId, "shortlisted");
    });
    await db.transaction(async (tx) => {
      await setApplicationStatusInTransaction(tx, candidateId, jobId, "shortlisted");
    });

    await expect(db.select().from(applicationEvent)).resolves.toHaveLength(1);
  });
});
