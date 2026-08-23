import { cn } from "@/lib/utils";

/** Geometria compartilhada pelas modais administrativas. */
export const USER_MODAL_BOX = cn(
  "m-auto max-h-[85dvh] w-[min(92vw,520px)] overflow-y-auto rounded-xl bg-card p-0 text-card-foreground",
  "ring-1 ring-foreground/10 backdrop:bg-foreground/40",
);
