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
    email: z.string(),
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
    currency: z.string().default("USD"),
    period: z.string().default("year"),
    floor: z.number(),
    target: z.number(),
    hourly_floor: z.number().optional(),
    hourly_target: z.number().optional(),
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
