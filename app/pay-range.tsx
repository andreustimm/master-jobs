"use client";

import { useState } from "react";
import { PAY_FILTER_MAX, PAY_SLIDER_CEILING, PAY_SLIDER_STEP } from "./filter-scales.ts";
import { RangeSlider, type RangeLabels } from "./range-slider";

/**
 * The pay range: a range over money, so it carries a currency and a period.
 *
 * The period lives here rather than beside the control because it rescales the
 * slider: 60.000 a month and 60.000 a year are not the same drag. Changing it
 * has to move the track under the thumbs immediately, not after Apply.
 *
 * The currency does not rescale anything — the scale is a reading aid, not a
 * conversion — so it is an uncontrolled select that only travels with the form.
 */

type Period = "month" | "year";

export type PayRangeLabels = RangeLabels & {
  currency: string;
  period: string;
  perMonth: string;
  perYear: string;
};

const SELECT = "h-8 rounded-lg border border-input bg-transparent px-2 type-body-md text-foreground";

export function PayRange({
  min,
  max,
  period,
  currency,
  currencies,
  labels,
  children,
}: {
  min: number | undefined;
  max: number | undefined;
  period: Period;
  currency: string;
  currencies: string[];
  labels: PayRangeLabels;
  /** The Apply button, composed from the server so its text stays translated. */
  children?: React.ReactNode;
}) {
  const [unit, setUnit] = useState<Period>(period);

  return (
    <RangeSlider
      minName="pay"
      maxName="payMax"
      min={min}
      max={max}
      limit={PAY_FILTER_MAX}
      // Salário começa em 1, não em 0: `positiveInt` recusa zero na leitura da
      // URL, então oferecer zero no campo era oferecer um valor que a tela
      // devolveria como inválido. No Score o piso segue sendo 0, que ali
      // significa "toda nota".
      floorLimit={1}
      ceiling={PAY_SLIDER_CEILING[unit]}
      step={PAY_SLIDER_STEP[unit]}
      labels={labels}
      testId="filters-pay"
    >
      <label className="flex flex-col gap-1 type-caption-sm text-muted-foreground">
        {labels.currency}
        <select name="cur" defaultValue={currency} className={SELECT} data-testid="filters-pay-currency">
          {currencies.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 type-caption-sm text-muted-foreground">
        {labels.period}
        <select
          name="per"
          value={unit}
          onChange={(event) => setUnit(event.target.value === "year" ? "year" : "month")}
          className={SELECT}
          data-testid="filters-pay-period"
        >
          <option value="month">{labels.perMonth}</option>
          <option value="year">{labels.perYear}</option>
        </select>
      </label>
      {children}
    </RangeSlider>
  );
}
