import type { Route } from "next";
import { ChevronDownIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TransitionGetForm } from "./transition-get-form";
import { TransitionLink } from "./transition-link";

/**
 * Multiple choice as a closed list of checkboxes inside a GET form — the
 * sources of `/jobs` and the companies and channels of `/pipeline`.
 *
 * A native `<details>` is the whole disclosure: no portal, so the checkboxes
 * stay inside the GET form and one Apply carries the lot — choosing three
 * options with chips meant three round trips.
 *
 * The open list sits IN FLOW and pushes the rows below it. A floating panel is
 * the usual shape, and it was cut off at every width: `Card` clips its content,
 * and letting this one card not clip only moves the problem to the next
 * ancestor with a scroll area. In flow, nothing can clip it, at any width.
 *
 * Apply lives inside the panel, next to the choosing. Below a 288px list it
 * would be off screen exactly when it is needed.
 */
export function CheckboxPicker({
  action,
  carry,
  name,
  options,
  chosen,
  summary,
  clearHref,
  applyLabel,
  clearLabel,
  testId,
  optionTestId,
  userContent = false,
}: {
  action: Route;
  /** The rest of the URL state, carried as hidden inputs. */
  carry: ReadonlyArray<readonly [string, string]>;
  name: string;
  options: readonly string[];
  chosen: ReadonlySet<string>;
  summary: string;
  clearHref: Route;
  applyLabel: string;
  clearLabel: string;
  /** Prefix of the form, combo, summary, submit and clear test ids. */
  testId: string;
  optionTestId: (value: string) => string;
  /** Options typed by a person (a company, a channel), not by the product. */
  userContent?: boolean;
}) {
  return (
    <TransitionGetForm action={action} className="flex flex-wrap items-start gap-2" data-testid={`${testId}-form`}>
      {carry.map(([key, value]) => (
        <input key={`${key}=${value}`} type="hidden" name={key} value={value} />
      ))}
      <details className="group w-56" data-testid={`${testId}-combo`}>
        <summary
          className="flex h-8 cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-input px-2.5 type-body-md text-foreground select-none [&::-webkit-details-marker]:hidden"
          data-testid={`${testId}-summary`}
        >
          {summary}
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-1 rounded-lg bg-card ring-1 ring-foreground/10">
          <div className="max-h-64 overflow-y-auto p-1">
            {options.map((option) => (
              <label
                key={option}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 type-body-md hover:bg-muted",
                  userContent ? "wrap-anywhere" : "font-mono",
                )}
              >
                <input
                  type="checkbox"
                  name={name}
                  value={option}
                  defaultChecked={chosen.has(option)}
                  className="size-4 shrink-0 accent-primary"
                  data-testid={optionTestId(option)}
                />
                {userContent ? <span data-user-content>{option}</span> : option}
              </label>
            ))}
          </div>
          <div className="border-t border-hairline p-2">
            <Button type="submit" variant="outline" size="sm" data-testid={`${testId}-submit`}>
              {applyLabel}
            </Button>
          </div>
        </div>
      </details>
      {chosen.size > 0 && (
        <TransitionLink
          href={clearHref}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 px-2.5 type-micro font-normal")}
          data-testid={`${testId}-clear`}
        >
          {clearLabel}
        </TransitionLink>
      )}
    </TransitionGetForm>
  );
}
