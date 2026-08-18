import { describe, expect, it } from "vitest";
import { CONTACT_CATEGORIES } from "../src/core/contacts.ts";
import { slugifyCompany } from "../src/core/ingest/normalize.ts";

describe("contact categories", () => {
  it("includes the one that matters most", () => {
    // A former colleague or client is the strongest referral surface there is.
    expect(CONTACT_CATEGORIES).toContain("former");
  });

  it("covers the audit's three target-account groups", () => {
    // §2.2 of the positioning audit: 10 recruiters, 10 AI/platform leaders,
    // 10 Staff/Principal peers.
    for (const c of ["recruiter", "ai-leader", "peer"]) {
      expect(CONTACT_CATEGORIES).toContain(c);
    }
  });
});

describe("company matching for referrals", () => {
  it("matches a contact's company to a posting despite legal suffixes", () => {
    // Both sides go through the same normalisation the deduper uses, so a
    // contact at "Nubank" is found on a posting from "Nubank Ltd".
    expect(slugifyCompany("Nubank")).toBe(slugifyCompany("Nubank Ltd"));
    expect(slugifyCompany("Red Ventures Inc.")).toBe(slugifyCompany("Red Ventures"));
  });

  it("keeps genuinely different companies apart", () => {
    expect(slugifyCompany("Scope3")).not.toBe(slugifyCompany("Scope AI"));
    expect(slugifyCompany("ADT Solar")).not.toBe(slugifyCompany("ADT Security"));
  });

  it("survives accents, which Brazilian employers have", () => {
    expect(slugifyCompany("Consulta Já")).toBe("consulta-ja");
  });
});
