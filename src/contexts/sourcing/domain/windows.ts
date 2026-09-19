/**
 * Janelas de cota e de repetição diária, em UTC.
 *
 * O dia da cota é o dia UTC, não o do Brasil: as plataformas contam no relógio
 * delas, e uma janela que virasse às 21h de Brasília gastaria o limite de dois
 * dias num só (ADR-010).
 *
 * Função pura: recebe o instante, nunca lê o relógio.
 */
export type WindowKind = "day" | "minute";

/** `{ day: "2026-09-18", minute: "2026-09-18T14:03" }`. */
export function windowStarts(now: Date): { day: string; minute: string } {
  const iso = now.toISOString();
  return { day: iso.slice(0, 10), minute: iso.slice(0, 16) };
}

/** O primeiro instante da janela seguinte, em ISO. */
export function nextWindowAt(kind: WindowKind, start: string): string {
  const begin = kind === "day" ? Date.parse(`${start}T00:00:00.000Z`) : Date.parse(`${start}:00.000Z`);
  return new Date(begin + (kind === "day" ? 86_400_000 : 60_000)).toISOString();
}

/** Sem captura da varredura há mais de 36 horas, a repetição diária parou. */
export const DAILY_REPEAT_WINDOW_MS = 36 * 3_600_000;

export function dailyRepeatPaused(lastSweepCaptureAt: string | null, now: Date): boolean {
  if (!lastSweepCaptureAt) return true;
  return now.getTime() - Date.parse(lastSweepCaptureAt) > DAILY_REPEAT_WINDOW_MS;
}
