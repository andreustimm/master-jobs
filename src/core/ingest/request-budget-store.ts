/**
 * O contador de `request-budget.ts` em PostgreSQL.
 *
 * Mesma forma do livro de cota por plataforma: a reserva é UM upsert
 * condicional que só soma abaixo do teto e só devolve linha quando somou.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { requestBudget } from "../db/schema.ts";
import { budgetDay, DAILY_REQUEST_BUDGET, type RequestBudget, type RequestRoutine } from "./request-budget.ts";

export function drizzleRequestBudget(
  limits: Readonly<Record<RequestRoutine, number | null>> = DAILY_REQUEST_BUDGET,
): RequestBudget {
  return {
    async take(routine, now) {
      const day = budgetDay(now);
      const limit = limits[routine];
      const rows = await getDb()
        .insert(requestBudget)
        .values({ routine, day, used: 1 })
        .onConflictDoUpdate({
          target: [requestBudget.routine, requestBudget.day],
          set: { used: sql`${requestBudget.used} + 1` },
          ...(limit === null ? {} : { setWhere: sql`${requestBudget.used} < ${limit}` }),
        })
        .returning({ used: requestBudget.used });
      if (rows.length > 0) return true;
      // A recusa também é telemetria: "a rotina parou por orçamento" precisa
      // aparecer, ou fica igual a "a rotina não tinha trabalho".
      await getDb()
        .update(requestBudget)
        .set({ refused: sql`${requestBudget.refused} + 1` })
        .where(and(eq(requestBudget.routine, routine), eq(requestBudget.day, day)));
      return false;
    },

    async giveBack(routine, now) {
      await getDb()
        .update(requestBudget)
        .set({ used: sql`${requestBudget.used} - 1` })
        .where(
          and(eq(requestBudget.routine, routine), eq(requestBudget.day, budgetDay(now)), sql`${requestBudget.used} > 0`),
        );
    },
  };
}
