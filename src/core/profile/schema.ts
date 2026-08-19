/**
 * Validation for profile/profile.yaml.
 *
 * The profile is hand-edited (by the user and by agents), so it gets parsed
 * strictly. A typo in a weight should fail loudly at load time, not silently
 * produce a scorer that ranks everything at zero.
 */
import { z } from "zod";

const WeightedTerm = z.object({
  term: z.string().min(1).transform((s) => s.toLowerCase()),
  weight: z.number(),
});

const Cluster = z.object({
  weight: z.number().min(0).max(1),
  titles: z.array(z.string().min(1)).min(1),
  cv_variant: z.string().min(1),
});

export const ProfileSchema = z.object({
  identity: z.object({
    name: z.string(),
    headline: z.string(),
    location: z.string(),
    timezone: z.string(),
    /**
     * Vem de ${JHO_CANDIDATE_EMAIL}. Vazio quando não configurado — nada no
     * ranking depende dele, e derrubar a carga do perfil por causa de um campo
     * de contato pararia CLI, sourcing e scoring de uma vez.
     */
    email: z
      .string()
      .nullish()
      .transform((v) => v ?? ""),
    linkedin: z.string().optional(),
    github: z.string().optional(),
    languages: z.array(z.object({ lang: z.string(), level: z.string() })).default([]),
  }),
  targets: z.object({
    clusters: z.record(z.string(), Cluster),
    avoid_titles: z.array(z.string()).default([]),
  }),
  constraints: z.object({
    work_authorization: z.array(z.string()).default([]),
    needs_visa_sponsorship_for: z.array(z.string()).default([]),
    contract_models: z.array(z.string()).default([]),
    remote_only: z.boolean().default(true),
    acceptable_regions: z.array(z.string()).default([]),
    max_timezone_offset_hours: z.number().default(6),
  }),
  keywords: z.object({
    critical: z.array(WeightedTerm).default([]),
    strong: z.array(WeightedTerm).default([]),
    stack: z.array(WeightedTerm).default([]),
    negative: z.array(WeightedTerm).default([]),
  }),
  blockers: z
    .array(z.object({ pattern: z.string(), reason: z.string() }))
    .default([]),
  compensation: z.object({
    reference_currency: z.string().length(3).default("USD"),
    /**
     * Independent ranges per (currency, period). Not conversions of each other:
     * a contract in BRL carries different currency risk and taxation, so the
     * premium required in each currency is a business decision.
     */
    ranges: z
      .array(
        z.object({
          currency: z.string().length(3),
          period: z.enum(["year", "month", "week", "day", "hour"]),
          floor: z.number().nonnegative(),
          target: z.number().nonnegative(),
          ideal: z.number().nonnegative().optional(),
        }),
      )
      .min(1),
    project: z
      .object({
        accepted: z.boolean().default(false),
        currency: z.string().length(3).default("USD"),
        min_total: z.number().nonnegative().default(0),
        max_duration_months: z.number().positive().default(12),
      })
      .default({ accepted: false, currency: "USD", min_total: 0, max_duration_months: 12 }),
    benefits: z
      .object({
        required: z.array(z.string()).default([]),
        preferred: z.array(z.string()).default([]),
        nice_to_have: z.array(z.string()).default([]),
        irrelevant: z.array(z.string()).default([]),
      })
      .default({ required: [], preferred: [], nice_to_have: [], irrelevant: [] }),
  }),
  seniority: z.object({
    years_experience: z.number(),
    min_years_expected: z.number(),
    reject_below_years: z.number(),
  }),
  evidence: z.record(z.string(), z.array(z.string())).default({}),
  growth: z.array(z.string()).default([]),
  cv: z
    .object({
      base: z.string().optional(),
      variants: z.record(z.string(), z.string()).default({}),
    })
    .default({ variants: {} }),
});

export type Profile = z.infer<typeof ProfileSchema>;
export type ProfileCluster = z.infer<typeof Cluster>;
