/**
 * Regras puras da área do recrutador (#465, US-013 – US-015): qual página
 * mostrar, como nomear quem não escolheu nome e o nome do arquivo do
 * currículo.
 */

/** Candidatos por página em `/recruiter` (TechSpec, "Constants"). */
export const RECRUITER_LIST_PAGE_SIZE = 25;
/** Linhas do funil por página na tela do candidato acompanhado (IT-142). */
export const RECRUITER_FUNNEL_PAGE_SIZE = 20;

/**
 * A página pedida, dentro do que existe: não numérica, zero ou negativa cai na
 * primeira; além da última, na última (US-014.EC-2). Lista vazia tem uma
 * página só, a do estado vazio.
 */
export function pageWithin(raw: string | string[] | undefined, total: number, pageSize: number): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const asked = value !== undefined && /^\d{1,9}$/.test(value) ? Number(value) : 1;
  return Math.min(Math.max(asked, 1), pages);
}

/**
 * O id do candidato num segmento de URL ou num campo de formulário. Só
 * dígitos: `-1`, `1.5`, `1e3` e `abc` não são id, e quem chama responde o
 * mesmo 404 de um candidato que não existe (US-016.EC-1).
 */
export function parseCandidateSelector(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^\d{1,10}$/.test(raw)) return null;
  const id = Number(raw);
  return id > 0 && Number.isSafeInteger(id) ? id : null;
}

/**
 * Como o recrutador vê o candidato na lista e no título: o nome escolhido ou,
 * sem ele, um rótulo neutro com a headline (US-013.EC-2). Nunca o e-mail, que
 * nem entra aqui.
 */
export function candidateLabel(name: string, headline: string | null): { named: true; name: string } | { named: false; headline: string | null } {
  const chosen = name.trim();
  if (chosen !== "") return { named: true, name: chosen };
  const line = headline?.trim() ?? "";
  return { named: false, headline: line === "" ? null : line };
}

/**
 * Nome do arquivo do currículo baixado: o nome do candidato, sem acento nem
 * pontuação, e nenhum id interno (US-015.EC-6). Sem nome aproveitável, só `cv`.
 */
export function cvFileName(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return base === "" ? "cv.md" : `${base}-cv.md`;
}
