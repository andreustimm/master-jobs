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
import { FETCHABLE_SOURCE_KINDS } from "./types.ts";
import type {
  FetchableSourceKind,
  SourceAdapter,
  SourceKind,
} from "./types.ts";

export const ADAPTERS = {
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
} satisfies Record<FetchableSourceKind, SourceAdapter>;

const FETCHABLE_SOURCE_KIND_SET: ReadonlySet<string> = new Set(FETCHABLE_SOURCE_KINDS);

export function isFetchableSourceKind(kind: string): kind is FetchableSourceKind {
  return FETCHABLE_SOURCE_KIND_SET.has(kind);
}

/** Validate text received at CLI and other untyped boundaries. */
export function parseFetchableSourceKind(kind: string): FetchableSourceKind {
  if (!isFetchableSourceKind(kind)) {
    throw new Error(`No adapter registered for source kind "${kind}"`);
  }
  return kind;
}

export function getAdapter(kind: FetchableSourceKind): SourceAdapter {
  // Keep the runtime check even though TypeScript proves this for typed callers:
  // the CLI and plain JavaScript can still pass unchecked strings.
  return ADAPTERS[parseFetchableSourceKind(kind)];
}

export function sourceId(kind: SourceKind, handle: string): string {
  return `${kind}:${handle}`;
}
