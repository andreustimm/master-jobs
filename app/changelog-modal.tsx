"use client";

import { ChevronDown, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils.ts";
import {
  formatPublication,
  type ChangelogLocale,
  type Publication,
  type UserRelease,
} from "../src/core/changelog.ts";
import { ChangelogMarkdown } from "./changelog-markdown";

export type ChangelogModalLabels = {
  open: string;
  title: string;
  lead: string;
  close: string;
};

export type ChangelogModalProps = {
  currentVersion: string;
  locale: ChangelogLocale;
  releases: UserRelease[];
  labels: ChangelogModalLabels;
};

export function initialExpanded(versions: readonly string[]): Set<string> {
  return versions[0] ? new Set([versions[0]]) : new Set();
}

export function toggleExpanded(expanded: ReadonlySet<string>, version: string): Set<string> {
  const next = new Set(expanded);
  if (next.has(version)) next.delete(version);
  else next.add(version);
  return next;
}

export function releaseIds(version: string): { headerId: string; contentId: string } | null {
  const token = version
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (token === "") return null;
  return {
    headerId: `changelog-release-${token}-header`,
    contentId: `changelog-release-${token}-content`,
  };
}

function PublicationTime({
  publication,
  locale,
  hydrated,
}: {
  publication: Publication;
  locale: ChangelogLocale;
  hydrated: boolean;
}) {
  const visible = publication.kind === "date" || hydrated
    ? formatPublication(publication, locale)
    : null;
  return (
    <time
      dateTime={publication.value}
      className="type-meta min-w-0 break-words font-mono tabular-nums text-muted-foreground"
    >
      {visible}
    </time>
  );
}

function ReleaseCard({
  release,
  locale,
  expanded,
  hydrated,
  onToggle,
}: {
  release: UserRelease;
  locale: ChangelogLocale;
  expanded: boolean;
  hydrated: boolean;
  onToggle: (version: string) => void;
}) {
  const ids = releaseIds(release.version);
  if (!ids) return null;

  return (
    <article
      className={cn(
        "min-w-0 overflow-hidden rounded-[var(--radius-surface)]",
        "border border-[var(--border)] bg-[var(--card)]",
      )}
    >
      <h3>
        <button
          id={ids.headerId}
          type="button"
          data-testid={`changelog-release-${release.version}`}
          data-state={expanded ? "open" : "closed"}
          aria-expanded={expanded}
          aria-controls={ids.contentId}
          onClick={() => onToggle(release.version)}
          className={cn(
            "flex min-h-11 w-full min-w-0 cursor-pointer items-center gap-3 px-4 py-3 text-left",
            "focus-visible:outline-2 focus-visible:outline-offset-[-2px]",
            "focus-visible:outline-[var(--primary-text)]",
          )}
        >
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
          <span className="type-caption-bold min-w-0 break-all rounded-[var(--radius-action)] bg-[var(--muted)] px-2 py-1 font-mono">
            v{release.version}
          </span>
          <span className="ml-auto min-w-0 text-right">
            <PublicationTime
              publication={release.publication}
              locale={locale}
              hydrated={hydrated}
            />
          </span>
        </button>
      </h3>

      <div
        id={ids.contentId}
        hidden={!expanded}
        className="min-w-0 border-t border-[var(--hairline)] px-4 py-4"
      >
        <ChangelogMarkdown markdown={release.markdown} />
      </div>
    </article>
  );
}

export function ChangelogModal({
  currentVersion,
  locale,
  releases,
  labels,
}: ChangelogModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => setHydrated(true), []);

  function openModal() {
    setExpanded(initialExpanded(releases.map((release) => release.version)));
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }

  function closeModal() {
    dialogRef.current?.close();
  }

  function resetAfterClose() {
    setExpanded(new Set());
    triggerRef.current?.focus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid="changelog-open"
        onClick={openModal}
        className={cn(
          "type-meta inline-flex min-h-11 cursor-pointer items-center",
          "text-[var(--primary-text)] underline-offset-2 hover:underline",
          "focus-visible:outline-2 focus-visible:outline-offset-2",
          "focus-visible:outline-[var(--primary-text)]",
        )}
      >
        {labels.open}
      </button>

      <dialog
        ref={dialogRef}
        data-testid="changelog-dialog"
        aria-labelledby="changelog-dialog-title"
        onCancel={() => setExpanded(new Set())}
        onClose={resetAfterClose}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) closeModal();
        }}
        style={{
          // O dialog nativo centraliza contra o viewport inteiro. A meia
          // diferença recentraliza dentro de safe areas assimétricas.
          height:
            "calc(100dvh - max(var(--spacing-xl), var(--safe-area-top)) - max(var(--spacing-xl), var(--safe-area-bottom)))",
          width:
            "min(calc(100vw - max(var(--spacing-md), var(--safe-area-left)) - max(var(--spacing-md), var(--safe-area-right))), 48rem)",
          marginTop: "max(var(--spacing-xl), var(--safe-area-top))",
          marginBottom: "max(var(--spacing-xl), var(--safe-area-bottom))",
          transform:
            "translateX(calc((max(var(--spacing-md), var(--safe-area-left)) - max(var(--spacing-md), var(--safe-area-right))) / 2))",
        }}
        className={cn(
          "mx-auto box-border overflow-hidden",
          "rounded-[var(--radius-surface)] border border-[var(--border)]",
          "bg-[var(--card)] p-0 text-[var(--card-foreground)] shadow-lg",
          "backdrop:bg-foreground/40 open:flex open:flex-col",
        )}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--hairline)] bg-[var(--card)] px-4 py-6 sm:px-6">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 id="changelog-dialog-title" className="type-display-xs break-words">
                {labels.title}
              </h2>
              <span className="type-caption-bold min-w-0 max-w-full break-all rounded-[var(--radius-action)] bg-[var(--muted)] px-2 py-1 font-mono">
                v{currentVersion}
              </span>
            </div>
            <p className="type-body-md mt-2 text-muted-foreground">{labels.lead}</p>
          </div>
          <button
            type="button"
            data-testid="changelog-close"
            aria-label={labels.close}
            onClick={closeModal}
            className={cn(
              "inline-flex size-11 shrink-0 cursor-pointer items-center justify-center",
              "rounded-[var(--radius-action)] text-muted-foreground",
              "hover:bg-[var(--muted)] hover:text-foreground",
              "focus-visible:outline-2 focus-visible:outline-offset-[-2px]",
              "focus-visible:outline-[var(--primary-text)]",
            )}
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-6">
          <ol className="grid min-w-0 gap-4">
            {releases.map((release) => (
              <li key={release.version} className="min-w-0">
                <ReleaseCard
                  release={release}
                  locale={locale}
                  expanded={expanded.has(release.version)}
                  hydrated={hydrated}
                  onToggle={(version) =>
                    setExpanded((current) => toggleExpanded(current, version))
                  }
                />
              </li>
            ))}
          </ol>
        </div>
      </dialog>
    </>
  );
}
