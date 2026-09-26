import { describe, expect, it } from "vitest";
import {
  applicationStatusLabel,
  applicationStatusLabels,
  applicationStatusOptions,
} from "../app/status.ts";
import { translator } from "../src/core/i18n/index.ts";
import {
  allowedTransitions,
  FUNNEL_STATUSES,
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
    untracked: "Fora do funil",
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
    untracked: "Out of the funnel",
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

  it("ordena as opções na ordem do funil, e não pelo rótulo", () => {
    // Em ordem alfabética, "Candidatura enviada" vinha antes de "Preparando" e
    // a hierarquia sumia do seletor (#316). "Fora do funil" nunca é opção.
    for (const locale of ["pt-BR", "en"] as const) {
      const current = translator(locale);
      const options = applicationStatusOptions(current.t);

      expect(options.map((option) => option.value)).toEqual([...FUNNEL_STATUSES]);
      expect(Object.fromEntries(options.map((option) => [option.value, option.label]))).toEqual(
        Object.fromEntries(FUNNEL_STATUSES.map((status) => [status, expectedLabels[locale][status]])),
      );
    }
  });

  it("oferece só os estágios alcançáveis quando recebe a lista do domínio", () => {
    const current = translator("pt-BR");
    const options = applicationStatusOptions(current.t, allowedTransitions("preparing"));

    // Em ordem de funil: voltar (A fazer, Pré-selecionada), o atual, avançar, arquivar.
    expect(options.map((option) => option.value)).toEqual(["backlog", "shortlisted", "preparing", "applied", "archived"]);
    expect(options.map((option) => option.value)).not.toContain("interviewing");
  });

  it("traduz todos os status para a mensagem de recusa, inclusive os não oferecidos", () => {
    for (const locale of ["pt-BR", "en"] as const) {
      const current = translator(locale);
      expect(applicationStatusLabels(current.t)).toEqual(expectedLabels[locale]);
    }
  });
});
