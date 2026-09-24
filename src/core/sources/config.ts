import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { FETCHABLE_SOURCE_KINDS } from "./types.ts";
import type { CatalogEntry } from "./types.ts";

const SourcesFile = z.object({
  sources: z
    .array(
      z.object({
        kind: z.enum(FETCHABLE_SOURCE_KINDS),
        // `<kind>:~terms` is the non-synced source of term captures (ADR-011).
        // A YAML entry with that handle would make the sync own it — and close
        // every job a term brought that the regular feed does not list.
        handle: z
          .string()
          .default("")
          .refine((handle) => !handle.startsWith("~"), {
            message: "handles starting with ~ are reserved for term captures",
          }),
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

/**
 * Devolve TODA entrada, inclusive a desabilitada, com `enabled`. Quem só quer
 * as habilitadas filtra explicitamente: descartar aqui impedia o banco de
 * aprender que uma fonte foi desligada no arquivo.
 */
export function parseSourcesConfig(text: string): CatalogEntry[] {
  const parsed = SourcesFile.safeParse(parse(text));
  if (!parsed.success) {
    throw new Error(
      `sources.yaml is invalid:\n${parsed.error.issues
        .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
        .join("\n")}`,
    );
  }
  return parsed.data.sources.map(({ kind, handle, label, rationale, enabled }) => ({
    kind,
    handle,
    label,
    rationale,
    enabled,
  }));
}

export async function loadSources(): Promise<CatalogEntry[]> {
  return parseSourcesConfig(await readFile(sourcesPath(), "utf8"));
}
