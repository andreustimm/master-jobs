"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

/**
 * A filter chip with an explanation on hover.
 *
 * This file exists — and carries `"use client"` — for one reason. Base UI's
 * tooltip works by cloning the element given to `render` and injecting the
 * pointer handlers that open the popup. An element created inside a Server
 * Component and serialised across the boundary cannot receive those handlers,
 * so the trigger rendered, looked right, and did nothing on hover.
 *
 * `app/filters.tsx` stays a Server Component: only this leaf needs the client.
 */

const chipClass = (active: boolean) =>
  cn(
    buttonVariants({ variant: active ? "default" : "outline", size: "sm" }),
    "h-7 px-2.5 type-micro font-normal",
    active && "font-medium",
  );

export function Toggle({
  href,
  active,
  hint,
  children,
}: {
  href: string;
  active: boolean;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a href={href} className={chipClass(active)}>
            {children}
          </a>
        }
      />
      <TooltipContent side="bottom">{hint}</TooltipContent>
    </Tooltip>
  );
}
