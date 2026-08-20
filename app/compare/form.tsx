"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { compareJobAction } from "./actions";
import {
  INITIAL_COMPARE_STATE,
  type CompareActionState,
  type CompareErrorCode,
  type CompareField,
} from "./form-state";

export type CompareFormLabels = {
  formTitle: string;
  role: string;
  rolePlaceholder: string;
  company: string;
  companyPlaceholder: string;
  location: string;
  locationPlaceholder: string;
  url: string;
  urlPlaceholder: string;
  description: string;
  descriptionPlaceholder: string;
  descriptionHint: string;
  or: string;
  file: string;
  fileHint: string;
  submit: string;
  pending: string;
  errors: Record<CompareErrorCode, string>;
};

function errorId(field: CompareField): string {
  return `compare-${field}-error`;
}

function FieldError({
  state,
  field,
  labels,
}: {
  state: CompareActionState;
  field: CompareField;
  labels: CompareFormLabels;
}) {
  const errors = state.fieldErrors?.[field];
  if (!errors?.length) return null;
  return (
    <p id={errorId(field)} role="alert" className="type-caption-sm text-destructive">
      {errors.map((code) => labels.errors[code]).join(" ")}
    </p>
  );
}

export function CompareForm({ labels }: { labels: CompareFormLabels }) {
  const [fileSelected, setFileSelected] = useState(false);
  const [state, formAction, pending] = useActionState(
    compareJobAction,
    INITIAL_COMPARE_STATE,
  );

  const invalid = (field: CompareField) => Boolean(state.fieldErrors?.[field]?.length);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="type-display-xs">{labels.formTitle}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <form action={formAction} className="grid gap-5">
          <input type="hidden" name="fileSelected" value={fileSelected ? "1" : "0"} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="compare-title">{labels.role}</Label>
              <Input
                id="compare-title"
                name="title"
                required
                maxLength={180}
                placeholder={labels.rolePlaceholder}
                aria-invalid={invalid("title")}
                aria-describedby={invalid("title") ? errorId("title") : undefined}
              />
              <FieldError state={state} field="title" labels={labels} />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="compare-company">{labels.company}</Label>
              <Input
                id="compare-company"
                name="companyName"
                required
                maxLength={180}
                placeholder={labels.companyPlaceholder}
                aria-invalid={invalid("companyName")}
                aria-describedby={invalid("companyName") ? errorId("companyName") : undefined}
              />
              <FieldError state={state} field="companyName" labels={labels} />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="compare-location">{labels.location}</Label>
              <Input
                id="compare-location"
                name="location"
                maxLength={240}
                placeholder={labels.locationPlaceholder}
                aria-invalid={invalid("location")}
                aria-describedby={invalid("location") ? errorId("location") : undefined}
              />
              <FieldError state={state} field="location" labels={labels} />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="compare-url">{labels.url}</Label>
              <Input
                id="compare-url"
                name="url"
                type="url"
                inputMode="url"
                maxLength={2_000}
                placeholder={labels.urlPlaceholder}
                aria-invalid={invalid("url")}
                aria-describedby={invalid("url") ? errorId("url") : undefined}
              />
              <FieldError state={state} field="url" labels={labels} />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="compare-description">{labels.description}</Label>
            <Textarea
              id="compare-description"
              name="description"
              rows={15}
              maxLength={200_000}
              className="field-sizing-fixed min-h-64 max-h-96 resize-y"
              placeholder={labels.descriptionPlaceholder}
              aria-invalid={invalid("description")}
              aria-describedby={`compare-description-hint${invalid("description") ? ` ${errorId("description")}` : ""}`}
            />
            <p id="compare-description-hint" className="type-caption-sm text-muted-foreground">
              {labels.descriptionHint}
            </p>
            <FieldError state={state} field="description" labels={labels} />
          </div>

          <div className="flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-border" />
            <span className="font-mono type-micro text-muted-foreground uppercase">
              {labels.or}
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="compare-file">{labels.file}</Label>
            <Input
              id="compare-file"
              name="file"
              type="file"
              accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"
              onChange={(event) => setFileSelected(event.currentTarget.files?.length === 1)}
              aria-invalid={invalid("file")}
              aria-describedby={`compare-file-hint${invalid("file") ? ` ${errorId("file")}` : ""}`}
            />
            <p id="compare-file-hint" className="type-caption-sm text-muted-foreground">
              {labels.fileHint}
            </p>
            <FieldError state={state} field="file" labels={labels} />
          </div>

          {state.formError && (
            <p role="alert" aria-live="polite" className="type-caption-sm text-destructive">
              {labels.errors[state.formError]}
            </p>
          )}

          <div>
            <Button
              type="submit"
              size="lg"
              disabled={pending}
              data-testid="compare-submit"
              className="h-10 sm:h-9"
            >
              {pending ? labels.pending : labels.submit}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
