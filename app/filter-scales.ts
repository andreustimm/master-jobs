/**
 * The filter sliders' numeric scales — the part the browser is allowed to know.
 *
 * These live apart from `filter-state.ts` because the sliders are client
 * islands, and `filter-state.ts` reaches the matching context, which reaches
 * Drizzle, `node:crypto` and `node:dns`. Importing one constant from there
 * dragged the whole server graph into the client bundle and the production
 * build refused it outright. A module with no imports cannot do that again.
 */

/**
 * Largest pay amount the filter accepts, in the currency being read.
 *
 * Two million, not the track editor's ten: a filter bound above that is not a
 * salary any more, and an accidental extra zero should be refused rather than
 * silently emptying the board. The drag scale below stays far lower — it is a
 * reading aid, and it stretches to hold whatever is typed.
 */
export const PAY_FILTER_MAX = 2_000_000;

/**
 * Top of the pay slider's scale, per period — a reading scale, not a limit.
 *
 * The number fields accept up to `PAY_FILTER_MAX`; this is only how far one
 * drag reaches, so the low end keeps usable resolution. The yearly ceiling is
 * the monthly one times twelve, which keeps a thumb in the same real place when
 * the period changes.
 */
export const PAY_SLIDER_CEILING = { month: 60_000, year: 720_000 } as const;

/** Drag granularity, matched to the ceiling so a drag lands on round numbers. */
export const PAY_SLIDER_STEP = { month: 500, year: 6_000 } as const;

/**
 * The fit score's ceiling — the scorer's own, not a display choice.
 *
 * Here the scale IS the limit: a score above 100 does not exist, so the slider
 * never stretches and a typed 250 is clamped rather than honoured.
 */
export const FIT_MAX = 100;

/** One point at a time: the whole range is a hundred steps wide. */
export const FIT_SLIDER_STEP = 1;
