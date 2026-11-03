import type { jobsPtBR } from "./jobs.pt-BR.ts";
import type { Translated } from "./shape.ts";

/**
 * Job list: the screen, application status and grid paging.
 *
 * Part of the `en.ts` dictionary; typed against `jobs.pt-BR.ts`, so a missing key is a
 * compile error.
 */
export const jobsEn: Translated<typeof jobsPtBR> = {
  jobs: {
    originWeb: "web",
    originRecruiter: "recruiter",
    originManual: "added",
    newJob: "Post a job",
    newJobLead: "The job you are offering. It enters the corpus labelled as recruiter, so whoever reads it knows there is someone on the other side.",
    jobTitle: "Role",
    company: "Company",
    location: "Location",
    publicUrl: "Public URL (optional)",
    description: "Description",
    publish: "Post",
    noneWithFilters: "No jobs match these filters. Loosen the cut or turn a criterion off.",
    loading: "Loading jobs…",
    title: "Jobs",
    matching: "match the filters",
    view: "posting",
    site: "site",
    apply: "apply",
    noDescription: "no description — the score is understated, not low",
    anonymousEmployer: "employer hidden",
    matchingFor: "for “{term}”",
    matchedIn: "matched in: {fields}",
    matchTitle: "title",
    matchCompany: "company",
    matchLocation: "location",
    matchDescription: "description",
    matchProximity: "similar title",
    matchSynonym: "also searched:",
    nearTitle: "Similar terms",
    nearHint: "Jobs that do not mention your search but have a similar title. They are not in the count above.",
    newBadge: "new",
    payUndisclosed: "pay not disclosed",
    payNotComparable: "pay not comparable",
    payConverted: "≈ {amount}",
    hiddenByPayRange: "{count} jobs paying outside the range were left out.",
    trackLabel: "track {name}",
    countriesLabel: "posted in {count} countries",
    countryWithCount: "{name} · {count} postings",
    moreCountries: "+{count}",
    countryUnknown: "no location",
    offerSearch: "Search the platforms for “{term}”",
    offerSearchLead: "Saving the term searches the registered platforms for new jobs with it, every day.",
    // Two sentences, not one: with a filter beyond the term, "absent from
    // the corpus" would be false (#402, BUG-20260929-search-term-false-negative-laravel
    // — "laravel" exists, the work-mode filter is what zeroes it). Without a
    // filter, "remove filters" alone does not help someone who chose none.
    emptyTermFiltered: "No jobs match “{term}” with the current filters. Remove filters or try another term.",
    emptyTermAbsent: "No job in the corpus has “{term}”. Searching the platforms brings new jobs with that term.",
    broughtByEmpty: "The term “{term}” has not brought any jobs yet. Last search: {state}.",
    notInterested: "not interested",
    notInterestedHint: "Takes the job off your lists. It stays under “Archived”, and you can restore it while you have not applied.",
    restore: "restore",
    restoreHint: "Puts the job back on your lists, at the start of the pipeline.",
    /** Pay period shown per job (see `src/core/money.ts`). */
    moneyPeriodMonth: "month",
    moneyPeriodWeek: "week",
    moneyPeriodDay: "day",
    moneyPeriodHour: "hour",
    moneyProjectTotal: "total",
    moneyProjectTotalWithDuration: "total ({count} months)",
  },
  applicationStatus: {
    backlog: "Backlog",
    shortlisted: "Shortlisted",
    preparing: "Preparing",
    applied: "Applied",
    screening: "Screening",
    interviewing: "Interviewing",
    offer: "Offer",
    rejected: "Rejected",
    withdrawn: "Withdrawn",
    archived: "Archived",
    untracked: "Out of the funnel",
  },
  grid: {
    perPage: "per page",
    density: "density",
    comfortable: "comfortable",
    compact: "compact",
    exportCsv: "export CSV",
    exportHint: "Exports the {count} filtered rows",
    page: "page",
    of: "of",
    previous: "previous",
    next: "next",
  },
};
