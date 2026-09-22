import { createElement, type HTMLAttributes } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import { cn } from "../lib/utils.ts";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const PROTOCOL = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const ALLOWED_ELEMENTS = [
  "a", "blockquote", "code", "em", "h1", "h2", "h3", "h4", "h5", "h6",
  "hr", "li", "ol", "p", "pre", "strong", "ul",
];

export function safeChangelogUrl(value: string): string {
  const destination = value.trim();
  if (destination === "" || /[\u0000-\u001F\u007F]/.test(destination)) return "";

  if (!PROTOCOL.test(destination)) {
    if (destination.startsWith("//")) return "";
    try {
      new URL(destination, "https://master-jobs.invalid");
      return destination;
    } catch {
      return "";
    }
  }

  try {
    const parsed = new URL(destination);
    return ALLOWED_PROTOCOLS.has(parsed.protocol.toLowerCase()) ? destination : "";
  } catch {
    return "";
  }
}

function styled(tag: string, className: string) {
  return ({ node: _node, ...props }: HTMLAttributes<HTMLElement> & ExtraProps) =>
    createElement(tag, { ...props, className });
}

const components: Components = {
  a({ node: _node, href, children, ...props }) {
    if (!href) return createElement("span", { className: "break-words" }, children);
    return createElement("a", {
      ...props,
      href,
      className: "type-link-md break-words text-[var(--primary-text)] underline underline-offset-2",
    }, children);
  },
  blockquote: styled("blockquote", "type-body-md border-l-2 border-[var(--border)] pl-4 text-muted-foreground"),
  code({ node: _node, className, ...props }) {
    const fenced = className?.startsWith("language-") === true;
    return createElement("code", {
      ...props,
      className: cn(
        "type-caption-md font-mono",
        fenced
          ? "block min-w-max"
          : "break-words rounded-[var(--radius-action)] bg-[var(--muted)] px-1 py-0.5",
        className,
      ),
    });
  },
  h1: styled("h1", "type-display-sm break-words"),
  h2: styled("h2", "type-display-xs break-words"),
  h3: styled("h3", "type-body-lg break-words font-medium"),
  h4: styled("h4", "type-body-emphasis break-words"),
  h5: styled("h5", "type-caption-bold break-words"),
  h6: styled("h6", "type-meta break-words font-semibold"),
  hr: styled("hr", "border-[var(--hairline)]"),
  li: styled("li", "type-body-md break-words pl-1"),
  ol: styled("ol", "grid list-decimal gap-2 pl-5"),
  p: styled("p", "type-body-md break-words"),
  pre: styled("pre", "max-w-full overflow-x-auto rounded-[var(--radius-surface)] bg-[var(--muted)] p-4"),
  strong: styled("strong", "font-semibold"),
  ul: styled("ul", "grid list-disc gap-2 pl-5"),
};

/** Build-only: raw HTML and unsafe destinations never enter the generated artifact. */
export function renderChangelogMarkdown(markdown: string): string {
  return renderToStaticMarkup(createElement(ReactMarkdown, {
    allowedElements: ALLOWED_ELEMENTS,
    components,
    skipHtml: true,
    urlTransform: safeChangelogUrl,
    children: markdown,
  }));
}
