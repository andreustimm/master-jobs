"use client";

const retryableTokens = new Set<string>();
const scheduledTokens = new Set<string>();

export function TransitionClientFailure({ token, title }: { token: string; title: string }) {
  if (!retryableTokens.has(token)) {
    if (!scheduledTokens.has(token)) {
      scheduledTokens.add(token);
      queueMicrotask(() => retryableTokens.add(token));
    }
    throw new Error("TRANSITION_TEST_ROUTE_FAILURE");
  }

  return (
    <main data-testid="transition-test-destination" className="pt-10" tabIndex={-1}>
      <h1 className="type-display-md">{title}</h1>
    </main>
  );
}
