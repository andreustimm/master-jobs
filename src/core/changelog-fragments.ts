import {
  bodyHasUserContent,
  changelogSections,
  hasNoUserChangeMarker,
  isCanonicalUnreleased,
  linesIn,
} from "./changelog.ts";

/**
 * Fragmentos de changelog — o núcleo PURO.
 *
 * ## Por que existe
 *
 * Toda PR editava o `## [Unreleased]` dos três changelogs, e cada merge em
 * `dev` — mais o `chore(release)` que a promoção grava lá — reabria conflito
 * em todas as PRs abertas. Com um arquivo por PR em `changelog.d/`, duas PRs
 * nunca disputam a mesma linha. A promoção junta os fragmentos no
 * `Unreleased` imediatamente antes do carimbo, e o commit de release os apaga.
 *
 * ## Formato
 *
 * ```markdown
 * ## Técnico
 *
 * ### Corrigido
 *
 * - O que mudou, para quem mexe no código.
 *
 * ## pt-BR
 *
 * ### Corrigido
 *
 * - O efeito, em linguagem simples.
 *
 * ## en
 *
 * ### Fixed
 *
 * - The effect, in plain language.
 * ```
 *
 * Os três blocos são obrigatórios. `pt-BR` e `en` podem trazer só
 * `<!-- sem-nota-usuario -->` quando nada muda para quem usa — os dois juntos,
 * nunca um só. Conteúdo fica sob `### Seção` e começa por item de lista, para a
 * junção formar uma lista só com as entradas de outras PRs.
 *
 * ## Determinismo
 *
 * A retentativa da promoção reconstrói o commit de release e compara bytes
 * (contrato de proveniência da #225). Por isso a ordem nunca vem do sistema de
 * arquivos: os fragmentos são ordenados pelo nome, por ponto de código, e as
 * seções aparecem na ordem da primeira ocorrência — o `Unreleased` existente
 * primeiro, depois os fragmentos.
 */

export const FRAGMENT_DIRECTORY = "changelog.d";

export type ChangelogFragment = { name: string; content: string };

export type FragmentDocuments = { technical: string; ptBR: string; en: string };

type Part = keyof FragmentDocuments;

type Section = { heading: string; body: string };

type ParsedPart = { omitted: boolean; sections: Section[] };

export type ParsedFragment = { name: string } & Record<Part, ParsedPart>;

export type ChangelogFragmentIssue =
  | "invalid_name"
  | "duplicate_name"
  | "unknown_block"
  | "duplicate_block"
  | "missing_block"
  | "forbidden_heading"
  | "content_outside_section"
  | "empty_block"
  | "empty_section"
  | "section_not_list"
  | "invalid_omission"
  | "localized_visibility_mismatch";

export class ChangelogFragmentError extends Error {
  readonly code: ChangelogFragmentIssue;
  readonly fragment: string;

  constructor(code: ChangelogFragmentIssue, fragment: string) {
    // O nome vem do sistema de arquivos e vai para log de CI e de hook.
    const safe = fragment.replace(/[^A-Za-z0-9._/-]/g, "?").slice(0, 96) || "?";
    super(`changelog_fragment_invalid code=${code} fragment=${safe}`);
    this.name = "ChangelogFragmentError";
    this.code = code;
    this.fragment = safe;
  }
}

const NAME = /^[a-z0-9][a-z0-9._-]*\.md$/;
const BLOCKS: ReadonlyMap<string, Part> = new Map([
  ["Técnico", "technical"],
  ["pt-BR", "ptBR"],
  ["en", "en"],
]);
const PARTS: readonly Part[] = ["technical", "ptBR", "en"];
// `#` e `##` (inclusive `##[1.0.0]`, que o parser do changelog lê como versão)
// criariam uma seção de release dentro do Unreleased. Só os blocos passam.
// `#228` no começo de linha quebrada é referência a PR, não cabeçalho: sem
// espaço, fim de linha ou `[` depois dos `#`, o Markdown não abre título.
const TOP_HEADING = /^ {0,3}#{1,2}(?:[ \t[]|$)/;
const BLOCK_HEADING = /^ {0,3}##[ \t]+(\S.*?)[ \t]*$/;
const SECTION_HEADING = /^ {0,3}###[ \t]+(\S.*?)[ \t]*$/;
const LIST_ITEM = /^ {0,3}- \S/;

function trimBlankLines(text: string): string {
  return text
    .replace(/^(?:[ \t]*\r?\n)+/, "")
    .replace(/\s+$/, "");
}

/** Split a block body into its preamble and `### Heading` sections. */
function splitSections(body: string): { preamble: string; sections: Section[] } {
  const headers = linesIn(body)
    .filter((line) => !line.code)
    .flatMap((line) => {
      const match = SECTION_HEADING.exec(line.text);
      return match ? [{ heading: match[1]!, start: line.start, bodyStart: line.end }] : [];
    });
  const preamble = body.slice(0, headers[0]?.start ?? body.length);
  const sections = headers.map((header, index) => ({
    heading: header.heading,
    body: trimBlankLines(body.slice(header.bodyStart, headers[index + 1]?.start ?? body.length)),
  }));
  return { preamble, sections };
}

function parsePart(name: string, part: Part, body: string): ParsedPart {
  if (hasNoUserChangeMarker(body)) {
    if (part === "technical" || bodyHasUserContent(body)) {
      throw new ChangelogFragmentError("invalid_omission", name);
    }
    return { omitted: true, sections: [] };
  }
  const { preamble, sections } = splitSections(body);
  if (bodyHasUserContent(preamble)) throw new ChangelogFragmentError("content_outside_section", name);
  if (sections.length === 0) throw new ChangelogFragmentError("empty_block", name);
  for (const section of sections) {
    if (!bodyHasUserContent(section.body)) throw new ChangelogFragmentError("empty_section", name);
    if (!LIST_ITEM.test(section.body.split("\n")[0]!)) {
      throw new ChangelogFragmentError("section_not_list", name);
    }
  }
  return { omitted: false, sections };
}

function parseFragment(fragment: ChangelogFragment): ParsedFragment {
  const { name, content } = fragment;
  const ranges = new Map<Part, { start: number; end: number }>();
  let current: Part | null = null;
  let preambleEnd = content.length;

  for (const line of linesIn(content)) {
    if (line.code || !TOP_HEADING.test(line.text)) continue;
    const block = BLOCK_HEADING.exec(line.text);
    if (!block || block[1]!.startsWith("[")) throw new ChangelogFragmentError("forbidden_heading", name);
    const part = BLOCKS.get(block[1]!);
    if (!part) throw new ChangelogFragmentError("unknown_block", name);
    if (ranges.has(part)) throw new ChangelogFragmentError("duplicate_block", name);
    if (current) ranges.get(current)!.end = line.start;
    else preambleEnd = line.start;
    ranges.set(part, { start: line.end, end: content.length });
    current = part;
  }

  if (bodyHasUserContent(content.slice(0, preambleEnd))) {
    throw new ChangelogFragmentError("content_outside_section", name);
  }
  const parsed = { name } as ParsedFragment;
  for (const part of PARTS) {
    const range = ranges.get(part);
    if (!range) throw new ChangelogFragmentError("missing_block", name);
    parsed[part] = parsePart(name, part, content.slice(range.start, range.end));
  }
  if (parsed.ptBR.omitted !== parsed.en.omitted) {
    throw new ChangelogFragmentError("localized_visibility_mismatch", name);
  }
  return parsed;
}

/**
 * Every entry of `changelog.d/` must be a fragment. The caller lists the
 * directory, and a `.MD` or a subdirectory silently skipped would be an entry
 * that never reaches the changelog — so names are checked before any read.
 */
export function assertFragmentNames(names: readonly string[]): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (!NAME.test(name)) throw new ChangelogFragmentError("invalid_name", name);
    if (seen.has(name)) throw new ChangelogFragmentError("duplicate_name", name);
    seen.add(name);
  }
}

/** Validate every fragment and return them in their canonical order. */
export function parseChangelogFragments(fragments: readonly ChangelogFragment[]): ParsedFragment[] {
  assertFragmentNames(fragments.map((fragment) => fragment.name));
  return [...fragments]
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    .map(parseFragment);
}

function withoutMarkerLines(text: string): string {
  return linesIn(text)
    .filter((line) => line.code || !hasNoUserChangeMarker(line.text))
    .map((line) => line.text)
    .join("\n");
}

function mergePart(markdown: string, parts: ParsedPart[]): string {
  const structural = changelogSections(markdown).filter((section) => section.token === "Unreleased");
  // Zero or duplicated Unreleased is prepareRelease's error to report, with
  // its own code; merging into a guess would hide it.
  if (structural.length !== 1 || !isCanonicalUnreleased(structural[0]!)) return markdown;
  const unreleased = structural[0]!;
  const existing = markdown.slice(unreleased.bodyStart, unreleased.bodyEnd);
  const incoming = parts.flatMap((part) => part.sections);

  let body: string;
  if (incoming.length === 0) {
    if (!parts.some((part) => part.omitted)) return markdown;
    if (bodyHasUserContent(existing) || hasNoUserChangeMarker(existing)) return markdown;
    body = "<!-- sem-nota-usuario -->";
  } else {
    const { preamble, sections } = splitSections(existing);
    const buckets = new Map<string, string[]>();
    for (const section of [...sections, ...incoming]) {
      if (!bodyHasUserContent(section.body)) continue;
      const chunks = buckets.get(section.heading) ?? [];
      chunks.push(section.body);
      buckets.set(section.heading, chunks);
    }
    // A legacy "no user change" marker loses to content arriving now; keeping
    // both would publish an invalid omission.
    const lead = trimBlankLines(withoutMarkerLines(preamble));
    // A single newline keeps adjacent bullets in one tight list.
    const rendered = [...buckets].map(([heading, chunks]) => `### ${heading}\n\n${chunks.join("\n")}`);
    body = [...(lead ? [lead] : []), ...rendered].join("\n\n");
  }
  const tail = unreleased.bodyEnd < markdown.length ? "\n\n" : "\n";
  return `${markdown.slice(0, unreleased.bodyStart)}\n\n${body}${tail}${markdown.slice(unreleased.bodyEnd)}`;
}

/**
 * Fold the fragments into each changelog's `## [Unreleased]`.
 *
 * Without fragments the documents come back untouched, byte for byte, so the
 * legacy path (entries written directly in Unreleased) is unchanged.
 */
export function mergeChangelogFragments(
  documents: FragmentDocuments,
  fragments: readonly ChangelogFragment[],
): FragmentDocuments {
  if (fragments.length === 0) return documents;
  const parsed = parseChangelogFragments(fragments);
  return {
    technical: mergePart(documents.technical, parsed.map((fragment) => fragment.technical)),
    ptBR: mergePart(documents.ptBR, parsed.map((fragment) => fragment.ptBR)),
    en: mergePart(documents.en, parsed.map((fragment) => fragment.en)),
  };
}
