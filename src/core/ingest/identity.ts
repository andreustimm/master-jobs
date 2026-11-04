/**
 * Qual linha de `job` uma observação da sincronização atualiza (#291).
 *
 * O fingerprint (empresa, título, local) junta a mesma vaga vista em dois
 * quadros, mas muda quando a empresa edita o título: a edição virava vaga nova,
 * e a antiga ficava aberta (janela parcial) ou era fechada por ausência
 * (listagem completa) — de um jeito ou de outro, a candidatura ficava presa na
 * linha errada. Dentro de UMA fonte, o id externo é a identidade que a própria
 * fonte garante; o fingerprint continua sendo a ponte entre fontes.
 *
 * Função pura: recebe as linhas já lidas e devolve a decisão. Nada aqui junta
 * ou apaga linha — duas linhas da mesma vaga continuam duas (regra 3), e uma
 * candidatura nunca muda de vaga (regra 2).
 */

export type IdentityRow = {
  id: number;
  fingerprint: string;
  closedAt: string | null;
};

export type IdentityDecision<Row extends IdentityRow> = {
  /** A linha a atualizar; `null` = vaga nova. */
  existing: Row | null;
  /**
   * O fingerprint a gravar. É o novo, a menos que outra linha já o tenha — o
   * índice único recusaria, e juntar as duas linhas seria mover candidatura.
   */
  fingerprint: string;
  /** Por onde a linha foi achada, para teste e diagnóstico. */
  matchedBy: "external-id" | "fingerprint" | "none";
};

/**
 * `byExternal`: linhas da MESMA fonte com o mesmo id externo (pode haver mais
 * de uma, herança de quando só o fingerprint identificava). `byFingerprint`: a
 * linha dona do fingerprint novo, de qualquer fonte.
 *
 * Entre várias linhas do mesmo id externo, a preferência é: a que já tem o
 * fingerprint novo; depois a aberta; depois a mais antiga — a que tem mais
 * chance de carregar a candidatura. Estável, para duas rodadas escolherem a
 * mesma.
 */
export function resolveObservedIdentity<Row extends IdentityRow>(input: {
  fingerprint: string;
  byExternal: readonly Row[];
  byFingerprint: Row | null;
}): IdentityDecision<Row> {
  const chosen = pickExternal(input.byExternal, input.fingerprint);
  if (!chosen) {
    return {
      existing: input.byFingerprint,
      fingerprint: input.fingerprint,
      matchedBy: input.byFingerprint ? "fingerprint" : "none",
    };
  }
  const taken = input.byFingerprint !== null && input.byFingerprint.id !== chosen.id;
  return {
    existing: chosen,
    fingerprint: taken ? chosen.fingerprint : input.fingerprint,
    matchedBy: "external-id",
  };
}

function pickExternal<Row extends IdentityRow>(rows: readonly Row[], fingerprint: string): Row | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => {
    const sameA = a.fingerprint === fingerprint ? 0 : 1;
    const sameB = b.fingerprint === fingerprint ? 0 : 1;
    if (sameA !== sameB) return sameA - sameB;
    const openA = a.closedAt === null ? 0 : 1;
    const openB = b.closedAt === null ? 0 : 1;
    if (openA !== openB) return openA - openB;
    return a.id - b.id;
  })[0]!;
}

/**
 * O id externo que vale como identidade, ou `null`.
 *
 * Vazio não identifica nada (regra 17: API devolve `""` para campo não
 * preenchido). E um id que aparece com dois fingerprints na MESMA listagem não
 * é identidade daquela listagem: tratá-lo como tal faria as duas vagas
 * disputarem uma linha, trocando de conteúdo a cada rodada. Nesses casos vale o
 * fingerprint, como antes.
 */
export function usableExternalId(externalId: string | null | undefined, ambiguous: ReadonlySet<string>): string | null {
  const key = externalId?.trim();
  if (!key) return null;
  return ambiguous.has(key) ? null : key;
}

/** Ids externos que a listagem repete com fingerprints diferentes. */
export function ambiguousExternalIds(entries: readonly { externalId: string | null | undefined; fingerprint: string }[]): Set<string> {
  const seen = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const entry of entries) {
    const key = entry.externalId?.trim();
    if (!key) continue;
    const previous = seen.get(key);
    if (previous === undefined) seen.set(key, entry.fingerprint);
    else if (previous !== entry.fingerprint) ambiguous.add(key);
  }
  return ambiguous;
}

export type RetiredIdentity = {
  fingerprint: string;
  sourceId: string;
  externalId: string;
  externalUsable: boolean;
  expiredAt: string;
};

export const RETIRED_FINGERPRINT_DAYS = 90;

/**
 * A live row wins over a marker: it may contain a person's decisions. External
 * IDs are only usable when both the original and the current listing can
 * identify the posting unambiguously. Human-authored imports bypass expiry.
 */
export function isRetiredObservation(input: {
  fingerprint: string;
  sourceId: string;
  externalKey: string | null;
  hasLiveMatch: boolean;
  humanAuthored: boolean;
  tombstones: readonly RetiredIdentity[];
  observedAt: string;
  postedAt?: string | null;
}): boolean {
  if (input.hasLiveMatch || input.humanAuthored) return false;
  const observed = Date.parse(input.observedAt);
  const posted = Date.parse(input.postedAt ?? "");
  return input.tombstones.some((marker) => {
    const expired = Date.parse(marker.expiredAt);
    // A publication dated after removal is a new posting, including reused IDs.
    if (Number.isFinite(posted) && posted > expired) return false;
    const sameSource = marker.sourceId === input.sourceId;
    const reliableIds = input.externalKey !== null && marker.externalUsable;
    if (sameSource && reliableIds) return marker.externalId === input.externalKey;
    // Fingerprints contain only company/title/location. Keep their fallback
    // suppression bounded so future hiring for the same role can be discovered.
    const withinWindow = Number.isFinite(observed) && Number.isFinite(expired)
      && observed >= expired && observed - expired < RETIRED_FINGERPRINT_DAYS * 86_400_000;
    return marker.fingerprint === input.fingerprint && withinWindow;
  });
}
