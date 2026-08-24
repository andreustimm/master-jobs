"use client";

import Form, { type FormProps } from "next/form";
import type { FormEvent, ReactElement } from "react";
import { transitionStore } from "../src/core/pwa/transition-store.ts";

const TypedForm = Form as <RouteType>(props: FormProps<RouteType>) => ReactElement;

type GetAction<RouteType> = Exclude<FormProps<RouteType>["action"], (formData: FormData) => void>;

export type TransitionGetFormProps<RouteType> = Omit<FormProps<RouteType>, "action"> & {
  action: GetAction<RouteType>;
};

function submitterAttribute(submitter: HTMLElement | null, name: string): string | null {
  return submitter?.getAttribute(name) ?? null;
}

type SubmissionIntent = {
  action: string;
  baseHref: string;
  form: HTMLFormElement;
};

function getSubmissionIntent(action: string, event: FormEvent<HTMLFormElement>): SubmissionIntent | null {
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

  return {
    action: submitterAttribute(submitter, "formaction") ?? action,
    baseHref: window.location.href,
    form: event.currentTarget,
  };
}

function getDestination(intent: SubmissionIntent, formData: FormData): string | null {
  try {
    const destination = new URL(intent.action, intent.baseHref);
    destination.search = "";
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
    <TypedForm<RouteType>
      {...props}
      action={action}
      onSubmit={(event) => {
        onSubmit?.(event);
        if (event.defaultPrevented) return;
        const intent = getSubmissionIntent(action, event);
        if (intent === null) return;

        const onFormData = (formDataEvent: FormDataEvent) => {
          const destination = getDestination(intent, formDataEvent.formData);
          if (destination !== null) transitionStore.begin(destination);
        };
        intent.form.addEventListener("formdata", onFormData, { once: true });
        queueMicrotask(() => intent.form.removeEventListener("formdata", onFormData));
      }}
    />
  );
}
