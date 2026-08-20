/**
 * Recognising an ATS from a job URL.
 *
 * Why this exists: the fastest way to add a job is to paste the link you are
 * already looking at. If we can tell which ATS it belongs to, we can pull the
 * full posting through the adapter we already have — description, salary,
 * location — instead of asking the user to retype it.
 *
 * Patterns verified against real URLs collected during sourcing.
 */
import type { FetchableSourceKind } from "../sources/types.ts";

export type DetectedJobUrl = {
  kind: FetchableSourceKind;
  /** Board handle, e.g. "stackblitz" or "textlayer". */
  handle: string;
  /** Posting id within that board, when the URL carries one. */
  externalId?: string;
  /** Company label to display until the API tells us better. */
  label: string;
};

type Pattern = {
  kind: FetchableSourceKind;
  /** Must capture handle first, external id second when present. */
  regex: RegExp;
  handleGroup: number;
  idGroup?: number;
};

const PATTERNS: Pattern[] = [
  // https://boards.greenhouse.io/stackblitz/jobs/4111216009
  // https://job-boards.greenhouse.io/stackblitz/jobs/4111216009
  {
    kind: "greenhouse",
    regex: /(?:job-boards|boards)\.greenhouse\.io\/([a-z0-9_-]+)\/jobs\/(\d+)/i,
    handleGroup: 1,
    idGroup: 2,
  },
  // https://boards.greenhouse.io/embed/job_app?for=stackblitz&token=123
  {
    kind: "greenhouse",
    regex: /greenhouse\.io\/embed\/job_app\?[^#]*for=([a-z0-9_-]+)/i,
    handleGroup: 1,
  },
  // https://jobs.lever.co/jobgether/92481833-175e-4d8f-894f-ccde4ccfc3ce
  {
    kind: "lever",
    regex: /jobs\.lever\.co\/([a-z0-9_-]+)(?:\/([a-f0-9-]{16,}))?/i,
    handleGroup: 1,
    idGroup: 2,
  },
  // https://jobs.ashbyhq.com/textlayer/8dbad922-0f0d-48b9-bd4c-fb860d8455c6
  {
    kind: "ashby",
    regex: /jobs\.ashbyhq\.com\/([a-z0-9_.-]+)(?:\/([a-f0-9-]{16,}))?/i,
    handleGroup: 1,
    idGroup: 2,
  },
  // https://jobs.smartrecruiters.com/Company/743999
  {
    kind: "smartrecruiters",
    regex: /jobs\.smartrecruiters\.com\/([A-Za-z0-9_-]+)(?:\/(\d+))?/,
    handleGroup: 1,
    idGroup: 2,
  },
  // https://company.recruitee.com/o/senior-engineer
  {
    kind: "recruitee",
    regex: /([a-z0-9_-]+)\.recruitee\.com\/o\/([a-z0-9_-]+)/i,
    handleGroup: 1,
    idGroup: 2,
  },
];

/**
 * Identify the ATS behind a job URL.
 * Returns null for anything we cannot resolve — a LinkedIn posting, a company
 * careers page, a shortened link. Those still get added, just manually.
 */
export function detectJobUrl(url: string): DetectedJobUrl | null {
  for (const p of PATTERNS) {
    const match = p.regex.exec(url);
    if (!match) continue;
    const handle = match[p.handleGroup];
    if (!handle) continue;
    const externalId = p.idGroup ? match[p.idGroup] : undefined;
    return {
      kind: p.kind,
      handle,
      externalId,
      // Board handles are usually the company name, close enough to display.
      label: handle.replace(/[-_.]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    };
  }
  return null;
}

/** Hosts we recognise but cannot fetch from — useful for a better message. */
const KNOWN_UNFETCHABLE: Array<{ test: RegExp; name: string }> = [
  { test: /linkedin\.com\/jobs/i, name: "LinkedIn" },
  { test: /indeed\.com/i, name: "Indeed" },
  { test: /glassdoor\./i, name: "Glassdoor" },
  { test: /wellfound\.com|angel\.co/i, name: "Wellfound" },
  { test: /myworkdayjobs\.com/i, name: "Workday" },
  { test: /jobs\.gem\.com/i, name: "Gem" },
  { test: /app\.loxo\.co/i, name: "Loxo" },
];

export function describeUnfetchable(url: string): string | null {
  const hit = KNOWN_UNFETCHABLE.find((k) => k.test.test(url));
  return hit ? hit.name : null;
}
