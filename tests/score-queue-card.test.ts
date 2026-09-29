import { createElement, type HTMLAttributes } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ScoreQueueCard } from "../app/score-queue-card.tsx";
import { translator } from "../src/core/i18n/index.ts";

vi.mock("@/components/ui/badge", () => ({ Badge: ({ children }: HTMLAttributes<HTMLElement>) => createElement("span", null, children) }));
vi.mock("@/components/ui/card", () => {
  const part = (props: HTMLAttributes<HTMLElement>) => createElement("div", props);
  return { Card: part, CardContent: part, CardHeader: part, CardTitle: part };
});

function render(scored: number, lastError: string | null = null, locale: "en" | "pt-BR" = "en") {
  return renderToStaticMarkup(createElement(ScoreQueueCard, {
    snapshot: { pending: 0, scoring: 0, done: 1, failed: 0, scored, lastError },
    hasCv: true,
    ...translator(locale),
  }));
}

describe("resultado da repontuação sem promessa indevida", () => {
  it.each(["en", "pt-BR"] as const)("zero recalculadas tem motivo neutro em %s", (locale) => {
    const html = render(0, null, locale);
    expect(html).toContain('data-reason="noJobsUpdated"');
    expect(html).not.toContain(translator(locale).t("candidate.queueDoneLabel"));
  });

  it("mantém a recusa conhecida em vez de mascará-la como zero incremental", () => {
    expect(render(0, "curriculo-fraco")).toContain('data-reason="weakCv"');
    expect(render(0, "curriculo-fraco")).not.toContain('data-reason="noJobsUpdated"');
  });

  it("continua confirmando quantas vagas foram recalculadas", () => {
    expect(render(7)).toContain("Ranking refreshed for 7 jobs.");
    expect(render(7)).not.toContain('data-reason="noJobsUpdated"');
  });
});
