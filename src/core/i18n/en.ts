import type { Dictionary } from "./pt-BR.ts";

/**
 * English.
 *
 * Typed as `Dictionary`, so a missing key is a compile error rather than a
 * blank space someone finds in production.
 *
 * Translated, not transliterated: "Frescor" becomes "Freshness" because that
 * is what the scoring component measures, and "Funil" becomes "Pipeline"
 * because that is what the funnel is called in English-language recruiting —
 * "Funnel" would read as marketing.
 */
export const en: Dictionary = {
  nav: {
    cockpit: "Cockpit",
    jobs: "Jobs",
    pipeline: "Pipeline",
    referrals: "Referrals",
    candidate: "Candidate",
    appearance: "appearance",
    language: "language",
    signIn: "sign in",
    signOut: "sign out",
    unprotected: "unprotected",
  },
  theme: {
    title: "theme",
    environment: "environment",
    system: "System",
    light: "Light",
    dark: "Dark",
  },
  login: {
    title: "Sign in",
    email: "Email",
    password: "Password",
    submit: "Sign in",
    invalid: "Incorrect email or password.",
    missing: "Enter your email and password.",
    rateLimited: "Too many attempts. Wait a few minutes.",
    firstAccess: "First run",
    noAccounts: "No account yet. Create one in the terminal:",
    afterCreate:
      "Then reload this page. The password is read from the terminal, never from an argument — arguments show up in shell history and in ps.",
    magicLinkHint: "No password set? A single-use link works too:",
    setPasswordHint: "Set a password:",
  },
  jobs: {
    title: "Jobs",
    matching: "match the filters",
    view: "posting",
    site: "site",
    apply: "apply",
    noDescription: "no description — the score is understated, not low",
    anonymousEmployer: "employer hidden",
  },
  filters: {
    search: "search by role or company…",
    submit: "Search",
    clear: "clear",
    cut: "cut",
    all: "all",
    quality: "quality",
    unblocked: "no blockers",
    named: "named employer",
    fresh: "recent",
    described: "with description",
    paid: "with salary",
    cluster: "cluster",
    source: "source",
    sort: "sort",
    byFit: "fit",
    byRecent: "most recent",
    byComp: "highest salary",
  },
  score: {
    title: "Title",
    keyword: "Keywords",
    eligibility: "Eligibility",
    seniority: "Seniority",
    compensation: "Compensation",
    freshness: "Freshness",
    benefits: "Benefits",
  },
  common: {
    loading: "Loading…",
    empty: "Nothing here yet.",
    back: "back",
    close: "Close",
  },
};
