"use client";

import { Fragment, type ReactNode } from "react";

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
 */

/** Inline spans: `code`, **bold**, *italic*, [text](url). */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Code first: its content must not be re-parsed for emphasis.
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*|_[^_]+_)|(\[[^\]]+\]\([^)]+\))/g;
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
      const [, label, href] = /\[([^\]]+)\]\(([^)]+)\)/.exec(token) ?? [];
      nodes.push(
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          {label}
        </a>,
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

export function MarkdownPreview({ source }: { source: string }) {
  const lines = source.split("\n");
  const blocks: ReactNode[] = [];

  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let fence: { lang: string; lines: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(
      <p key={`p-${blocks.length}`} className="type-body-md mb-3 leading-relaxed">
        {inline(paragraph.join(" "), `p${blocks.length}`)}
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
    return <p className="type-body-md text-muted-foreground">Nada para mostrar ainda.</p>;
  }

  return <Fragment>{blocks}</Fragment>;
}
