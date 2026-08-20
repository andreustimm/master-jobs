/**
 * Money as a value object: amount + currency + period.
 *
 * Why this exists as its own module: the scorer used to compare a raw number
 * against a floor expressed in USD, ignoring `comp_currency` entirely. The
 * database really does contain postings in CAD, AUD, MXN and PHP, so a
 * 50.000 MXN/month role was being weighed against a 90.000 USD/year floor as
 * if they were the same unit.
 *
 * The period strings are just as messy. Real values observed in the corpus:
 * "annual", "1 YEAR", "year", "hourly", "monthly" — five spellings from five
 * APIs. The old code only recognised "hour" and "month", so an hourly rate
 * fell through to the annual branch and USD 100/hour was scored as USD 100/year,
 * i.e. discarded as below the floor.
 *
 * Everything here is pure. Conversion rates come from the caller (see contexts/fx),
 * never from a network call inside a value object.
 */

/** ISO 4217, uppercase. Kept as a string so new currencies need no code change. */
export type Currency = string;

/**
 * "project" is a fixed-price engagement: the amount is the WHOLE deal, not a
 * rate. It only compares to a salary once you divide by its duration — USD 30k
 * over two months is excellent, the same 30k over a year is below floor. That
 * is why Money carries `durationMonths` and why annualize() refuses to guess
 * when a project has no duration.
 */
export type Period = "year" | "month" | "week" | "day" | "hour" | "project";

export type Money = {
  amount: number;
  currency: Currency;
  period: Period;
  /** Required when period is "project"; ignored otherwise. */
  durationMonths?: number;
};

/**
 * How many of each period fit in a year, for contractor-style normalisation.
 * 2080 = 40h x 52 weeks, the standard full-time equivalent.
 */
export const PERIODS_PER_YEAR: Record<Exclude<Period, "project">, number> = {
  year: 1,
  month: 12,
  week: 52,
  day: 260,
  hour: 2080,
};

const PERIOD_ALIASES: Record<string, Period> = {
  // year
  year: "year",
  annual: "year",
  annually: "year",
  yearly: "year",
  yr: "year",
  "per year": "year",
  "1 year": "year",
  // month
  month: "month",
  monthly: "month",
  mo: "month",
  "per month": "month",
  "1 month": "month",
  // week
  week: "week",
  weekly: "week",
  wk: "week",
  "per week": "week",
  // day
  day: "day",
  daily: "day",
  "per day": "day",
  // hour
  hour: "hour",
  hourly: "hour",
  hr: "hour",
  "per hour": "hour",
  "1 hour": "hour",
  // project / fixed price
  project: "project",
  "fixed price": "project",
  "fixed-price": "project",
  "one time": "project",
  "one-time": "project",
  "per project": "project",
  total: "project",
};

/**
 * Best-effort period parsing across every spelling the sources produce.
 * Returns null rather than guessing, so an unrecognised value is visible
 * instead of silently becoming "year".
 */
export function parsePeriod(raw: string | null | undefined): Period | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  const direct = PERIOD_ALIASES[key];
  if (direct) return direct;
  // "USD / year", "per annum", "salary (annual)"
  for (const [alias, period] of Object.entries(PERIOD_ALIASES)) {
    if (new RegExp(`(^|[^a-z])${alias}([^a-z]|$)`).test(key)) return period;
  }
  if (/annum/.test(key)) return "year";
  return null;
}

/** Normalises a currency code, returning null for anything not ISO-shaped. */
export function parseCurrency(raw: string | null | undefined): Currency | null {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

export function money(
  amount: number,
  currency: Currency,
  period: Period,
  durationMonths?: number,
): Money {
  return { amount, currency: currency.toUpperCase(), period, durationMonths };
}

/**
 * Same currency, expressed per year.
 *
 * Returns null for a fixed-price project with no duration: annualising it would
 * require inventing a timeline, and a wrong guess flips the verdict entirely.
 */
export function annualize(m: Money): Money | null {
  if (m.period === "year") return m;

  if (m.period === "project") {
    if (!m.durationMonths || m.durationMonths <= 0) return null;
    return {
      amount: (m.amount / m.durationMonths) * 12,
      currency: m.currency,
      period: "year",
    };
  }

  return { amount: m.amount * PERIODS_PER_YEAR[m.period], currency: m.currency, period: "year" };
}

/** Same currency, expressed per the requested period. Null when not annualisable. */
export function toPeriod(m: Money, period: Exclude<Period, "project">): Money | null {
  const annual = annualize(m);
  if (!annual) return null;
  if (period === "year") return annual;
  return { amount: annual.amount / PERIODS_PER_YEAR[period], currency: m.currency, period };
}

export type FxTable = {
  /** Every rate is expressed as: 1 unit of `base` buys `rates[code]` units. */
  base: Currency;
  rates: Record<Currency, number>;
  /** ISO date of the quote, for staleness checks and for showing the user. */
  date: string;
};

/**
 * Convert between currencies using a single-base rate table.
 * Returns null when either side is missing from the table — the caller must
 * decide what to do, because silently treating BRL as USD is exactly the bug
 * this module exists to prevent.
 */
export function convert(m: Money, to: Currency, fx: FxTable): Money | null {
  const target = to.toUpperCase();
  if (m.currency === target) return m;

  const base = fx.base.toUpperCase();
  const rateOf = (code: Currency): number | null => {
    if (code === base) return 1;
    return fx.rates[code] ?? null;
  };

  const from = rateOf(m.currency);
  const dest = rateOf(target);
  if (from == null || dest == null || from === 0) return null;

  // amount / from  -> value in base;  * dest -> value in target
  return { amount: (m.amount / from) * dest, currency: target, period: m.period };
}

export function formatMoney(m: Money, locale = "en-US"): string {
  const perYear =
    m.period === "year"
      ? ""
      : m.period === "project"
        ? m.durationMonths
          ? ` total (${m.durationMonths} meses)`
          : " total"
        : `/${m.period}`;
  try {
    const formatted = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: m.currency,
      maximumFractionDigits: 0,
    }).format(m.amount);
    return `${formatted}${perYear}`;
  } catch {
    // Unknown currency code — Intl throws rather than degrading.
    return `${Math.round(m.amount).toLocaleString(locale)} ${m.currency}${perYear}`;
  }
}
