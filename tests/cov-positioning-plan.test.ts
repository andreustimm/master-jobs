import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { metricSnapshot, positioningTask } from "../src/core/db/schema.ts";
import { POSITIONING_PLAN } from "../src/core/positioning/plan.ts";
import { seedPositioning } from "../src/core/positioning/seed.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * O plano da auditoria de posicionamento é mantido como DADO, não como prosa,
 * justamente para poder ser consultado e medido. O que se testa aqui é que ele
 * continua consultável: id estável, horizonte conhecido, prioridade conhecida.
 * Um item com horizonte inventado não aparece em `jho tasks list --horizon`, e
 * some do plano sem nenhum erro.
 */
let db: DB;

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(() => {
  releaseTestDb();
});

describe("POSITIONING_PLAN: o plano precisa continuar consultável", () => {
  it("usa id PT-XXXX com quatro dígitos, sem buraco nem repetição", async () => {
    // O id é a alça que o usuário digita em `jho tasks done PT-0001`. Formato
    // irregular quebra ordenação lexicográfica, e id repetido faria o seed
    // atualizar a tarefa errada em silêncio.
    const ids = POSITIONING_PLAN.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^PT-\d{4}$/);
    expect(ids).toEqual([...ids].sort());
  });

  it("declara apenas horizontes e prioridades que a CLI sabe filtrar", () => {
    // `--horizon 24h` e a ordenação por P0/P1 são a única forma de o plano
    // virar rotina. Um valor fora do vocabulário simplesmente desaparece.
    const horizontes = new Set(["24h", "week", "30d", "60d", "90d"]);
    const prioridades = new Set(["P0", "P1", "P2", "P3"]);
    for (const tarefa of POSITIONING_PLAN) {
      expect(horizontes.has(tarefa.horizon), `${tarefa.id}: ${tarefa.horizon}`).toBe(true);
      expect(prioridades.has(tarefa.priority), `${tarefa.id}: ${tarefa.priority}`).toBe(true);
    }
  });

  it("mantém cada tarefa rastreável até o parágrafo da auditoria", () => {
    // `sourceRef` é o que impede o plano de virar lista de tarefas órfã: seis
    // meses depois, "por que isto está aqui?" tem resposta verificável.
    for (const tarefa of POSITIONING_PLAN) {
      expect(tarefa.sourceRef, tarefa.id).toMatch(/§/);
      expect(tarefa.title!.length, tarefa.id).toBeGreaterThan(5);
      expect(tarefa.why, tarefa.id).toBeTruthy();
      expect(tarefa.how, tarefa.id).toBeTruthy();
      expect(tarefa.expected, tarefa.id).toBeTruthy();
    }
  });

  it("começa pelas primeiras 24 horas e todas elas são P0 ou quase", () => {
    // A ordem de leitura do plano é a ordem de execução. Se a primeira faixa
    // não concentrasse os P0, o usuário gastaria o primeiro dia no item errado.
    const primeiras = POSITIONING_PLAN.filter((t) => t.horizon === "24h");
    expect(primeiras.length).toBeGreaterThanOrEqual(5);
    expect(primeiras.filter((t) => t.priority === "P0").length).toBeGreaterThanOrEqual(4);
    expect(POSITIONING_PLAN[0]?.id).toBe("PT-0001");
  });

  it("não traz status embutido — progresso é do usuário, não do plano", () => {
    // Se o plano carregasse `status`, re-semear zeraria o progresso de quem
    // já tinha executado metade dele.
    for (const tarefa of POSITIONING_PLAN) {
      expect(Object.hasOwn(tarefa, "status"), tarefa.id).toBe(false);
      expect(Object.hasOwn(tarefa, "doneAt"), tarefa.id).toBe(false);
    }
  });
});

describe("seedPositioning: idempotente, e nunca reseta progresso", () => {
  it("insere o plano inteiro e a linha de base de métricas na primeira vez", async () => {
    const r = await seedPositioning();

    expect(r).toEqual({
      tasksInserted: POSITIONING_PLAN.length,
      tasksUpdated: 0,
      metricsInserted: 11,
    });

    const tarefas = await db.select().from(positioningTask);
    expect(tarefas).toHaveLength(POSITIONING_PLAN.length);
    // Todo mundo nasce em "todo": o seed descreve o que fazer, não o que já
    // foi feito.
    expect(tarefas.every((t) => t.status === "todo")).toBe(true);

    // Sem linha de base não há como saber se as mudanças funcionaram — é o
    // motivo de PT-0006 existir.
    const metricas = await db.select().from(metricSnapshot);
    expect(metricas.every((m) => m.at === "2026-07-27")).toBe(true);
    expect(metricas.find((m) => m.key === "ssi_total")?.value).toBe(59);
    expect(metricas.find((m) => m.key === "ssi_insights")?.note).toContain("mais fraco");
  });

  it("na segunda vez atualiza o texto e preserva o que o usuário marcou", async () => {
    // A garantia central: reexecutar o seed depois de concluir tarefas não
    // pode apagar o trabalho. É o mesmo contrato de idempotência que vale
    // para sync e import.
    await seedPositioning();
    await db
      .update(positioningTask)
      .set({ status: "done", doneAt: "2026-08-01T00:00:00.000Z" })
      .where(eq(positioningTask.id, "PT-0001"));
    // Simula um texto envelhecido em disco para provar que o refresh ocorre.
    await db
      .update(positioningTask)
      .set({ title: "texto antigo", why: null })
      .where(eq(positioningTask.id, "PT-0002"));

    const r = await seedPositioning();
    expect(r).toEqual({
      tasksInserted: 0,
      tasksUpdated: POSITIONING_PLAN.length,
      metricsInserted: 0,
    });

    const [primeira] = await db
      .select()
      .from(positioningTask)
      .where(eq(positioningTask.id, "PT-0001"));
    expect(primeira).toMatchObject({ status: "done", doneAt: "2026-08-01T00:00:00.000Z" });
    expect(primeira?.title).toBe(POSITIONING_PLAN[0]?.title);

    const [segunda] = await db
      .select()
      .from(positioningTask)
      .where(eq(positioningTask.id, "PT-0002"));
    expect(segunda?.title).toBe(POSITIONING_PLAN[1]?.title);
    expect(segunda?.why).toBe(POSITIONING_PLAN[1]?.why);
  });

  it("não duplica a linha de base quando roda três vezes", async () => {
    // `metric_snapshot` é único por (data, chave). Duplicar a linha de base
    // arruinaria toda comparação de tendência feita depois.
    await seedPositioning();
    await seedPositioning();
    await seedPositioning();
    expect(await db.select().from(metricSnapshot)).toHaveLength(11);
  });
});
