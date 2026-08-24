"use client";

const retryableTokens = new Set<string>();
const retryPreparations = new WeakMap<object, () => void>();
let lastRetryPreparation: (() => void) | null = null;

export function prepareTransitionTestRetry(error: unknown): void {
  const preparation =
    typeof error === "object" && error !== null
      ? retryPreparations.get(error) ?? lastRetryPreparation
      : lastRetryPreparation;
  lastRetryPreparation = null;
  preparation?.();
}

export function TransitionClientFailure({ token, title }: { token: string; title: string }) {
  if (!retryableTokens.has(token)) {
    const prepare = () => retryableTokens.add(token);
    lastRetryPreparation = prepare;

    // The E2E-only route must prove that the public boundary does not depend
    // on Error.message, digest, prototype, or even Error-ness. React accepts
    // arbitrary thrown values; this null-prototype value is deliberately not
    // parseable as a framework or application error.
    if (token.startsWith("unparseable-")) {
      const failure = Object.create(null) as object;
      retryPreparations.set(failure, prepare);
      throw failure;
    }

    const failure = new Error("TRANSITION_TEST_ROUTE_FAILURE");
    retryPreparations.set(failure, prepare);
    throw failure;
  }

  return (
    <main data-testid="transition-test-destination" className="pt-10" tabIndex={-1}>
      <h1 className="type-display-md">{title}</h1>
    </main>
  );
}
