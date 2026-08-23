import ReactMarkdown, { type Components } from "react-markdown";
import { cn } from "../lib/utils.ts";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const PROTOCOL = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const ALLOWED_ELEMENTS = [
  "a",
  "blockquote",
  "code",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "ul",
] as const;

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

const components: Components = {
  a({ node: _node, href, children, ...props }) {
    if (!href) return <span className="break-words">{children}</span>;
    return (
      <a
        {...props}
        href={href}
        className="type-link-md break-words text-[var(--primary-text)] underline underline-offset-2"
      >
        {children}
      </a>
    );
  },
  blockquote({ node: _node, ...props }) {
    return (
      <blockquote
        {...props}
        className="type-body-md border-l-2 border-[var(--border)] pl-4 text-muted-foreground"
      />
    );
  },
  code({ node: _node, className, ...props }) {
    const fenced = className?.startsWith("language-") === true;
    return (
      <code
        {...props}
        className={cn(
          "type-caption-md font-mono",
          fenced
            ? "block min-w-max"
            : "break-words rounded-[var(--radius-action)] bg-[var(--muted)] px-1 py-0.5",
          className,
        )}
      />
    );
  },
  em({ node: _node, ...props }) {
    return <em {...props} />;
  },
  h1({ node: _node, ...props }) {
    return <h1 {...props} className="type-display-sm break-words" />;
  },
  h2({ node: _node, ...props }) {
    return <h2 {...props} className="type-display-xs break-words" />;
  },
  h3({ node: _node, ...props }) {
    return <h3 {...props} className="type-body-lg break-words font-medium" />;
  },
  h4({ node: _node, ...props }) {
    return <h4 {...props} className="type-body-emphasis break-words" />;
  },
  h5({ node: _node, ...props }) {
    return <h5 {...props} className="type-caption-bold break-words" />;
  },
  h6({ node: _node, ...props }) {
    return <h6 {...props} className="type-meta break-words font-semibold" />;
  },
  hr({ node: _node, ...props }) {
    return <hr {...props} className="border-[var(--hairline)]" />;
  },
  li({ node: _node, ...props }) {
    return <li {...props} className="type-body-md break-words pl-1" />;
  },
  ol({ node: _node, ...props }) {
    return <ol {...props} className="grid list-decimal gap-2 pl-5" />;
  },
  p({ node: _node, ...props }) {
    return <p {...props} className="type-body-md break-words" />;
  },
  pre({ node: _node, ...props }) {
    return (
      <pre
        {...props}
        className="max-w-full overflow-x-auto rounded-[var(--radius-surface)] bg-[var(--muted)] p-4"
      />
    );
  },
  strong({ node: _node, ...props }) {
    return <strong {...props} className="font-semibold" />;
  },
  ul({ node: _node, ...props }) {
    return <ul {...props} className="grid list-disc gap-2 pl-5" />;
  },
};

export function ChangelogMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="grid min-w-0 gap-4 [&_blockquote>p]:text-inherit [&_li>p]:inline">
      <ReactMarkdown
        allowedElements={[...ALLOWED_ELEMENTS]}
        components={components}
        skipHtml
        urlTransform={safeChangelogUrl}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
