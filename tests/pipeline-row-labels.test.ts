// Suite: rótulos da linha do Funil (#494)
// Invariant: a data de "aplicado em" é o dia no fuso de quem lê, e o canal
//   documentado aparece no idioma da tela; canal desconhecido fica como veio.
// Boundary IN: `formatDay` e `channelLabel`, puros.
// Boundary OUT: a ilha `LocalDate` no navegador (E2E `pipeline-filters`).
import { describe, expect, it } from "vitest";
import { channelLabel, channelOptionLabel } from "../app/pipeline/channel.ts";
import { formatDay } from "../src/core/i18n/date.ts";
import { translator } from "../src/core/i18n/index.ts";

describe("formatDay", () => {
  it("23:45 em São Paulo é o mesmo dia lá, e o dia seguinte em UTC", () => {
    const iso = "2026-10-07T02:45:00.000Z";
    expect(formatDay(iso, "pt-BR", "America/Sao_Paulo")).toBe(formatDay("2026-10-06T12:00:00.000Z", "pt-BR", "UTC"));
    expect(formatDay(iso, "pt-BR", "UTC")).toBe(formatDay("2026-10-07T12:00:00.000Z", "pt-BR", "UTC"));
  });

  it("data ilegível volta como veio", () => {
    expect(formatDay("ontem", "pt-BR")).toBe("ontem");
  });
});

describe("channelLabel", () => {
  it("canal documentado sai no idioma da tela, sem diferença de caixa", () => {
    const pt = translator("pt-BR").t;
    const en = translator("en").t;
    expect(channelLabel(pt, "referral")).toBe("indicação");
    expect(channelLabel(pt, "DIRECT")).toBe("direto");
    expect(channelLabel(en, "agency")).toBe("agency");
  });

  it("canal fora da lista não tem rótulo: aparece como a pessoa gravou", () => {
    expect(channelLabel(translator("pt-BR").t, "evento da comunidade")).toBeUndefined();
  });
});

describe("channelOptionLabel", () => {
  const pt = translator("pt-BR").t;

  it("valor sem gêmeo de caixa sai traduzido", () => {
    const label = channelOptionLabel(pt, ["referral", "direct", "evento"]);
    expect(label("referral")).toBe("indicação");
    expect(label("direct")).toBe("direto");
    expect(label("evento")).toBeUndefined();
  });

  it("valores que dariam o mesmo rótulo mostram o valor cru", () => {
    const label = channelOptionLabel(pt, ["Referral", "referral", "direct"]);
    expect(label("Referral")).toBeUndefined();
    expect(label("referral")).toBeUndefined();
    expect(label("direct")).toBe("direto");
  });
});
