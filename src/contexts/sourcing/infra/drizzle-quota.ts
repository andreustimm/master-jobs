/**
 * O livro de cota em PostgreSQL (ADR-010).
 *
 * Cada janela é uma linha, e a reserva é UM upsert condicional: soma 1 só se o
 * uso está abaixo do limite, e devolve a linha só quando somou. Ler antes e
 * gravar depois deixaria dez trabalhadores verem "3 de 4" ao mesmo tempo e
 * passarem juntos.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../../core/db/client.ts";
import { platformQuota } from "../../../core/db/schema.ts";
import type { FetchableSourceKind } from "../../../core/sources/types.ts";
import { nextWindowAt, windowStarts, type WindowKind } from "../domain/windows.ts";
import type { PlatformQuotaPort } from "../ports.ts";

/** Marca de dia esgotado por 429: acima de qualquer limite declarado. */
const EXHAUSTED = 2_147_483_647;
/** Plataforma sem limite diário publicado: o dia ainda conta, mas não trava. */
const UNLIMITED = EXHAUSTED - 1;

async function take(platform: string, kind: WindowKind, start: string, limit: number): Promise<boolean> {
  const rows = await getDb()
    .insert(platformQuota)
    .values({ platform, windowKind: kind, windowStart: start, used: 1 })
    .onConflictDoUpdate({
      target: [platformQuota.platform, platformQuota.windowKind, platformQuota.windowStart],
      set: { used: sql`${platformQuota.used} + 1` },
      setWhere: sql`${platformQuota.used} < ${limit}`,
    })
    .returning({ used: platformQuota.used });
  return rows.length > 0;
}

/** Devolve a unidade do dia quando a janela de minuto recusou. */
async function release(platform: string, day: string): Promise<void> {
  await getDb()
    .update(platformQuota)
    .set({ used: sql`${platformQuota.used} - 1` })
    .where(
      and(
        eq(platformQuota.platform, platform),
        eq(platformQuota.windowKind, "day"),
        eq(platformQuota.windowStart, day),
        sql`${platformQuota.used} between 1 and ${UNLIMITED}`,
      ),
    );
}

export const drizzleQuota: PlatformQuotaPort = {
  async reserve(platform, budget, now) {
    const { day, minute } = windowStarts(now);
    if (!(await take(platform, "day", day, budget.perDay ?? UNLIMITED))) {
      return { ok: false, retryAt: nextWindowAt("day", day) };
    }
    if (budget.perMinute !== undefined && !(await take(platform, "minute", minute, budget.perMinute))) {
      await release(platform, day);
      return { ok: false, retryAt: nextWindowAt("minute", minute) };
    }
    return { ok: true };
  },

  async exhaustDay(platform, now) {
    const { day } = windowStarts(now);
    await getDb()
      .insert(platformQuota)
      .values({ platform, windowKind: "day", windowStart: day, used: EXHAUSTED })
      .onConflictDoUpdate({
        target: [platformQuota.platform, platformQuota.windowKind, platformQuota.windowStart],
        set: { used: EXHAUSTED },
      });
  },
};

/** Uso corrente das duas janelas, para a tela de saúde. */
export async function quotaUsage(
  platform: FetchableSourceKind,
  now: Date,
): Promise<{ dayUsed: number; minuteUsed: number; exhausted: boolean }> {
  const { day, minute } = windowStarts(now);
  const rows = await getDb()
    .select({ kind: platformQuota.windowKind, start: platformQuota.windowStart, used: platformQuota.used })
    .from(platformQuota)
    .where(
      and(
        eq(platformQuota.platform, platform),
        sql`(${platformQuota.windowKind}, ${platformQuota.windowStart}) in (('day', ${day}), ('minute', ${minute}))`,
      ),
    );
  const dayUsed = rows.find((row) => row.kind === "day")?.used ?? 0;
  return {
    dayUsed,
    minuteUsed: rows.find((row) => row.kind === "minute")?.used ?? 0,
    exhausted: dayUsed >= EXHAUSTED,
  };
}
