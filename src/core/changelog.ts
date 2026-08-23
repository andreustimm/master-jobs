/** Pure contracts for the localized, user-facing release history. */

export type ChangelogLocale = "pt-BR" | "en";

const CHANGELOG_FILES: Record<ChangelogLocale, string> = {
  "pt-BR": "USER_CHANGELOG.pt-BR.md",
  en: "USER_CHANGELOG.en.md",
};

/** Keep runtime file selection total and independent from untrusted path input. */
export function changelogFile(locale: unknown): string | null {
  return locale === "pt-BR" || locale === "en" ? CHANGELOG_FILES[locale] : null;
}

export type Publication =
  | { kind: "instant"; value: string }
  | { kind: "date"; value: string };

export type UserRelease = {
  version: string;
  publication: Publication;
  markdown: string;
};

export type OmittedUserRelease = {
  version: string;
  publication?: Publication;
};

export type ChangelogIssueCode =
  | "invalid_version"
  | "invalid_publication"
  | "duplicate_version"
  | "empty_body"
  | "invalid_omission";

export type ChangelogIssue = {
  code: ChangelogIssueCode;
  line?: number;
  version?: string;
};

export type ChangelogParseResult = {
  releases: UserRelease[];
  omitted: OmittedUserRelease[];
  issues: ChangelogIssue[];
};

export type ChangelogDomainErrorCode =
  | "localized_version_mismatch"
  | "localized_publication_mismatch"
  | "localized_content_missing"
  | "localized_visibility_mismatch";

export class ChangelogDomainError extends Error {
  readonly code: ChangelogDomainErrorCode;
  readonly locale?: ChangelogLocale;
  readonly version?: string;

  constructor(
    code: ChangelogDomainErrorCode,
    details: { locale?: ChangelogLocale; version?: string } = {},
  ) {
    const fields: string[] = [code];
    if (details.locale) fields.push(`locale=${details.locale}`);
    if (details.version) fields.push(`version=${details.version}`);
    super(fields.join(" "));
    this.name = "ChangelogDomainError";
    this.code = code;
    this.locale = details.locale;
    this.version = details.version;
  }
}

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const VERSION_CANDIDATE =
  /^[vV]?\d+(?:\.(?:\d*|[xX*]))*(?:-[0-9A-Za-z.*-]*)?(?:\+[0-9A-Za-z.*-]*)?$/;
const UNSAFE_METADATA = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/;
const NO_USER_CHANGE_LINE = /^ {0,3}<!--\s*sem-nota-usuario\b[^>]*-->[ \t]*$/i;
const OMITTED_MARKER_LINE =
  /^ {0,3}<!--\s*sem-nota-usuario\s*:\s*((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:\s*-\s*(\S+?))?(?:\s+[^>]*?)?\s*-->[ \t]*$/;

export type ChangelogSection = {
  bodyEnd: number;
  bodyStart: number;
  index: number;
  line: number;
  publication?: string;
  publicationSyntaxValid: boolean;
  token: string;
  versionSyntaxValid: boolean;
};

type Fence = {
  marker: "`" | "~";
  length: number;
};

type MarkdownLine = {
  code: boolean;
  end: number;
  line: number;
  start: number;
  text: string;
};

function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

function isValidUtcInstant(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second] = match;
  if (!isValidCalendarDate(`${year}-${month}-${day}`)) return false;
  return Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59;
}

export function parsePublication(value: string): Publication | null {
  if (isValidCalendarDate(value)) return { kind: "date", value };
  if (isValidUtcInstant(value)) return { kind: "instant", value };
  return null;
}

function openingFence(line: string): Fence | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return null;
  const run = match[1]!;
  if (run[0] === "`" && match[2]!.includes("`")) return null;
  return { marker: run[0] as "`" | "~", length: run.length };
}

function closesFence(line: string, fence: Fence): boolean {
  const candidate = line.replace(/^ {0,3}/, "");
  let length = 0;
  while (candidate[length] === fence.marker) length += 1;
  return length >= fence.length && candidate.slice(length).trim() === "";
}

function releaseHeaderAt(
  line: string,
): Omit<ChangelogSection, "bodyEnd" | "bodyStart" | "index" | "line"> | null {
  const canonical = /^ {0,3}##[ \t]*\[(.*)\][ \t]+-[ \t]+(\S.*)$/.exec(line);
  if (canonical) {
    const token = canonical[1]!.trim();
    const publication = canonical[2]!.trim();
    if (token === "Unreleased") {
      return {
        token,
        publication,
        publicationSyntaxValid: false,
        versionSyntaxValid: true,
      };
    }
    if (!VERSION_CANDIDATE.test(token) && !UNSAFE_METADATA.test(token)) return null;
    return {
      token,
      publication,
      publicationSyntaxValid: true,
      versionSyntaxValid: true,
    };
  }

  const bracketed = /^ {0,3}##[ \t]*\[([^\]\r\n]+)\]([^\r\n]*)$/.exec(line);
  if (bracketed) {
    const token = bracketed[1]!.trim();
    const suffix = bracketed[2]!.trim();
    if (token === "Unreleased" && suffix === "") {
      return { token, publicationSyntaxValid: true, versionSyntaxValid: true };
    }
    if (suffix.startsWith("(")) return null;
    if (!VERSION.test(token) && !VERSION_CANDIDATE.test(token)) return null;
    return {
      token,
      ...(suffix !== "" ? { publication: suffix } : {}),
      publicationSyntaxValid: false,
      versionSyntaxValid: true,
    };
  }

  const missingClose = /^ {0,3}##[ \t]*\[([^\]\s]+)[ \t]+-[ \t]+(\S.*)$/.exec(line);
  if (missingClose && VERSION_CANDIDATE.test(missingClose[1]!.trim())) {
    return {
      token: missingClose[1]!.trim(),
      publication: missingClose[2]!.trim(),
      publicationSyntaxValid: true,
      versionSyntaxValid: false,
    };
  }

  const unbracketed = /^ {0,3}##[ \t]+(\S+)[ \t]+-[ \t]+(\S.*)$/.exec(line);
  if (!unbracketed || !VERSION_CANDIDATE.test(unbracketed[1]!.trim())) return null;
  return {
    token: unbracketed[1]!.trim(),
    publication: unbracketed[2]!.trim(),
    publicationSyntaxValid: true,
    versionSyntaxValid: false,
  };
}

function linesIn(markdown: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let fence: Fence | null = null;
  let offset = 0;
  let lineNumber = 1;

  while (offset < markdown.length) {
    const newline = markdown.indexOf("\n", offset);
    const lineEnd = newline === -1 ? markdown.length : newline;
    const rawLine = markdown.slice(offset, lineEnd);
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const opened: Fence | null = fence ? null : openingFence(line);
    lines.push({
      code: Boolean(fence || opened || /^(?: {4}|\t)/.test(line)),
      start: offset,
      end: lineEnd,
      line: lineNumber,
      text: line,
    });
    if (fence && closesFence(line, fence)) fence = null;
    else if (!fence && opened) fence = opened;

    if (newline === -1) break;
    offset = newline + 1;
    lineNumber += 1;
  }
  return lines;
}

export function changelogSections(markdown: string): ChangelogSection[] {
  const headers: ChangelogSection[] = [];
  for (const line of linesIn(markdown)) {
    if (line.code) continue;
    const parsed = releaseHeaderAt(line.text);
    if (!parsed) continue;
    headers.push({
      ...parsed,
      index: line.start,
      bodyStart: line.end,
      bodyEnd: markdown.length,
      line: line.line,
    });
  }

  for (let index = 0; index < headers.length - 1; index += 1) {
    headers[index]!.bodyEnd = headers[index + 1]!.index;
  }
  return headers;
}

export function hasNoUserChangeMarker(markdown: string): boolean {
  return linesIn(markdown).some(
    (line) => !line.code && NO_USER_CHANGE_LINE.test(line.text),
  );
}

export function bodyHasUserContent(body: string): boolean {
  let cursor = 0;
  let codeProtected = "";
  for (const line of linesIn(body)) {
    codeProtected += body.slice(cursor, line.start);
    const content = body.slice(line.start, line.end);
    codeProtected += line.code ? content.replace(/\S/g, "x") : content;
    cursor = line.end;
  }
  codeProtected += body.slice(cursor);
  return codeProtected.replace(/<!--[\s\S]*?-->/g, "").trim() !== "";
}

function trimBodyBoundaries(body: string): string {
  return body
    .replace(/^(?:[ \t]*\r?\n)+/, "")
    .replace(/(?:\r?\n[ \t]*)+$/, "");
}

function diagnosticVersion(value: string): string {
  const safe = value
    .replace(/[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g, "?")
    .replace(/[^A-Za-z0-9._+-]/g, "?")
    .slice(0, 64);
  return safe || "invalid";
}

export function compareSemanticVersions(left: string, right: string): number {
  const a = left.split(".");
  const b = right.split(".");
  for (let index = 0; index < 3; index += 1) {
    const leftPart = a[index] ?? "0";
    const rightPart = b[index] ?? "0";
    if (leftPart.length !== rightPart.length) return rightPart.length - leftPart.length;
    if (leftPart !== rightPart) return leftPart < rightPart ? 1 : -1;
  }
  return 0;
}

/** Parse valid entries independently so one malformed release cannot hide its siblings. */
export function parseUserChangelog(markdown: string): ChangelogParseResult {
  const releases: UserRelease[] = [];
  const omitted: OmittedUserRelease[] = [];
  const issues: ChangelogIssue[] = [];
  const seen = new Set<string>();
  const headers = changelogSections(markdown);

  for (const header of headers) {
    if (header.token === "Unreleased") continue;
    if (!header.versionSyntaxValid || !VERSION.test(header.token)) {
      issues.push({
        code: "invalid_version",
        line: header.line,
        version: diagnosticVersion(header.token),
      });
      continue;
    }
    if (seen.has(header.token)) {
      issues.push({ code: "duplicate_version", line: header.line, version: header.token });
      continue;
    }
    const publication =
      header.publicationSyntaxValid && header.publication
        ? parsePublication(header.publication)
        : null;
    if (!publication) {
      issues.push({ code: "invalid_publication", line: header.line, version: header.token });
      continue;
    }

    const rawBody = markdown.slice(header.bodyStart, header.bodyEnd);
    const body = trimBodyBoundaries(rawBody);
    if (hasNoUserChangeMarker(rawBody)) {
      if (bodyHasUserContent(rawBody)) {
        issues.push({ code: "invalid_omission", line: header.line, version: header.token });
        continue;
      }
      seen.add(header.token);
      omitted.push({ version: header.token, publication });
      continue;
    }
    if (!bodyHasUserContent(rawBody)) {
      issues.push({ code: "empty_body", line: header.line, version: header.token });
      continue;
    }
    seen.add(header.token);
    releases.push({ version: header.token, publication, markdown: body });
  }

  const firstHeader = headers[0]?.index ?? markdown.length;
  const prefix = markdown.slice(0, firstHeader);
  for (const line of linesIn(prefix)) {
    if (line.code) continue;
    const match = OMITTED_MARKER_LINE.exec(line.text);
    if (!match) continue;
    const version = match[1]!;
    if (seen.has(version)) {
      issues.push({
        code: "duplicate_version",
        line: line.line,
        version,
      });
      continue;
    }
    seen.add(version);
    const rawPublication = match[2];
    const publication = rawPublication ? parsePublication(rawPublication) : undefined;
    if (rawPublication && !publication) {
      issues.push({
        code: "invalid_publication",
        line: line.line,
        version,
      });
      continue;
    }
    omitted.push({ version, ...(publication ? { publication } : {}) });
  }

  releases.sort((a, b) => compareSemanticVersions(a.version, b.version));
  omitted.sort((a, b) => compareSemanticVersions(a.version, b.version));
  return { releases, omitted, issues };
}

function entryLocale(
  ptBR: ChangelogParseResult,
  en: ChangelogParseResult,
  version: string,
): ChangelogLocale | undefined {
  const ptHas =
    ptBR.releases.some((release) => release.version === version) ||
    ptBR.omitted.some((release) => release.version === version) ||
    ptBR.issues.some((issue) => issue.version === version);
  const enHas =
    en.releases.some((release) => release.version === version) ||
    en.omitted.some((release) => release.version === version) ||
    en.issues.some((issue) => issue.version === version);
  if (!ptHas) return "pt-BR";
  if (!enHas) return "en";
  return undefined;
}

function publicationsMatch(left?: Publication, right?: Publication): boolean {
  if (!left || !right) return left === right;
  return left.kind === right.kind && left.value === right.value;
}

/** Strict structural parity gate; semantic translation equivalence remains editorial review. */
export function validateLocalizedChangelogs(
  ptBR: ChangelogParseResult,
  en: ChangelogParseResult,
): void {
  const versions = new Set([
    ...ptBR.releases.map((release) => release.version),
    ...ptBR.omitted.map((release) => release.version),
    ...ptBR.issues.flatMap((issue) => (issue.version ? [issue.version] : [])),
    ...en.releases.map((release) => release.version),
    ...en.omitted.map((release) => release.version),
    ...en.issues.flatMap((issue) => (issue.version ? [issue.version] : [])),
  ]);

  for (const version of versions) {
    const ptVisible = ptBR.releases.find((release) => release.version === version);
    const enVisible = en.releases.find((release) => release.version === version);
    const ptOmitted = ptBR.omitted.find((release) => release.version === version);
    const enOmitted = en.omitted.find((release) => release.version === version);
    const ptEmpty = ptBR.issues.some(
      (issue) => issue.code === "empty_body" && issue.version === version,
    );
    const enEmpty = en.issues.some(
      (issue) => issue.code === "empty_body" && issue.version === version,
    );

    if (ptEmpty || enEmpty) {
      throw new ChangelogDomainError("localized_content_missing", {
        locale: ptEmpty ? "pt-BR" : "en",
        version,
      });
    }
    if ((ptVisible && enOmitted) || (enVisible && ptOmitted)) {
      throw new ChangelogDomainError("localized_visibility_mismatch", {
        locale: ptVisible ? "en" : "pt-BR",
        version,
      });
    }
    if ((!ptVisible && !ptOmitted) || (!enVisible && !enOmitted)) {
      throw new ChangelogDomainError("localized_version_mismatch", {
        locale: entryLocale(ptBR, en, version),
        version,
      });
    }
    if (ptVisible && enVisible) {
      if (ptVisible.markdown.trim() === "" || enVisible.markdown.trim() === "") {
        throw new ChangelogDomainError("localized_content_missing", {
          locale: ptVisible.markdown.trim() === "" ? "pt-BR" : "en",
          version,
        });
      }
      if (!publicationsMatch(ptVisible.publication, enVisible.publication)) {
        throw new ChangelogDomainError("localized_publication_mismatch", { version });
      }
    }
    if (ptOmitted && enOmitted && !publicationsMatch(ptOmitted.publication, enOmitted.publication)) {
      throw new ChangelogDomainError("localized_publication_mismatch", { version });
    }
  }
}

/** Exact, punctuation-independent display format. */
export function formatPublication(
  publication: Publication,
  locale: ChangelogLocale,
  timeZone?: string,
): string | null {
  if (publication.kind === "date") {
    if (!isValidCalendarDate(publication.value)) return null;
    const [year, month, day] = publication.value.split("-");
    return locale === "pt-BR" ? `${day}/${month}/${year}` : `${month}/${day}/${year}`;
  }
  if (publication.kind !== "instant" || !isValidUtcInstant(publication.value)) return null;

  try {
    const formatter = new Intl.DateTimeFormat(locale === "pt-BR" ? "pt-BR" : "en-US", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    });
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(publication.value))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    const date =
      locale === "pt-BR"
        ? `${parts.day}/${parts.month}/${parts.year}`
        : `${parts.month}/${parts.day}/${parts.year}`;
    return `${date} ${parts.hour}:${parts.minute}`;
  } catch {
    return null;
  }
}

export function formatChangelogDiagnostic(
  issue: ChangelogIssue,
  locale: ChangelogLocale,
): string {
  const fields = [`changelog:${issue.code}`, `locale=${locale}`];
  if (issue.version) fields.push(`version=${issue.version}`);
  return fields.join(" ");
}

/** Package metadata is untrusted input at runtime, so the footer fails closed to 0.0.0. */
export function versaoAtual(pkg: { version?: unknown }): string {
  return typeof pkg.version === "string" && pkg.version.trim() !== ""
    ? pkg.version.trim()
    : "0.0.0";
}
