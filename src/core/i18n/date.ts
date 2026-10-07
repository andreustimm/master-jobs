/**
 * O dia de um instante, no formato do idioma e no fuso pedido.
 *
 * Sem `timeZone`, vale o fuso de quem executa: no navegador, o de quem lê. O
 * servidor roda em UTC, e é por isso que a data de uma candidatura feita às
 * 23:45 em São Paulo saía com o dia seguinte quando formatada lá (#494).
 */
export function formatDay(iso: string, locale: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", ...(timeZone ? { timeZone } : {}) }).format(date);
}
