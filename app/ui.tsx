/**
 * Shared presentation pieces.
 *
 * The score bar is the one that matters: this product's claim is that a rank is
 * explainable, and a number alone does not deliver that. Showing the five
 * components in proportion makes a false positive visible at a glance — a high
 * fit carried entirely by geo and pay, with no title match, reads wrong
 * immediately.
 */

export const COMPONENTS = [
  { key: "titleScore", label: "Cargo", color: "var(--color-brand)" },
  { key: "keywordScore", label: "Palavras-chave", color: "var(--color-brand-bright)" },
  { key: "geoScore", label: "Elegibilidade", color: "var(--color-strong)" },
  { key: "seniorityScore", label: "Senioridade", color: "var(--color-mid)" },
  { key: "compScore", label: "Remuneração", color: "#5b5fa8" },
] as const;

export function fitTone(fit: number | null): string {
  if (fit == null) return "var(--text-3)";
  if (fit >= 70) return "var(--color-strong)";
  if (fit >= 55) return "var(--color-mid)";
  return "var(--text-3)";
}

export function Fit({ value }: { value: number | null }) {
  return (
    <span
      className="mono"
      style={{ color: fitTone(value), fontWeight: 700, fontSize: 22, lineHeight: 1 }}
    >
      {value == null ? "—" : value.toFixed(0)}
    </span>
  );
}

export function ScoreBar({ parts }: { parts: Record<string, number | null> }) {
  const segments = COMPONENTS.map((c) => ({
    ...c,
    value: Number(parts[c.key] ?? 0),
  })).filter((s) => s.value > 0);

  const used = segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <div
      style={{
        display: "flex",
        height: 5,
        borderRadius: 3,
        overflow: "hidden",
        background: "var(--line)",
        maxWidth: 520,
      }}
    >
      {segments.map((s) => (
        <span
          key={s.key}
          title={`${s.label}: ${s.value.toFixed(1)}`}
          style={{ flex: s.value, background: s.color }}
        />
      ))}
      {used < 100 && <span style={{ flex: 100 - used }} />}
    </div>
  );
}

export function Legend() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12, color: "var(--text-2)" }}>
      {COMPONENTS.map((c) => (
        <span key={c.key} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <i style={{ width: 9, height: 9, borderRadius: 2, background: c.color, display: "inline-block" }} />
          {c.label}
        </span>
      ))}
    </div>
  );
}

export function Chip({ children, tone = "accent" }: { children: React.ReactNode; tone?: "accent" | "muted" | "alert" }) {
  const bg =
    tone === "alert" ? "var(--color-alert)" : tone === "muted" ? "var(--sunk)" : "var(--accent)";
  const fg = tone === "muted" ? "var(--text-2)" : "#fff";
  return (
    <span
      className="mono"
      style={{
        fontSize: 10,
        letterSpacing: ".08em",
        textTransform: "uppercase",
        padding: "2px 7px",
        borderRadius: 3,
        background: bg,
        color: fg,
      }}
    >
      {children}
    </span>
  );
}

export function Stat({ value, label, accent }: { value: string | number; label: string; accent?: boolean }) {
  return (
    <div style={{ background: "var(--surface)", padding: "16px 18px" }}>
      <div
        className="mono"
        style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1, color: accent ? "var(--accent)" : "var(--text)" }}
      >
        {value}
      </div>
      <div
        className="mono"
        style={{ fontSize: 10.5, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)", marginTop: 5 }}
      >
        {label}
      </div>
    </div>
  );
}
