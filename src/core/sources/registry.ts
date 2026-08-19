/**
 * Adapter registry. Adding a board means adding one entry here and one file.
 */
import {
  ashby,
  greenhouse,
  lever,
  recruitee,
  smartrecruiters,
} from "./ats.ts";
import { braintrust } from "./braintrust.ts";
import { careers } from "./careers.ts";
import {
  adzuna,
  arbeitnow,
  himalayas,
  remoteok,
  remotive,
} from "./aggregators.ts";
import type { SourceAdapter, SourceKind } from "./types.ts";

export const ADAPTERS: Partial<Record<SourceKind, SourceAdapter>> = {
  greenhouse,
  lever,
  ashby,
  smartrecruiters,
  recruitee,
  himalayas,
  remotive,
  arbeitnow,
  remoteok,
  adzuna,
  braintrust,
  careers,
};

export function getAdapter(kind: SourceKind): SourceAdapter {
  const adapter = ADAPTERS[kind];
  if (!adapter) throw new Error(`No adapter registered for source kind "${kind}"`);
  return adapter;
}

export function sourceId(kind: SourceKind, handle: string): string {
  return `${kind}:${handle}`;
}
