"use client";

import { Fragment, type ReactNode } from "react";
import { cvTextToMarkdown } from "../../src/core/cv-markdown.ts";

/**
 * Markdown preview, rendered as React nodes.
 *
 * Deliberately not `dangerouslySetInnerHTML` with a converted string. This is
 * the candidate's own CV rather than third-party content, so the risk is low —
 * but the rule that nothing in this app injects HTML is worth more than the
 * convenience, and an architecture test enforces it. Building nodes also means
 * the preview inherits the design system's type styles instead of needing a
 * parallel stylesheet.
 *
 * Scope is deliberately a CV, not CommonMark: headings, lists, emphasis, code,
 * links, quotes, rules. No tables, no footnotes, no HTML passthrough. A parser
 * that pretends to be complete and is not is worse than one with a stated edge.
 *
 * Two deliberate departures from CommonMark, both because the source is often a
 * CV imported from PDF rather than Markdown (#325): the text passes through
 * `cvTextToMarkdown()` first (caps titles become headings, glyph bullets become
 * items), and a single line break inside a paragraph is kept as a break — in a
 * CV a new line is a new fact, and joining them produced one wall of text.
 */

/**
 * Only web links become anchors. `javascript:`, `data:` and friends are the
 * XSS a Markdown link carries; React 19 blocks `javascript:` itself, but the
 * public profile should not lean on a framework default for that — and a
 * `mailto:` there would publish the address the profile promises to keep out.
 */
function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Inline spans: `code`, **bold**, *italic*, [text](url). */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Code first: its content must not be re-parsed for emphasis. The link's
  // label and target stop at the next bracket or parenthesis: `[^\]]+` and
  // `[^)]+` scanned to the end of the line from every unclosed `[`, which is
  // quadratic on a line of `[[[[` — and `/p/[slug]` renders this for anyone.
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*|_[^_]+_)|(\[[^[\]]+\]\([^()]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${i++}`;

    if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="type-mono-sm rounded bg-[var(--color-cloud)] px-1 py-0.5">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("[")) {
      const [, label = "", target = ""] = /\[([^[\]]+)\]\(([^()]+)\)/.exec(token) ?? [];
      const href = safeHref(target);
      nodes.push(
        href === null ? (
          <Fragment key={key}>{label}</Fragment>
        ) : (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--primary-text)] hover:underline"
          >
            {label}
          </a>
        ),
      );
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const HEADING_CLASS: Record<number, string> = {
  1: "type-display-sm mt-6 mb-2 first:mt-0",
  2: "type-display-xs mt-6 mb-2 first:mt-0",
  3: "type-body-lg font-semibold mt-5 mb-1.5",
  4: "type-body-md font-semibold mt-4 mb-1",
};

export function MarkdownPreview({ source, emptyLabel }: { source: string; emptyLabel: string }) {
  const lines = cvTextToMarkdown(source).split("\n");
  const blocks: ReactNode[] = [];

  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let fence: { lang: string; lines: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(
      <p key={`p-${blocks.length}`} className="type-body-md mb-3 leading-relaxed">
        {paragraph.map((line, i) => (
          <Fragment key={i}>
            {i > 0 && <br />}
            {inline(line, `p${blocks.length}-${i}`)}
          </Fragment>
        ))}
      </p>,
    );
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag
        key={`l-${blocks.length}`}
        className={`type-body-md mb-3 ml-5 space-y-1 ${list.ordered ? "list-decimal" : "list-disc"}`}
      >
        {list.items.map((item, i) => (
          <li key={i}>{inline(item, `l${blocks.length}-${i}`)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (fence) {
      if (line.trim().startsWith("```")) {
        blocks.push(
          <pre
            key={`c-${blocks.length}`}
            className="type-mono-sm mb-3 overflow-x-auto rounded-lg bg-[var(--color-cloud)] p-3"
          >
            <code>{fence.lines.join("\n")}</code>
          </pre>,
        );
        fence = null;
      } else {
        fence.lines.push(raw);
      }
      continue;
    }

    if (line.trim().startsWith("```")) {
      flushParagraph();
      flushList();
      fence = { lang: line.trim().slice(3), lines: [] };
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1]!.length;
      const Tag = `h${level}` as "h1";
      blocks.push(
        <Tag key={`h-${blocks.length}`} className={HEADING_CLASS[level]}>
          {inline(heading[2]!, `h${blocks.length}`)}
        </Tag>,
      );
      continue;
    }

    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push(
        <hr key={`r-${blocks.length}`} className="my-5 border-[var(--color-hairline)]" />,
      );
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      flushList();
      blocks.push(
        <blockquote
          key={`q-${blocks.length}`}
          className="type-body-md mb-3 border-l-2 border-[var(--color-brand)] pl-3 text-muted-foreground"
        >
          {inline(quote[1]!, `q${blocks.length}`)}
        </blockquote>,
      );
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push((bullet ?? ordered)![1]!);
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  if (fence) {
    blocks.push(
      <pre key="c-last" className="type-mono-sm mb-3 overflow-x-auto rounded-lg bg-[var(--color-cloud)] p-3">
        <code>{fence.lines.join("\n")}</code>
      </pre>,
    );
  }

  if (blocks.length === 0) {
    return <p className="type-body-md text-muted-foreground">{emptyLabel}</p>;
  }

  return <Fragment>{blocks}</Fragment>;
}
