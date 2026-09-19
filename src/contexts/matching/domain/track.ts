/**
 * Trilha de alvo: o que a pessoa persegue, separado de quem a pessoa é.
 *
 * O perfil de matching tem duas metades que o scorer sempre leu juntas:
 *
 * | Metade | Campos | Por quê |
 * |---|---|---|
 * | alvo (por trilha) | `targets`, `keywords`, `seniority.min_years_expected`, `seniority.reject_below_years`, `compensation.ranges`, `compensation.reference_currency` | o que muda quando a pessoa aceita outro tipo de vaga |
 * | pessoa | `constraints`, `blockers`, `compensation.project`, `compensation.benefits`, `seniority.years_experience`, `evidence`, `growth`, `cv`, `identity` | fato sobre a pessoa; "sem autorização nos EUA" não é preferência |
 *
 * A trilha guarda só a metade-alvo. O scorer recebe a soma das duas por
 * `effectiveProfile` e não muda de forma (ADR-009).
 *
 * Função pura: sem banco, sem rede, sem relógio.
 */
import { isDeepStrictEqual } from "node:util";
import type { FxTable } from "../../../core/money.ts";
import { ProfileSchema, type Profile } from "../../../core/profile/schema.ts";
import { matchesTerm, termKey, validateTerm, type ValidTerm } from "../../../core/term.ts";
import type { SkillDefinition } from "../../skills/index.ts";

export type TrackTarget = {
  targets: Profile["targets"];
  keywords: Profile["keywords"];
  seniority: Pick<Profile["seniority"], "min_years_expected" | "reject_below_years">;
  compensation: Pick<Profile["compensation"], "reference_currency" | "ranges">;
};

export type TrackStatus = "active" | "archived";
export type UnreviewedField = "targets" | "compensation" | "seniority";

export type Track = {
  id: number;
  candidateId: number;
  name: string;
  isPrimary: boolean;
  status: TrackStatus;
  position: number;
  /** Null is a pending primary: no own profile, so no ranking (M-06). */
  target: TrackTarget | null;
  unreviewed: UnreviewedField[];
  updatedAt: string;
};

export type TrackError =
  | "track_name_invalid"
  | "track_titles_required"
  | "track_keywords_required"
  | "keyword_weight_invalid"
  | "range_required"
  | "range_invalid"
  | "range_duplicate"
  | "range_currency_unknown"
  | "range_reference_missing";

export const TRACK_NAME_MAX = 40;
export const MAX_ACTIVE_TRACKS = 6;
export const KEYWORD_WEIGHT_MAX = 10;
export const PAY_AMOUNT_MAX = 10_000_000;

/** A parte-alvo de um perfil completo. */
export function targetOf(profile: Profile): TrackTarget {
  return structuredClone({
    targets: profile.targets,
    keywords: profile.keywords,
    seniority: {
      min_years_expected: profile.seniority.min_years_expected,
      reject_below_years: profile.seniority.reject_below_years,
    },
    compensation: {
      reference_currency: profile.compensation.reference_currency,
      ranges: profile.compensation.ranges,
    },
  });
}

/**
 * O perfil que o scorer lê para uma trilha: pessoa + alvo.
 *
 * Passa pelo `ProfileSchema` para que uma trilha incoerente com a pessoa (faixa
 * sem a moeda de referência, por exemplo) falhe aqui, e não em silêncio dentro
 * do scorer.
 */
export function effectiveProfile(person: Profile, target: TrackTarget): Profile {
  return ProfileSchema.parse({
    ...person,
    targets: target.targets,
    keywords: target.keywords,
    seniority: { ...person.seniority, ...target.seniority },
    compensation: {
      ...person.compensation,
      reference_currency: target.compensation.reference_currency,
      ranges: target.compensation.ranges,
    },
  });
}

export function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

export function validateTrackName(
  name: string,
): { ok: true; name: string; key: string } | { ok: false; code: "track_name_invalid" } {
  const trimmed = name.trim();
  if (trimmed.length < 1 || [...trimmed].length > TRACK_NAME_MAX) {
    return { ok: false, code: "track_name_invalid" };
  }
  return { ok: true, name: trimmed, key: nameKey(trimmed) };
}

function positiveKeywords(target: TrackTarget) {
  return [...target.keywords.critical, ...target.keywords.strong, ...target.keywords.stack];
}

function titlesOf(target: TrackTarget): string[] {
  return Object.values(target.targets.clusters).flatMap((cluster) => cluster.titles);
}

function knownCurrencies(rates: FxTable | null): Set<string> | null {
  if (!rates) return null;
  return new Set([rates.base.toUpperCase(), ...Object.keys(rates.rates).map((code) => code.toUpperCase())]);
}

/**
 * As regras que a trilha precisa cumprir para ser salva.
 *
 * A escala de peso é a do `profile.yaml` (positivos 2–10, negativos −3 a −6):
 * inteiros de 1 a 10 nas listas positivas e de −10 a −1 na negativa. Sem as
 * cotações carregadas a moeda não é conferida — não dá para distinguir moeda
 * desconhecida de cotação ausente.
 */
export function validateTrackTarget(
  target: TrackTarget,
  rates: FxTable | null,
): { ok: true } | { ok: false; code: TrackError } {
  if (titlesOf(target).filter((title) => title.trim()).length === 0) {
    return { ok: false, code: "track_titles_required" };
  }
  const positives = positiveKeywords(target);
  if (positives.length === 0) return { ok: false, code: "track_keywords_required" };
  const positiveOk = positives.every(
    (keyword) => Number.isInteger(keyword.weight) && keyword.weight >= 1 && keyword.weight <= KEYWORD_WEIGHT_MAX,
  );
  const negativeOk = target.keywords.negative.every(
    (keyword) => Number.isInteger(keyword.weight) && keyword.weight <= -1 && keyword.weight >= -KEYWORD_WEIGHT_MAX,
  );
  if (!positiveOk || !negativeOk) return { ok: false, code: "keyword_weight_invalid" };

  const ranges = target.compensation.ranges;
  if (ranges.length === 0) return { ok: false, code: "range_required" };
  for (const range of ranges) {
    const ordered =
      range.floor > 0 &&
      range.floor <= range.target &&
      (range.ideal == null || range.target <= range.ideal);
    const top = range.ideal ?? range.target;
    if (!ordered || top > PAY_AMOUNT_MAX) return { ok: false, code: "range_invalid" };
  }
  const pairs = ranges.map((range) => `${range.currency.toUpperCase()}/${range.period}`);
  if (new Set(pairs).size !== pairs.length) return { ok: false, code: "range_duplicate" };
  const known = knownCurrencies(rates);
  if (known && ranges.some((range) => !known.has(range.currency.toUpperCase()))) {
    return { ok: false, code: "range_currency_unknown" };
  }
  const reference = target.compensation.reference_currency.toUpperCase();
  if (!ranges.some((range) => range.currency.toUpperCase() === reference)) {
    return { ok: false, code: "range_reference_missing" };
  }
  return { ok: true };
}

/**
 * A vaga pertence a uma trilha aceita?
 *
 * Só título e descrição — o scorer nunca leu o nome da empresa, e uma trilha
 * que pontuasse "Laravel Partners" sem Laravel na vaga daria nota a nada.
 * Palavra negativa não torna vaga relevante: ela só existe para rebaixar.
 */
export function isRelevant(target: TrackTarget, job: { title: string; description: string | null }): boolean {
  const text = `${job.title}\n${job.description ?? ""}`;
  return (
    titlesOf(target).some((title) => matchesTerm(title, text)) ||
    positiveKeywords(target).some((keyword) => matchesTerm(keyword.term, text))
  );
}

function slugOf(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9+#]+/g, "-")
    .replace(/^-|-$/g, "") || "track";
}

function catalogMatch(key: string, catalog: readonly SkillDefinition[]): SkillDefinition | undefined {
  return catalog.find((skill) => [skill.name, ...skill.aliases].some((alias) => termKey(alias) === key));
}

/**
 * A trilha sugerida a partir de um termo. Determinística: mesma entrada, mesma
 * saída, sem modelo no caminho.
 *
 * Termo reconhecido pelo catálogo ganha quatro títulos com o nome canônico;
 * termo desconhecido ganha um título genérico e sai marcado como `thin`, para a
 * tela avisar que a sugestão tem pouco em que se apoiar. Faixas e senioridade
 * vêm da trilha principal — quem edita é o candidato (US-019 EC-2).
 */
export function suggestTrack(input: {
  term: string | ValidTerm;
  catalog: readonly SkillDefinition[];
  primary: TrackTarget;
}): { target: TrackTarget; thin: boolean } {
  const valid =
    typeof input.term === "string"
      ? (() => {
          const result = validateTerm(input.term);
          return result.ok ? result.value : { term: input.term.trim(), key: termKey(input.term) };
        })()
      : input.term;
  const skill = catalogMatch(valid.key, input.catalog);
  const name = skill?.name ?? valid.term;
  const titles = skill
    ? [`${name} Developer`, `Senior ${name} Developer`, `${name} Engineer`, `Backend Engineer (${name})`]
    : [`${name} Developer`];
  const cluster = slugOf(skill?.slug ?? name);
  return {
    thin: !skill,
    target: {
      targets: { clusters: { [cluster]: { weight: 1, titles, cv_variant: cluster } }, avoid_titles: [] },
      keywords: {
        critical: [{ term: name.toLowerCase(), weight: KEYWORD_WEIGHT_MAX }],
        strong: [],
        stack: [],
        negative: [],
      },
      seniority: structuredClone(input.primary.seniority),
      compensation: structuredClone(input.primary.compensation),
    },
  };
}

/** A evidência que pode sustentar uma trilha — sempre a do próprio candidato. */
export type OwnEvidence = {
  /** Linhas de `evidence` do perfil da pessoa. */
  lines: string[];
  /** Nomes das skills que o candidato confirmou. */
  confirmedSkills: string[];
  /**
   * `evidence` herdada do perfil padrão (de outra pessoa) por derivação.
   * Nesse caso as linhas não sustentam nada.
   */
  inherited: boolean;
};

/**
 * Quais palavras-chave da trilha a evidência sustenta, e quais são lacuna.
 *
 * `growth` nunca sustenta: é lacuna assumida por definição (regra 7 do
 * AGENTS.md). O marcador nunca muda a nota.
 */
export function evidenceSupport(
  target: TrackTarget,
  evidence: OwnEvidence,
): { supported: string[]; gaps: string[] } {
  const lines = evidence.inherited ? [] : evidence.lines;
  const confirmed = new Set(evidence.confirmedSkills.map(termKey));
  const supported: string[] = [];
  const gaps: string[] = [];
  const seen = new Set<string>();
  for (const { term } of positiveKeywords(target)) {
    const key = termKey(term);
    if (seen.has(key)) continue;
    seen.add(key);
    const backed = confirmed.has(key) || lines.some((line) => matchesTerm(term, line));
    (backed ? supported : gaps).push(term);
  }
  return { supported, gaps };
}

/**
 * Campos-alvo que um perfil derivado herdou do padrão sem que a pessoa os
 * tenha salvo. O dono do perfil padrão não herda nada: o padrão é dele.
 */
export function inheritedFields(
  candidateProfile: Profile,
  defaultProfile: Profile,
  opts: { isOwner: boolean },
): UnreviewedField[] {
  if (opts.isOwner) return [];
  const own = targetOf(candidateProfile);
  const base = targetOf(defaultProfile);
  const fields: UnreviewedField[] = [];
  if (isDeepStrictEqual(own.targets, base.targets)) fields.push("targets");
  if (isDeepStrictEqual(own.compensation, base.compensation)) fields.push("compensation");
  return fields;
}

/** A evidência da pessoa é a do perfil padrão, herdada por derivação? */
export function evidenceInherited(person: Profile, defaultProfile: Profile, opts: { isOwner: boolean }): boolean {
  if (opts.isOwner) return false;
  return Object.keys(person.evidence).length > 0 && isDeepStrictEqual(person.evidence, defaultProfile.evidence);
}

/**
 * A trilha ativa que já tem o termo entre as palavras-chave, para vir marcada.
 *
 * Vence a que dá MAIS peso ao termo, não a primeira: o perfil do dono cita
 * `laravel` com peso 2 no `stack`, e marcar a trilha de IA para quem acabou de
 * criar uma trilha PHP com `laravel` crítico seria escolher a errada. Empate vai
 * para a posição menor.
 */
export function preselectTrack<T extends Pick<Track, "status" | "position" | "target">>(
  term: string,
  tracks: readonly T[],
): T | null {
  const key = termKey(term);
  let best: { track: T; weight: number } | null = null;
  for (const track of tracks) {
    if (track.status !== "active" || !track.target) continue;
    const weights = positiveKeywords(track.target)
      .filter((keyword) => termKey(keyword.term) === key)
      .map((keyword) => keyword.weight);
    if (weights.length === 0) continue;
    const weight = Math.max(...weights);
    if (!best || weight > best.weight || (weight === best.weight && track.position < best.track.position)) {
      best = { track, weight };
    }
  }
  return best?.track ?? null;
}
