import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import type { SourceConfig, SourceKind } from "./types.ts";

const KINDS = [
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "recruitee",
  "workable",
  "himalayas",
  "remotive",
  "arbeitnow",
  "remoteok",
  "adzuna",
  "manual",
] as const satisfies readonly SourceKind[];

const SourcesFile = z.object({
  sources: z
    .array(
      z.object({
        kind: z.enum(KINDS),
        handle: z.string().default(""),
        label: z.string().min(1),
        rationale: z.string().optional(),
        enabled: z.boolean().default(true),
      }),
    )
    .min(1),
});

export function sourcesPath(): string {
  return process.env.JHO_SOURCES_PATH ?? resolve(process.cwd(), "config/sources.yaml");
}

export async function loadSources(): Promise<SourceConfig[]> {
  const text = await readFile(sourcesPath(), "utf8");
  const parsed = SourcesFile.safeParse(parse(text));
  if (!parsed.success) {
    throw new Error(
      `sources.yaml is invalid:\n${parsed.error.issues
        .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
        .join("\n")}`,
    );
  }
  return parsed.data.sources
    .filter((s) => s.enabled)
    .map(({ kind, handle, label, rationale }) => ({ kind, handle, label, rationale }));
}
