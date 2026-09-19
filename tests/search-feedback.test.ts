import { describe, expect, it } from "vitest";
import { FEEDBACK_KEYS, RERUN_CODES, RUN_OUTCOMES, TERM_CODES, TRACK_CODES } from "../app/searches/feedback.ts";
import type { FilterNotice } from "../app/filter-state.ts";
import { en } from "../src/core/i18n/en.ts";
import { ptBR } from "../src/core/i18n/pt-BR.ts";

function lookup(dictionary: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), dictionary);
}

const NOTICES: FilterNotice[] = [
  "term_too_short",
  "term_too_long",
  "term_invalid_char",
  "term_no_alnum",
  "pay_invalid",
  "track_unknown",
  "term_unknown",
  "cluster_unknown",
];

describe("action feedback in both languages", () => {
  it("UT-070 every result code and filter notice has a message in pt-BR and en", () => {
    const missing: string[] = [];
    for (const code of [...TERM_CODES, ...TRACK_CODES, ...RERUN_CODES, ...RUN_OUTCOMES]) {
      const key = FEEDBACK_KEYS[code];
      if (!key) {
        missing.push(`${code}: no key`);
        continue;
      }
      for (const [locale, dictionary] of [["pt-BR", ptBR], ["en", en]] as const) {
        if (typeof lookup(dictionary, key) !== "string") missing.push(`${locale}: ${key}`);
      }
    }
    for (const notice of NOTICES) {
      for (const [locale, dictionary] of [["pt-BR", ptBR], ["en", en]] as const) {
        if (typeof lookup(dictionary, `filterNotices.${notice}`) !== "string") missing.push(`${locale}: filterNotices.${notice}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
