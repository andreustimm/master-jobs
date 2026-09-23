/**
 * A consulta da tela Vagas: análise do texto, ordem por relevância e a
 * explicação de por que cada vaga apareceu (#223, tarefa 05).
 *
 * Função pura: sem banco, sem rede, sem relógio. O filtro de palavra inteira
 * (`term.ts`) continua sendo o único juiz de QUAIS vagas voltam; isto só decide
 * a ORDEM e o que a tela diz sobre cada uma (adenda A4).
 */

export type ParsedQuery = {
  /** Trechos fora de aspas, cada um com a semântica do termo de sempre. */
  terms: string[];
  /** Trechos entre aspas: as palavras nessa ordem, separadas só por espaço. */
  phrases: string[];
};

const squash = (text: string) => text.trim().replace(/\s+/g, " ");

/**
 * `tech lead` continua sendo UM termo — o mesmo conjunto de antes da tarefa —,
 * e `"tech lead"` vira frase. Aspas desbalanceadas não adivinham intenção: o
 * texto inteiro volta como termo, sem as aspas. `C#` e `C++` passam literais.
 */
export function parseQuery(raw: string): ParsedQuery {
  const quotes = [...raw].filter((char) => char === '"').length;
  if (quotes % 2 === 1) {
    const plain = squash(raw.replaceAll('"', " "));
    return { terms: plain ? [plain] : [], phrases: [] };
  }
  const terms: string[] = [];
  const phrases: string[] = [];
  raw.split('"').forEach((part, index) => {
    const text = squash(part);
    if (!text) return;
    // Pedaço de índice ímpar está entre um par de aspas.
    (index % 2 === 1 ? phrases : terms).push(text);
  });
  return { terms, phrases };
}

export type MatchField = "title" | "company" | "location" | "description";

/** Onde o termo casou diz quanto ele pesa: cargo antes de empresa, empresa antes do resto. */
const FIELD_STRENGTH: Record<MatchField, number> = { title: 0, company: 1, location: 2, description: 2 };
const FIELD_ORDER: readonly MatchField[] = ["title", "company", "location", "description"];

/** O campo mais forte entre os casados; sem campo, depois de todos. */
export function relevanceRank(fields: readonly MatchField[]): number {
  return fields.reduce((best, field) => Math.min(best, FIELD_STRENGTH[field]), 3);
}

export type RankedRow = {
  fields: MatchField[];
  fit: number | null;
  /** Publicação, ou primeira vista quando a fonte não diz — como o quadro ordena por recência. */
  postedAt: string | null;
  id: number;
};

/**
 * Campo mais forte, depois fit, recência e id. É a mesma ordem do `ORDER BY`
 * de `boardOrder` com `sort=relevance`, e o teste de integração compara as duas
 * na fixture. Fit ausente conta como zero, como a ordenação por fit já faz.
 */
export function compareByRelevance(a: RankedRow, b: RankedRow): number {
  const rank = relevanceRank(a.fields) - relevanceRank(b.fields);
  if (rank !== 0) return rank;
  const fit = (b.fit ?? 0) - (a.fit ?? 0);
  if (fit !== 0) return fit;
  if (a.postedAt !== b.postedAt) {
    if (a.postedAt === null) return 1;
    if (b.postedAt === null) return -1;
    return a.postedAt < b.postedAt ? 1 : -1;
  }
  return a.id - b.id;
}

export type MatchSignal = { kind: "field"; field: MatchField } | { kind: "proximity" };

/**
 * Só o que de fato contribuiu: cada campo casado, uma vez, na ordem de força,
 * e a proximidade quando foi ela que trouxe a vaga. Não existe sinal
 * "semântico": sem vetor persistido não há o que dizer, e a tela não finge.
 */
export function explainMatch(input: { fields: readonly MatchField[]; proximity: boolean }): MatchSignal[] {
  const signals: MatchSignal[] = FIELD_ORDER.filter((field) => input.fields.includes(field)).map((field) => ({
    kind: "field",
    field,
  }));
  if (input.proximity) signals.push({ kind: "proximity" });
  return signals;
}
