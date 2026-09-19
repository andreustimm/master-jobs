import { Input } from "@/components/ui/input";
import type { Translator } from "../../src/core/i18n/index.ts";
import type { TrackFields } from "./track-form";

const TEXTAREA =
  "min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 font-mono type-body-md text-foreground";

/** Os campos de uma trilha, em texto: um item por linha, sem JavaScript. */
export function TrackFieldset({
  fields,
  t,
  nameLocked = false,
}: {
  fields: TrackFields;
  t: Translator["t"];
  /** The primary keeps its name: it is the profile, not a choice of words. */
  nameLocked?: boolean;
}) {
  const label = "flex flex-col gap-1 type-caption-sm text-muted-foreground";
  return (
    <div className="grid gap-4">
      <label className={label}>
        {t("tracks.name")}
        <Input
          name="name"
          required
          maxLength={40}
          defaultValue={fields.name}
          readOnly={nameLocked}
          data-testid="track-name"
          data-user-content
        />
      </label>
      <label className={label}>
        {t("tracks.titles")}
        <textarea name="titles" defaultValue={fields.titles} className={TEXTAREA} data-testid="track-titles" data-user-content />
      </label>
      <label className={label}>
        {t("tracks.positives")}
        <textarea name="positives" defaultValue={fields.positives} className={TEXTAREA} data-testid="track-positives" data-user-content />
      </label>
      <label className={label}>
        {t("tracks.negatives")}
        <textarea name="negatives" defaultValue={fields.negatives} className={TEXTAREA} data-testid="track-negatives" data-user-content />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={label}>
          {t("tracks.minYears")}
          <Input type="number" name="minYears" min={0} max={40} defaultValue={fields.minYears} data-testid="track-min-years" />
        </label>
        <label className={label}>
          {t("tracks.rejectBelow")}
          <Input type="number" name="rejectBelow" min={0} max={40} defaultValue={fields.rejectBelow} data-testid="track-reject-below" />
        </label>
      </div>
      <label className={label}>
        {t("tracks.ranges")}
        <textarea name="ranges" defaultValue={fields.ranges} className={TEXTAREA} data-testid="track-ranges" />
      </label>
      <label className={label}>
        {t("tracks.referenceCurrency")}
        <Input name="referenceCurrency" maxLength={3} defaultValue={fields.referenceCurrency} className="w-24" data-testid="track-reference" />
      </label>
    </div>
  );
}
