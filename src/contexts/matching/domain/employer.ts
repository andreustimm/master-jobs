// O adapter careers usa o rótulo configurado como empregador real.
export const DIRECT_EMPLOYER_SOURCE_KIND = "careers";

export function hasNamedEmployer(sourceId: string, companyName: string, sourceLabel: string | null): boolean {
  return sourceId.split(":", 1)[0] === DIRECT_EMPLOYER_SOURCE_KIND
    || companyName.trim().toLowerCase() !== (sourceLabel ?? "").trim().toLowerCase();
}
