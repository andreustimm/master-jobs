import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Translator } from "../src/core/i18n/index.ts";

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

/**
 * `label` é CHAVE de tradução, não texto.
 *
 * A legenda aparece em toda tela de vaga e era a maior fonte de português
 * vazando para a interface em inglês: 72 ocorrências de 8 strings, quase todas
 * daqui.
 */
/**
 * Grupo de ações de um card, e os botões dentro dele.
 *
 * Duas correções, ambas visíveis só no celular:
 *
 * **Largura.** As ações ficavam em `flex flex-wrap`, então cada botão media o
 * próprio texto: 54px para "vaga", 69px para "site ↗", 93px para "aplicar →".
 * Lado a lado isso lê como um botão menor que os outros, e foi assim que o
 * defeito foi reportado. No desktop o problema não existia porque a coluna
 * `sm:flex-col` já estica todos para a mesma largura — a inconsistência era
 * entre as duas telas, não dentro de uma.
 *
 * `auto-fit` com mínimo em vez de três colunas fixas: em 320px três colunas
 * espremeriam "aplicar →" para fora da caixa, e aqui a terceira desce para a
 * linha seguinte em vez de estourar.
 *
 * **Altura.** 28px é alvo de toque apertado para um dedo. Sobe para 40px no
 * celular e volta a 28px de `sm` para cima, onde o ponteiro é preciso e a
 * lista tem 50 linhas para caber.
 */
export const ACTION_GROUP =
  "grid grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))] gap-1.5 sm:flex sm:flex-col";

export const ACTION_BUTTON = "h-10 font-mono text-xs sm:h-7";

export const COMPONENTS = [
  { key: "titleScore", label: "score.title", className: "bg-[var(--color-brand)]" },
  { key: "keywordScore", label: "score.keyword", className: "bg-[var(--color-brand-bright)]" },
  { key: "geoScore", label: "score.eligibility", className: "bg-[var(--color-strong)]" },
  { key: "seniorityScore", label: "score.seniority", className: "bg-[var(--color-mid)]" },
  { key: "compScore", label: "score.compensation", className: "bg-[#5b5fa8]" },
  { key: "freshnessScore", label: "score.freshness", className: "bg-[var(--color-signal)]" },
  { key: "benefitScore", label: "score.benefits", className: "bg-[var(--color-signal-soft)]" },
] as const;

export type ScoreParts = Partial<
  Record<(typeof COMPONENTS)[number]["key"], number | null>
>;

export function Fit({
  value,
  className,
  size = "default",
}: {
  value: number | null;
  className?: string;
  size?: "default" | "large";
}) {
  const tone =
    value == null
      ? "text-muted-foreground"
      : value >= 70
        ? "text-[var(--color-strong)]"
        : value >= 55
          ? "text-[var(--color-mid)]"
          : "text-muted-foreground";
  return (
    <span
      className={cn(
        "font-mono font-bold leading-none tabular-nums",
        size === "large" ? "type-display-lg" : "type-display-xs",
        tone,
        className,
      )}
    >
      {value == null ? "—" : value.toFixed(0)}
    </span>
  );
}

export function ScoreBar({
  parts,
  t,
}: {
  parts: ScoreParts;
  t?: Translator["t"];
}) {
  const segments = COMPONENTS.map((c) => ({ ...c, value: Number(parts[c.key] ?? 0) })).filter(
    (s) => s.value > 0,
  );
  const used = segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <div className="jho-bar flex h-[5px] max-w-[520px] overflow-hidden rounded-sm bg-border">
      {segments.map((s) => (
        <span
          key={s.key}
          title={`${t ? t(s.label) : s.label}: ${s.value.toFixed(1)}`}
          className={s.className}
          style={{ flex: s.value }}
        />
      ))}
      {used < 100 && <span style={{ flex: 100 - used }} />}
    </div>
  );
}

export function Legend({ t }: { t: Translator["t"] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
      {COMPONENTS.map((c) => (
        <span key={c.key} className="inline-flex items-center gap-1.5">
          <i className={cn("inline-block size-2 rounded-[2px]", c.className)} />
          {t(c.label)}
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
