import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { engagement, metricSnapshot, post, targetAccount } from "../src/core/db/schema.ts";
import {
  ENGAGEMENT_KINDS,
  PILLARS,
  PILLAR_KEYS,
  coldTargets,
  draftPost,
  listPosts,
  markEngagement,
  markPublished,
  metricTrend,
  parsePillar,
  pendingEngagements,
  queueEngagement,
  recordMetric,
} from "../src/core/positioning/engage.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * A fila de engajamento é a outra metade da ADR 0001. Recusar scraping do
 * LinkedIn só se sustenta como decisão se a alternativa existir de fato: o
 * agente redige, o humano age.
 *
 * > Invariante: nada aqui é executado automaticamente. Uma linha é um rascunho
 * > mais uma URL. No instante em que software publicar o comentário ou enviar
 * > o convite, estamos dentro da §8.2 item 13 e a política inteira desaba.
 *
 * Por isso os testes verificam o que a fila NÃO faz tanto quanto o que ela faz.
 */
let db: DB;

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(() => {
  releaseTestDb();
});

describe("fila de engajamento: rascunho + URL, nunca execução", () => {
  it("enfileira com rationale e data, e nasce em `queued`", async () => {
    const id = await queueEngagement({
      kind: "comment",
      targetUrl: "https://www.linkedin.com/posts/marina_arquitetura-123",
      targetName: "Marina Alves",
      targetRole: "Head of AI",
      targetCompany: "Nubank",
      rationale: "Ela publicou sobre custo de inferência; temos número real para somar.",
      draft: "O ponto de fallback muda o cálculo: em produção medimos 18% de...",
      queuedFor: "2026-08-21",
    });

    const [linha] = await db.select().from(engagement).where(eq(engagement.id, id));
    expect(linha).toMatchObject({
      kind: "comment",
      status: "queued",
      queuedFor: "2026-08-21",
      targetCompany: "Nubank",
    });
    // A linha guarda o texto, e nada além disso acontece: sem `doneAt`, sem
    // `outcome`. Quem age é a pessoa que abre a URL.
    expect(linha?.doneAt).toBeNull();
    expect(linha?.outcome).toBeNull();
  });

  it("exige rationale como campo, porque 'ótimo post' dilui em vez de somar", async () => {
    // A auditoria é específica: comentário substantivo acrescenta arquitetura,
    // trade-off, risco ou exemplo. O campo existe para o rascunho ter que
    // justificar por que aquele alvo importa.
    const id = await queueEngagement({
      kind: "connect",
      targetUrl: "https://www.linkedin.com/in/bruno",
    });
    const [linha] = await db.select().from(engagement).where(eq(engagement.id, id));
    // Opcional no tipo, mas nulo explícito no banco — não vira string vazia,
    // que passaria despercebida numa listagem.
    expect(linha?.rationale).toBeNull();
    expect(linha?.draft).toBeNull();
  });

  it("assume hoje quando nenhuma data é informada", async () => {
    const id = await queueEngagement({ kind: "follow", targetUrl: "https://x.test/1" });
    const [linha] = await db.select().from(engagement).where(eq(engagement.id, id));
    expect(linha?.queuedFor).toBe(new Date().toISOString().slice(0, 10));
  });

  it("cobre os cinco tipos de interação que a auditoria prevê", () => {
    expect([...ENGAGEMENT_KINDS]).toEqual([
      "comment",
      "connect",
      "follow",
      "message",
      "endorse",
    ]);
  });
});

describe("pendingEngagements: é fila, não pilha", () => {
  it("devolve o mais antigo primeiro e ignora o que já saiu da fila", async () => {
    // Ordem por data e depois por id: dois itens do mesmo dia precisam sair na
    // ordem em que entraram, senão o topo da lista muda entre dois
    // carregamentos e a pessoa clica no que não queria.
    const velho = await queueEngagement({
      kind: "comment",
      targetUrl: "https://x.test/velho",
      queuedFor: "2026-08-10",
    });
    const mesmoDiaA = await queueEngagement({
      kind: "comment",
      targetUrl: "https://x.test/a",
      queuedFor: "2026-08-12",
    });
    const mesmoDiaB = await queueEngagement({
      kind: "comment",
      targetUrl: "https://x.test/b",
      queuedFor: "2026-08-12",
    });
    const feito = await queueEngagement({
      kind: "comment",
      targetUrl: "https://x.test/feito",
      queuedFor: "2026-08-01",
    });
    await markEngagement(feito, "done", "respondeu em 2h");

    expect((await pendingEngagements()).map((e) => e.id)).toEqual([
      velho,
      mesmoDiaA,
      mesmoDiaB,
    ]);
  });

  it("respeita o limite pedido", async () => {
    for (let i = 0; i < 4; i++) {
      await queueEngagement({ kind: "follow", targetUrl: `https://x.test/${i}` });
    }
    expect(await pendingEngagements(2)).toHaveLength(2);
    expect(await pendingEngagements()).toHaveLength(4);
  });
});

describe("markEngagement: registra o desfecho, que é o dado que falta", () => {
  it("marca concluído com carimbo e resultado", async () => {
    const id = await queueEngagement({ kind: "message", targetUrl: "https://x.test/m" });
    await markEngagement(id, "done", "virou conversa sobre vaga de Staff");

    const [linha] = await db.select().from(engagement).where(eq(engagement.id, id));
    expect(linha?.status).toBe("done");
    expect(linha?.outcome).toBe("virou conversa sobre vaga de Staff");
    expect(linha?.doneAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("marca pulado sem resultado, e isso não é o mesmo que concluído", async () => {
    // "Pulei" e "fiz" precisam ser distinguíveis: só assim dá para saber se a
    // cadência de dois comentários por dia útil está sendo cumprida ou só
    // riscada da lista.
    const id = await queueEngagement({ kind: "endorse", targetUrl: "https://x.test/e" });
    await markEngagement(id, "skipped");

    const [linha] = await db.select().from(engagement).where(eq(engagement.id, id));
    expect(linha?.status).toBe("skipped");
    expect(linha?.outcome).toBeNull();
    expect(await pendingEngagements()).toEqual([]);
  });
});

describe("pilares de conteúdo (§13.2)", () => {
  it("aceita só os seis pilares declarados", () => {
    // O pilar é a coluna que agrupa a produção. Uma string livre faria o
    // relatório de cadência contar seis pilares e um monte de órfãos.
    for (const chave of PILLAR_KEYS) expect(parsePillar(chave)).toBe(chave);
    expect(parsePillar("carreira")).toBeNull();
    expect(parsePillar("")).toBeNull();
    expect(parsePillar("PRODUCTION-AI")).toBeNull();
  });

  it("descreve cada pilar com a tese, não com o rótulo", () => {
    // O valor de PILLARS é a frase que orienta o post. "Production AI" sozinho
    // não diz o que escrever; "o trabalho começa depois do protótipo" diz.
    expect(Object.keys(PILLARS).sort()).toEqual([...PILLAR_KEYS].sort());
    for (const chave of PILLAR_KEYS) expect(PILLARS[chave].length).toBeGreaterThan(30);
  });
});

describe("rascunhos de post", () => {
  it("cria e depois atualiza pelo slug, sem duplicar", async () => {
    // O slug é a identidade do post. Revisar um rascunho três vezes não pode
    // gerar três linhas — a lista de rascunhos vira inútil no segundo dia.
    const primeiro = await draftPost({
      slug: "custo-de-inferencia",
      pillar: "production-ai",
      title: "O trabalho começa depois do protótipo",
      body: "Rascunho inicial",
    });
    const segundo = await draftPost({
      slug: "custo-de-inferencia",
      pillar: "data-rag",
      title: "Título revisado",
      body: "Corpo revisado",
      lang: "pt",
    });

    expect(segundo).toBe(primeiro);
    const linhas = await db.select().from(post);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      title: "Título revisado",
      body: "Corpo revisado",
      pillar: "data-rag",
      status: "draft",
    });
    // `lang` não entra no conflito: trocar idioma de um slug existente seria
    // outro post, não uma revisão. Registro do comportamento atual.
    expect(linhas[0]?.lang).toBe("en");
  });

  it("assume inglês por padrão, que é o idioma do público-alvo", async () => {
    await draftPost({ slug: "agentes", pillar: "agentic", title: "T", body: "B" });
    const [linha] = await db.select().from(post);
    expect(linha?.lang).toBe("en");
  });

  it("lista tudo, ou só um estado", async () => {
    await draftPost({ slug: "a", pillar: "leadership", title: "A", body: "corpo" });
    await draftPost({ slug: "b", pillar: "modernization", title: "B", body: "corpo" });
    await markPublished("a", "urn:li:share:123");

    expect(await listPosts()).toHaveLength(2);
    expect((await listPosts("draft")).map((p) => p.slug)).toEqual(["b"]);
    const [publicado] = await listPosts("published");
    expect(publicado).toMatchObject({ slug: "a", linkedinUrn: "urn:li:share:123" });
    expect(publicado?.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("publica sem URN quando a publicação foi manual", async () => {
    // Publicar pela API oficial devolve URN; publicar à mão no LinkedIn não
    // devolve nada. Exigir o URN impediria de registrar o caso comum.
    await draftPost({ slug: "manual", pillar: "saas-arch", title: "T", body: "B" });
    await markPublished("manual");
    const [linha] = await db.select().from(post);
    expect(linha).toMatchObject({ status: "published", linkedinUrn: null });
  });
});

describe("métricas do funil, registradas à mão por decisão", () => {
  it("grava uma leitura e sobrescreve a do mesmo dia", async () => {
    // Não existe API para SSI, exibições ou aparições em busca — tudo é lido
    // da interface do LinkedIn. É consequência da ADR 0001, não descuido, e
    // corrigir um número digitado errado precisa ser possível.
    await recordMetric("ssi_total", 59, { at: "2026-07-27", note: "linha de base" });
    await recordMetric("ssi_total", 63, { at: "2026-07-27", note: "corrigido" });

    const linhas = await db.select().from(metricSnapshot);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ value: 63, note: "corrigido" });
  });

  it("usa a data de hoje quando nenhuma é informada", async () => {
    await recordMetric("profile_views_7d", 1362);
    const [linha] = await db.select().from(metricSnapshot);
    expect(linha?.at).toBe(new Date().toISOString().slice(0, 10));
    expect(linha?.note).toBeNull();
  });

  it("resume cada métrica da primeira à última leitura", async () => {
    await recordMetric("ssi_total", 59, { at: "2026-07-27" });
    await recordMetric("ssi_total", 61, { at: "2026-08-10" });
    await recordMetric("ssi_total", 66, { at: "2026-09-01" });
    await recordMetric("followers", 2717, { at: "2026-07-27" });

    const tendencia = await metricTrend();
    const ssi = tendencia.find((t) => t.key === "ssi_total");
    expect(ssi).toMatchObject({
      baseline: 59,
      baselineAt: "2026-07-27",
      latest: 66,
      latestAt: "2026-09-01",
      delta: 7,
      readings: 3,
    });

    // Uma leitura só não tem delta: zero diria "não mudou", que é afirmação
    // diferente de "ainda não dá para saber".
    expect(tendencia.find((t) => t.key === "followers")).toMatchObject({
      delta: null,
      readings: 1,
    });
  });

  it("devolve lista vazia quando nada foi registrado", async () => {
    expect(await metricTrend()).toEqual([]);
  });
});

describe("coldTargets: a lacuna da §2.2", () => {
  it("lista só quem ainda não foi tocado e tem URL para abrir", async () => {
    // Sem URL não há o que o humano abrir, e a linha seria uma tarefa
    // impossível no meio da fila. Quem já está em `following` saiu da lacuna.
    await db.insert(targetAccount).values([
      {
        name: "Frio com URL",
        category: "ai-leader",
        linkedinUrl: "https://www.linkedin.com/in/frio",
        status: "identified",
      },
      { name: "Frio sem URL", category: "peer", status: "identified" },
      {
        name: "Já engajado",
        category: "recruiter",
        linkedinUrl: "https://www.linkedin.com/in/quente",
        status: "following",
      },
    ]);

    const frios = await coldTargets();
    expect(frios.map((t) => t.name)).toEqual(["Frio com URL"]);
  });

  it("respeita o limite", async () => {
    await db.insert(targetAccount).values(
      Array.from({ length: 5 }, (_, i) => ({
        name: `Alvo ${i}`,
        category: "peer",
        linkedinUrl: `https://www.linkedin.com/in/alvo-${i}`,
        status: "identified",
      })),
    );
    expect(await coldTargets(3)).toHaveLength(3);
    expect(await coldTargets()).toHaveLength(5);
  });
});
