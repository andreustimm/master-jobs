import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Presentation pieces built on shadcn primitives.
 *
 * The score bar stays hand-rolled: it is the one thing no component library
 * ships, and it is this product's actual argument — a rank is only trustworthy
 * if you can see what produced it. Showing the five components in proportion
 * makes a false positive obvious, where a bare number never would.
 *
 * Two of these are not fit at all: freshness and benefits answer "is applying
 * still worth doing" rather than "is this the right job". They are last in the
 * bar for that reason — the eye reads fit first.
 */

export const COMPONENTS = [
  { key: "titleScore", label: "Cargo", className: "bg-[var(--color-brand)]" },
  { key: "keywordScore", label: "Palavras-chave", className: "bg-[var(--color-brand-bright)]" },
  { key: "geoScore", label: "Elegibilidade", className: "bg-[var(--color-strong)]" },
  { key: "seniorityScore", label: "Senioridade", className: "bg-[var(--color-mid)]" },
  { key: "compScore", label: "Remuneração", className: "bg-[#5b5fa8]" },
  { key: "freshnessScore", label: "Frescor", className: "bg-[var(--color-signal)]" },
  { key: "benefitScore", label: "Benefícios", className: "bg-[var(--color-signal-soft)]" },
] as const;

export function Fit({ value, className }: { value: number | null; className?: string }) {
  const tone =
    value == null
      ? "text-muted-foreground"
      : value >= 70
        ? "text-[var(--color-strong)]"
        : value >= 55
          ? "text-[var(--color-mid)]"
          : "text-muted-foreground";
  return (
    <span className={cn("font-mono type-display-xs font-bold leading-none tabular-nums", tone, className)}>
      {value == null ? "—" : value.toFixed(0)}
    </span>
  );
}

export function ScoreBar({ parts }: { parts: Record<string, number | null> }) {
  const segments = COMPONENTS.map((c) => ({ ...c, value: Number(parts[c.key] ?? 0) })).filter(
    (s) => s.value > 0,
  );
  const used = segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <div className="jho-bar flex h-[5px] max-w-[520px] overflow-hidden rounded-sm bg-border">
      {segments.map((s) => (
        <span
          key={s.key}
          title={`${s.label}: ${s.value.toFixed(1)}`}
          className={s.className}
          style={{ flex: s.value }}
        />
      ))}
      {used < 100 && <span style={{ flex: 100 - used }} />}
    </div>
  );
}

export function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
      {COMPONENTS.map((c) => (
        <span key={c.key} className="inline-flex items-center gap-1.5">
          <i className={cn("inline-block size-2 rounded-[2px]", c.className)} />
          {c.label}
        </span>
      ))}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "rejected" || status === "withdrawn"
      ? "destructive"
      : status === "offer" || status === "interviewing"
        ? "default"
        : "secondary";
  return (
    <Badge variant={variant} className="font-mono type-micro tracking-wider uppercase">
      {status}
    </Badge>
  );
}

export function Stat({
  value,
  label,
  accent,
}: {
  value: string | number;
  label: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-card px-4 py-4">
      <div
        className={cn(
          "font-mono text-2xl leading-tight font-bold tabular-nums",
          accent && "text-[var(--primary-text)]",
        )}
      >
        {value}
      </div>
      <div className="mt-1 font-mono type-micro tracking-[.1em] text-muted-foreground uppercase">
        {label}
      </div>
    </div>
  );
}
