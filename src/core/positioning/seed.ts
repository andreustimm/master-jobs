/**
 * Seeding the positioning plan and the July 2026 metrics baseline.
 *
 * Idempotent by design: re-seeding refreshes the wording of a task but never
 * resets its status. A task you already marked done stays done.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { metricSnapshot, positioningTask } from "../db/schema.ts";
import { POSITIONING_PLAN } from "./plan.ts";

/** Baseline recorded in the audit on 2026-07-27 (§2.1). */
const BASELINE = {
  at: "2026-07-27",
  metrics: [
    { key: "ssi_total", value: 59, note: "Top 2% do setor, top 8% da rede" },
    { key: "ssi_brand", value: 15.28, note: "Estabelecer marca profissional" },
    { key: "ssi_people", value: 10.24, note: "Localizar as pessoas certas" },
    { key: "ssi_insights", value: 8.1, note: "Interagir com insights — pilar mais fraco" },
    { key: "ssi_relationships", value: 25, note: "Criar relacionamentos — máximo" },
    { key: "search_appearances_7d", value: 72, note: "14–20 de julho" },
    { key: "profile_views_7d", value: 1362, note: "14–20 de julho, +28%" },
    { key: "views_from_search_pct", value: 5.3, note: "Origem das exibições" },
    { key: "recruiter_views_1y", value: 97, note: "Visualizações por recrutadores" },
    { key: "followers", value: 2717, note: "Seguidores no LinkedIn" },
    { key: "recommendations_received", value: 2, note: "Uma recente, uma de 2012" },
  ],
};

export type SeedResult = {
  tasksInserted: number;
  tasksUpdated: number;
  metricsInserted: number;
};

export async function seedPositioning(): Promise<SeedResult> {
  const db = getDb();
  let inserted = 0;
  let updated = 0;

  for (const task of POSITIONING_PLAN) {
    const existing = await db
      .select({ id: positioningTask.id })
      .from(positioningTask)
      .where(sql`${positioningTask.id} = ${task.id}`)
      .limit(1);

    if (existing.length === 0) {
      await db.insert(positioningTask).values(task);
      inserted++;
    } else {
      // Refresh the text, never the status — progress belongs to the user.
      await db
        .update(positioningTask)
        .set({
          horizon: task.horizon,
          title: task.title,
          why: task.why ?? null,
          how: task.how ?? null,
          expected: task.expected ?? null,
          priority: task.priority,
          effort: task.effort ?? null,
          sourceRef: task.sourceRef ?? null,
        })
        .where(sql`${positioningTask.id} = ${task.id}`);
      updated++;
    }
  }

  let metricsInserted = 0;
  for (const m of BASELINE.metrics) {
    const result = await db
      .insert(metricSnapshot)
      .values({ at: BASELINE.at, key: m.key, value: m.value, note: m.note })
      .onConflictDoNothing()
      .returning({ id: metricSnapshot.id });
    metricsInserted += result.length;
  }

  return { tasksInserted: inserted, tasksUpdated: updated, metricsInserted };
}
