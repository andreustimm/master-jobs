"use client";

import Form, { type FormProps } from "next/form";
import type { FormEvent } from "react";
import { transitionStore } from "../src/core/pwa/transition-store.ts";

type GetAction<RouteType> = Exclude<FormProps<RouteType>["action"], (formData: FormData) => void>;

export type TransitionGetFormProps<RouteType> = Omit<FormProps<RouteType>, "action"> & {
  action: GetAction<RouteType>;
};

function submitterAttribute(submitter: HTMLElement | null, name: string): string | null {
  return submitter?.getAttribute(name) ?? null;
}

function getDestination(action: string, event: FormEvent<HTMLFormElement>): string | null {
  if (typeof window === "undefined") return null;

  const nativeEvent = event.nativeEvent as SubmitEvent;
  const submitter = nativeEvent.submitter instanceof HTMLElement ? nativeEvent.submitter : null;
  const target = submitterAttribute(submitter, "formtarget");
  const method = submitterAttribute(submitter, "formmethod");
  const encType = submitterAttribute(submitter, "formenctype");
  if ((target !== null && target !== "_self") || (method !== null && method !== "get")) {
    return null;
  }
  if (encType !== null && encType !== "application/x-www-form-urlencoded") return null;

  const candidate = submitterAttribute(submitter, "formaction") ?? action;
  try {
    const destination = new URL(candidate, window.location.href);
    destination.search = "";
    const formData = new FormData(event.currentTarget);
    for (const [key, value] of formData) {
      destination.searchParams.append(key, typeof value === "string" ? value : value.name);
    }
    return destination.href;
  } catch {
    return null;
  }
}

/** Stable URL-backed GET boundary. Server Action forms must not use this component. */
export function TransitionGetForm<RouteType>({
  action,
  onSubmit,
  ...props
}: TransitionGetFormProps<RouteType>) {
  return (
    <Form<RouteType>
      {...props}
      action={action}
      onSubmit={(event) => {
        onSubmit?.(event);
        if (event.defaultPrevented) return;
        const destination = getDestination(action, event);
        if (destination !== null) transitionStore.begin(destination);
      }}
    />
  );
}
