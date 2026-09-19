import { describe, expect, it } from "vitest";
import {
  applicationStatusLabel,
  applicationStatusLabels,
  applicationStatusOptions,
} from "../app/status.ts";
import { translator } from "../src/core/i18n/index.ts";
import {
  allowedTransitions,
  type ApplicationStatus,
} from "../src/contexts/pursuit/domain/application.ts";

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

  it("oferece só os estágios alcançáveis quando recebe a lista do domínio", () => {
    // De `preparing` o seletor listava `interviewing`; o domínio recusava, e o
    // rascunho ia junto. O que a tela oferece passa a sair de
    // `allowedTransitions`, então a recusa deixa de ser alcançável por clique.
    const current = translator("pt-BR");
    const options = applicationStatusOptions(current.t, "pt-BR", allowedTransitions("preparing"));

    // Ordenado pelo rótulo traduzido: "Candidatura enviada" antes de "Preparando".
    expect(options.map((option) => option.value)).toEqual(["applied", "preparing"]);
    expect(options.map((option) => option.value)).not.toContain("interviewing");
  });

  it("traduz todos os status para a mensagem de recusa, inclusive os não oferecidos", () => {
    for (const locale of ["pt-BR", "en"] as const) {
      const current = translator(locale);
      expect(applicationStatusLabels(current.t)).toEqual(expectedLabels[locale]);
    }
  });
});
