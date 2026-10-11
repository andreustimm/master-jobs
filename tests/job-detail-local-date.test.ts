// Suite: datas do detalhe da vaga no fuso de quem lê (#500)
// Invariant: o "visto em" e a data de cada linha do histórico de `/jobs/<id>`
//   saem pela ilha `LocalDate`, a mesma do Funil, e nunca por `slice(0, 10)`,
//   que devolve o dia em UTC e à noite em São Paulo diverge do Funil.
// Boundary IN: o fonte da página, que decide por onde cada data é desenhada.
// Boundary OUT: o dia mostrado no navegador (E2E `pipeline-filters`, E2E-500,
//   com `timezoneId`) e o formato do dia (`formatDay`, em
//   `pipeline-row-labels.test.ts`).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("app/jobs/[id]/page.tsx", "utf8");

describe("datas do detalhe da vaga", () => {
  it("o 'visto em' sai pela ilha LocalDate", () => {
    expect(page).toContain('import { LocalDate } from "../../local-date";');
    expect(page).toMatch(/<LocalDate iso=\{job\.firstSeenAt\} locale=\{locale\} testId="job-first-seen" \/>/);
  });

  it("cada linha do histórico sai pela ilha LocalDate", () => {
    expect(page).toMatch(
      /<LocalDate iso=\{event\.at\} locale=\{locale\} testId="application-timeline-event-date" \/>/,
    );
  });

  it("nenhuma das duas datas é cortada em UTC", () => {
    expect(page).not.toMatch(/firstSeenAt\.slice\(/);
    expect(page).not.toMatch(/event\.at\.slice\(/);
  });
});
