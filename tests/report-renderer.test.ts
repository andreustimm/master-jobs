import { describe, expect, it } from "vitest";
import { renderBoardMarkdown, type ReportRow } from "../src/core/report/markdown.ts";

const row: ReportRow = {
  fit: 81,
  cluster: "strong",
  companyName: "Acme | Labs",
  title: "Staff Engineer",
  locationRaw: "Remote",
  blockers: [],
  url: "https://jobs.example.test/staff",
  applyUrl: "https://apply.example.test/staff",
  status: null,
  appliedAt: null,
};

describe("pure report renderer", () => {
  it("renders a deterministic DTO without filesystem access", () => {
    const first = renderBoardMarkdown({
      rows: [row],
      counts: { applied: 2 },
      today: "2026-08-20",
      minFit: 60,
    });
    const second = renderBoardMarkdown({
      rows: [row],
      counts: { applied: 2 },
      today: "2026-08-20",
      minFit: 60,
    });

    expect(first).toBe(second);
    expect(first).toContain("Acme \\| Labs");
    expect(first).toContain("[aplicar](https://apply.example.test/staff)");
  });
});
