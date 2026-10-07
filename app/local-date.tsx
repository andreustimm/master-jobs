"use client";

import { useSyncExternalStore } from "react";
import { formatDay } from "../src/core/i18n/date.ts";
import type { LocaleId } from "../src/core/i18n/locales.ts";

const never = () => () => {};

/**
 * Uma data no fuso de quem lê.
 *
 * O servidor não sabe o fuso do navegador: renderizar lá dava o dia em UTC, e
 * quem aplicou às 23:45 em São Paulo lia o dia seguinte (#494). O HTML sai com
 * o dia em UTC (o mesmo que o servidor sempre mostrou) e a hidratação troca
 * pelo dia local, sem divergência de hidratação.
 */
export function LocalDate({ iso, locale, testId }: { iso: string; locale: LocaleId; testId?: string }) {
  const text = useSyncExternalStore(
    never,
    () => formatDay(iso, locale),
    () => formatDay(iso, locale, "UTC"),
  );
  return (
    <time dateTime={iso} data-testid={testId}>
      {text}
    </time>
  );
}
