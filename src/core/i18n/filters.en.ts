import type { filtersPtBR } from "./filters.pt-BR.ts";
import type { Translated } from "./shape.ts";

/**
 * Job list filters: labels, hints, presets, notices and countries.
 *
 * Part of the `en.ts` dictionary; typed against `filters.pt-BR.ts`, so a missing key is a
 * compile error.
 */
export const filtersEn: Translated<typeof filtersPtBR> = {
  filterNotices: {
    term_too_short: "The term needs at least 2 characters; the search was ignored.",
    term_too_long: "The term is longer than 60 characters; the search was ignored.",
    term_invalid_char: "The term has a character that is not accepted — use letters, digits, space and + # . - /; the search was ignored.",
    term_no_alnum: "The term needs at least one letter or digit; the search was ignored.",
    pay_invalid: "A pay bound must be a whole number from 1 to 2,000,000; the filter was ignored.",
    fit_invalid: "The score must be a number from 0 to 100; the unreadable value was ignored.",
    range_swapped: "The minimum was above the maximum; the two were swapped.",
    track_unknown: "That track does not exist or is archived; showing the primary.",
    term_unknown: "That saved term does not exist; the filter was ignored.",
    cluster_unknown: "That cluster does not belong to the chosen track; the filter was ignored.",
    scores_pending: "Your jobs have no score yet: it is calculated after you save your CV. Until then jobs show without a score, and the Score filter does not hide them.",
  },
  /** Hub for a job posted once per country. */
  jobCountries: {
    back: "← jobs",
    lead: "This job was posted in {countries} countries, across {postings} listings. Choose where to apply.",
    leadOneCountry: "This job was posted in 1 country, across {postings} listings. Choose where to apply.",
    leadNoCountry: "This job has {postings} listings, none with a country resolved. Choose where to apply.",
    withoutCountry: "{count} with no country resolved — the location shows as it came.",
    empty: "No posting in this group is still open.",
  },
  filters: {
    search: "search a term…",
    searchHint: "Whole word in the title, company, location and description: “java” does not bring “JavaScript”. In quotes, the exact phrase.",
    track: "track",
    trackPrimary: "primary",
    trackAll: "all tracks",
    broughtBy: "brought by term",
    broughtByAny: "any",
    pay: "pay range",
    payAmount: "minimum",
    payMax: "maximum",
    payCurrency: "currency",
    payPeriod: "period",
    payNoFloor: "no floor",
    payNoCap: "no cap",
    payMinThumb: "pay range floor",
    payMaxThumb: "pay range ceiling",
    perMonth: "per month",
    perYear: "per year",
    apply: "Apply",
    disclosedOnly: "only with disclosed pay",
    submit: "Search",
    clear: "clear",
    score: "score",
    scoreMin: "minimum",
    scoreMax: "maximum",
    scoreNoFloor: "0",
    scoreNoCap: "100",
    scoreMinThumb: "minimum score",
    scoreMaxThumb: "maximum score",
    all: "all",
    quality: "quality",
    pipeline: "pipeline",
    grouped: "group repeats",
    notApplied: "not sent yet",
    workMode: "work mode",
    remote: "Remote",
    hybrid: "Hybrid",
    onsite: "On-site",
    unblocked: "no blockers",
    named: "named employer",
    fresh: "recent",
    described: "with description",
    paid: "with salary",
    cluster: "cluster",
    company: "employer",
    companyPlaceholder: "employer name…",
    source: "source",
    sourceAll: "all sources",
    sourceCount: "{count} of {total}",
    sort: "sort",
    byFit: "fit",
    byRelevance: "relevance",
    byRecent: "most recent",
    byComp: "highest salary",
  },
  presets: {
    applicableToday: "Worth applying today",
    applicableTodayHint: "above 60, no blockers, named employer",
    recent: "Just posted",
    recentHint: "last 3 days, no blockers",
    withSalary: "With salary",
    withSalaryHint: "compensation disclosed, highest first",
    untriaged: "Untriaged",
    untriagedHint: "not in the pipeline yet",
    archived: "Archived",
    archivedHint: "jobs you took off your lists",
  },
  hints: {
    unblocked: "Hides jobs requiring work authorisation, on-site presence or W2",
    named: "Hides aggregators that hide the employer — you cannot research them or use your network",
    fresh: "Posted in the last 3 days — far higher reply rate",
    described:
      "A job with no description zeroes a 30-point component — the score is unmeasured, not low",
    paid: "Only jobs that disclose compensation",
    track:
      "Which career target scores this list. Switching the track reorders everything, because the same job is worth different scores against different targets.",
    broughtBy:
      "Which of your saved searches brought the job in. It does not change the score — it shows where the job came from.",
    cluster:
      "The kind of role the score recognised in the title: leadership, architecture, senior IC.",
    grouped:
      "The same job posted across several countries becomes one row, with each country\u2019s flag. Turn it off to see every posting separately.",
    notApplied:
      "Hides jobs you already sent — it reads the sent date, so a rejection or a withdrawal stays hidden",
  },
};
