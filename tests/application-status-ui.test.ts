import { describe, expect, it } from "vitest";
import { applicationStatusLabel, applicationStatusOptions } from "../app/status.ts";
import { translator } from "../src/core/i18n/index.ts";
import type { ApplicationStatus } from "../src/contexts/pursuit/domain/application.ts";

const expectedLabels = {
  "pt-BR": {
    backlog: "A fazer",
    shortlisted: "Pré-selecionada",
    preparing: "Preparando",
    applied: "Candidatura enviada",
    screening: "Triagem",
    interviewing: "Em entrevista",
    offer: "Oferta",
    rejected: "Rejeitada",
    withdrawn: "Retirada",
    archived: "Arquivada",
  },
  en: {
    backlog: "Backlog",
    shortlisted: "Shortlisted",
    preparing: "Preparing",
    applied: "Applied",
    screening: "Screening",
    interviewing: "Interviewing",
    offer: "Offer",
    rejected: "Rejected",
    withdrawn: "Withdrawn",
    archived: "Archived",
  },
} as const;

describe("status de candidatura na interface", () => {
  it("traduz cada status para o idioma selecionado", () => {
    for (const locale of ["pt-BR", "en"] as const) {
      const current = translator(locale);
      for (const [status, label] of Object.entries(expectedLabels[locale])) {
        expect(applicationStatusLabel(status as ApplicationStatus, current.t)).toBe(label);
      }
    }
  });

  it("ordena as opções alfabeticamente pelo rótulo traduzido", () => {
    for (const locale of ["pt-BR", "en"] as const) {
      const current = translator(locale);
      const options = applicationStatusOptions(current.t, locale);
      const labels = options.map((option) => option.label);

      expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, locale)));
      expect(labels).not.toContain("shortlisted");
      expect(options).toHaveLength(10);
      expect(Object.fromEntries(options.map((option) => [option.value, option.label]))).toEqual(expectedLabels[locale]);
    }
  });
});
