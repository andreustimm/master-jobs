"use client";

import { Slider } from "@base-ui/react/slider";
import { useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * A range: two number fields and a two-thumb slider over the same pair.
 *
 * Dragging answers "what is out there between 8k and 15k" without typing; the
 * fields stay because a slider cannot express 12.345 and because they are what
 * the URL carries.
 *
 * The fields are authoritative: what they show is what the form submits, so an
 * empty field is genuinely no bound. Only the thumb that moved writes its own
 * field — otherwise dragging the floor would invent a ceiling nobody asked for.
 *
 * `"use client"` stops here. The page stays a Server Component, the state still
 * lives in the URL, and this island only edits inputs inside the GET form
 * around it.
 */

export type RangeLabels = {
  min: string;
  max: string;
  minThumb: string;
  maxThumb: string;
  /**
   * What an empty field means, shown inside it.
   *
   * A thumb dragged to the end of the track clears its field, because "no
   * bound" is the truth and any number there would be one the reader never
   * chose. Left unsaid, that reads as the control losing the value — so the
   * field says it: "no floor", "no cap", or the real ceiling when there is one.
   */
  minPlaceholder: string;
  maxPlaceholder: string;
};

const THUMB =
  "relative size-4 rounded-full border-2 border-primary bg-background after:absolute after:-inset-3 after:content-['']";

/** A typed field is clamped to the range the filter accepts, as it is typed. */
function clamp(raw: string, limit: number): string {
  if (raw.trim() === "") return "";
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw;
  return String(Math.min(Math.max(value, 0), limit));
}

/** The field's value as a slider position, clamped into the scale. */
function position(raw: string, fallback: number, ceiling: number): number {
  if (raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, 0), ceiling);
}

export function RangeSlider({
  minName,
  maxName,
  min,
  max,
  limit,
  ceiling,
  step,
  labels,
  testId,
  children,
}: {
  minName: string;
  maxName: string;
  min: number | undefined;
  max: number | undefined;
  /** Largest value the fields accept. */
  limit: number;
  /** Where the scale ends before a typed value stretches it. */
  ceiling: number;
  step: number;
  labels: RangeLabels;
  testId: string;
  /** Controls that belong on the fields row — Apply, a currency, a period. */
  children?: React.ReactNode;
}) {
  const [floor, setFloor] = useState(min === undefined ? "" : String(min));
  const [roof, setRoof] = useState(max === undefined ? "" : String(max));

  // The scale grows to hold a typed value above it, so a 90.000 monthly floor
  // still shows a thumb instead of pinning at the end of the track.
  const typed = Math.max(Number(floor) || 0, Number(roof) || 0);
  const top = Math.min(Math.max(ceiling, Math.ceil(typed / step) * step), limit);
  const value: [number, number] = [position(floor, 0, top), position(roof, top, top)];

  return (
    <div className="flex w-full flex-col gap-1">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 type-caption-sm text-muted-foreground">
          {labels.min}
          <Input
            type="number"
            name={minName}
            min={0}
            max={limit}
            step={1}
            inputMode="numeric"
            value={floor}
            placeholder={labels.minPlaceholder}
            onChange={(event) => setFloor(clamp(event.target.value, limit))}
            className="w-28"
            data-testid={`${testId}-min`}
          />
        </label>
        <label className="flex flex-col gap-1 type-caption-sm text-muted-foreground">
          {labels.max}
          <Input
            type="number"
            name={maxName}
            min={0}
            max={limit}
            step={1}
            inputMode="numeric"
            value={roof}
            placeholder={labels.maxPlaceholder}
            onChange={(event) => setRoof(clamp(event.target.value, limit))}
            className="w-28"
            data-testid={`${testId}-max`}
          />
        </label>
        {children}
      </div>
      <Slider.Root
        value={value}
        min={0}
        max={top}
        step={step}
        minStepsBetweenValues={1}
        thumbCollisionBehavior="none"
        onValueChange={(next, details) => {
          // A floor of zero and a ceiling at the end of the scale are both "no
          // bound", and an empty field says that more honestly than a number
          // the reader never chose.
          if (details.activeThumbIndex === 0) setFloor(next[0] === 0 ? "" : String(next[0]));
          else setRoof(next[1] === top ? "" : String(next[1]));
        }}
        className="max-w-[28rem]"
        data-testid={`${testId}-slider`}
      >
        <Slider.Control className="flex w-full touch-none items-center py-3 select-none">
          <Slider.Track className="h-1 w-full rounded-full bg-muted">
            <Slider.Indicator className="rounded-full bg-primary" />
            <Slider.Thumb index={0} getAriaLabel={() => labels.minThumb} className={THUMB} />
            <Slider.Thumb index={1} getAriaLabel={() => labels.maxThumb} className={THUMB} />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
    </div>
  );
}
