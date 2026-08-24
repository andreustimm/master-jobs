"use client";

const retryableTokens = new Set<string>();
const retryPreparations = new WeakMap<Error, () => void>();

export function prepareTransitionTestRetry(error: Error): void {
  retryPreparations.get(error)?.();
}

export function TransitionClientFailure({ token, title }: { token: string; title: string }) {
  if (!retryableTokens.has(token)) {
    const failure = new Error("TRANSITION_TEST_ROUTE_FAILURE");
    retryPreparations.set(failure, () => retryableTokens.add(token));
    throw failure;
  }

  return (
    <main data-testid="transition-test-destination" className="pt-10" tabIndex={-1}>
      <h1 className="type-display-md">{title}</h1>
    </main>
  );
}
