/**
 * URL semantics shared by every job consumer.
 *
 * Synthetic schemes are stable database identities, not navigation targets.
 * Keeping this decision here prevents a new UI, export or verifier from
 * accidentally treating `manual://` as a public employer link.
 */
export function isPublicJobUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function publicPostingUrl(input: {
  url: string | null | undefined;
}): string | null {
  return isPublicJobUrl(input.url) ? input.url : null;
}

export function publicApplyUrl(input: {
  url: string | null | undefined;
  applyUrl?: string | null;
}): string | null {
  if (isPublicJobUrl(input.applyUrl)) return input.applyUrl;
  return publicPostingUrl(input);
}
