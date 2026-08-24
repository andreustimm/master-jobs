"use client";

import RouteError from "../error";
import { prepareTransitionTestRetry } from "./client-failure";

export default function TransitionTestError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      error={error}
      reset={() => {
        prepareTransitionTestRetry(error);
        reset();
      }}
    />
  );
}
