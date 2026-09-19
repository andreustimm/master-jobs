import type { TrackTarget } from "../../src/contexts/matching/index.ts";

/**
 * O formulário de trilha em texto, e de volta.
 *
 * Sem JavaScript no cliente: cada lista é um `textarea`, uma linha por item.
 * A estrutura que o perfil já tem — clusters com peso e variante de CV,
 * palavras separadas em críticas, fortes e de stack — volta intacta quando a
 * pessoa só edita. Achatar tudo num cluster só apagaria, na trilha principal,
 * os clusters que decidem qual currículo usar.
 *
 * Formatos:
 *   títulos     `Senior Laravel Developer` ou `backend: Senior Laravel Developer`
 *   palavras    `laravel 10` (peso de 1 a 10) · `wordpress -6` (de -1 a -10)
 *   faixas      `USD month 7500 12500 18000` (moeda período piso alvo ideal)
 */

export type TrackFields = {
  name: string;
  titles: string;
  positives: string;
  negatives: string;
  minYears: string;
  rejectBelow: string;
  ranges: string;
  referenceCurrency: string;
};

export type TrackFormError = "track_titles_required" | "keyword_weight_invalid" | "range_invalid" | "range_required";

const PERIODS = ["year", "month", "week", "day", "hour"] as const;
type Period = (typeof PERIODS)[number];

function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function slug(value: string): string {
  const cleaned = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "track";
}

export function targetToFields(name: string, target: TrackTarget): TrackFields {
  const clusters = Object.entries(target.targets.clusters);
  const prefixed = clusters.length > 1;
  const weighted = (items: Array<{ term: string; weight: number }>) => items.map((k) => `${k.term} ${k.weight}`);
  return {
    name,
    titles: clusters
      .flatMap(([cluster, value]) => value.titles.map((title) => (prefixed ? `${cluster}: ${title}` : title)))
      .join("\n"),
    positives: [
      ...weighted(target.keywords.critical),
      ...weighted(target.keywords.strong),
      ...weighted(target.keywords.stack),
    ].join("\n"),
    negatives: weighted(target.keywords.negative).join("\n"),
    minYears: String(target.seniority.min_years_expected),
    rejectBelow: String(target.seniority.reject_below_years),
    ranges: target.compensation.ranges
      .map((r) => [r.currency, r.period, r.floor, r.target, r.ideal].filter((v) => v !== undefined).join(" "))
      .join("\n"),
    referenceCurrency: target.compensation.reference_currency,
  };
}

function weightedLine(line: string): { term: string; weight: number } | null {
  const match = /^(.*?)\s+(-?\d+)$/.exec(line);
  if (!match) return null;
  return { term: match[1]!.trim().toLowerCase(), weight: Number(match[2]) };
}

/**
 * Lê o formulário sobre a trilha de partida (a própria, ao editar; a
 * principal, ao criar), da qual vêm peso e variante de cada cluster e o
 * grupo de cada palavra já conhecida. As regras de negócio — faixas, pesos,
 * moeda de referência — são conferidas depois, por `validateTrackTarget`.
 */
export function fieldsToTarget(
  fields: TrackFields,
  base: TrackTarget,
): { ok: true; target: TrackTarget } | { ok: false; code: TrackFormError } {
  const defaultCluster = Object.keys(base.targets.clusters).length === 1
    ? Object.keys(base.targets.clusters)[0]!
    : slug(fields.name);
  const clusters: TrackTarget["targets"]["clusters"] = {};
  for (const line of lines(fields.titles)) {
    const prefixed = /^([a-z0-9_]+):\s*(.+)$/i.exec(line);
    const cluster = prefixed ? prefixed[1]!.toLowerCase() : defaultCluster;
    const title = prefixed ? prefixed[2]!.trim() : line;
    const existing = base.targets.clusters[cluster];
    clusters[cluster] ??= { weight: existing?.weight ?? 1, titles: [], cv_variant: existing?.cv_variant ?? cluster };
    clusters[cluster].titles.push(title);
  }
  if (Object.keys(clusters).length === 0) return { ok: false, code: "track_titles_required" };

  const bucketOf = new Map<string, "critical" | "strong" | "stack">();
  for (const bucket of ["critical", "strong", "stack"] as const) {
    for (const keyword of base.keywords[bucket]) bucketOf.set(keyword.term, bucket);
  }
  const keywords: TrackTarget["keywords"] = { critical: [], strong: [], stack: [], negative: [] };
  for (const line of lines(fields.positives)) {
    const keyword = weightedLine(line);
    if (!keyword || keyword.weight < 1) return { ok: false, code: "keyword_weight_invalid" };
    keywords[bucketOf.get(keyword.term) ?? (keyword.weight >= 7 ? "critical" : "strong")].push(keyword);
  }
  for (const line of lines(fields.negatives)) {
    const keyword = weightedLine(line);
    if (!keyword || keyword.weight === 0) return { ok: false, code: "keyword_weight_invalid" };
    keywords.negative.push({ term: keyword.term, weight: -Math.abs(keyword.weight) });
  }

  const ranges: TrackTarget["compensation"]["ranges"] = [];
  for (const line of lines(fields.ranges)) {
    const [currency, period, floor, target, ideal, ...rest] = line.split(/\s+/);
    const numbers = [floor, target, ideal].filter((v) => v !== undefined).map(Number);
    if (
      rest.length > 0 ||
      !currency ||
      !/^[A-Za-z]{3}$/.test(currency) ||
      !PERIODS.includes(period as Period) ||
      numbers.length < 2 ||
      numbers.some((n) => !Number.isFinite(n))
    ) {
      return { ok: false, code: "range_invalid" };
    }
    ranges.push({
      currency: currency.toUpperCase(),
      period: period as Period,
      floor: numbers[0]!,
      target: numbers[1]!,
      ...(numbers[2] !== undefined ? { ideal: numbers[2] } : {}),
    });
  }
  if (ranges.length === 0) return { ok: false, code: "range_required" };

  const minYears = Number(fields.minYears);
  const rejectBelow = Number(fields.rejectBelow);
  return {
    ok: true,
    target: {
      targets: { clusters, avoid_titles: base.targets.avoid_titles },
      keywords,
      seniority: {
        min_years_expected: Number.isFinite(minYears) ? minYears : base.seniority.min_years_expected,
        reject_below_years: Number.isFinite(rejectBelow) ? rejectBelow : base.seniority.reject_below_years,
      },
      compensation: {
        reference_currency: (fields.referenceCurrency || ranges[0]!.currency).toUpperCase(),
        ranges,
      },
    },
  };
}

export function fieldsFrom(formData: FormData): TrackFields {
  const text = (key: keyof TrackFields) => String(formData.get(key) ?? "");
  return {
    name: text("name"),
    titles: text("titles"),
    positives: text("positives"),
    negatives: text("negatives"),
    minYears: text("minYears"),
    rejectBelow: text("rejectBelow"),
    ranges: text("ranges"),
    referenceCurrency: text("referenceCurrency"),
  };
}
