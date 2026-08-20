import { describe, expect, it } from "vitest";
import { braintrust } from "../src/core/sources/braintrust.ts";
import {
  fixtureHttp,
  resetHttpPort,
  setHttpPort,
} from "../src/core/sources/http-port.ts";

/** Shapes copied from live responses on 2026-08-18. */
const LIST_PAGE = {
  count: 2,
  next: null,
  results: [
    {
      id: 17694,
      title: "Lead AI & Data Platform Engineer - Marketplace (Remote)",
      employer: { name: "Stealth Company" },
      budget_minimum_usd: "60.00",
      budget_maximum_usd: "70.00",
      payment_type: "hourly",
      job_type: "freelance",
      created: "2026-08-18T10:00:00Z",
      locations: [
        { location: "Brazil", custom_location: null, country: "BR", location_type: "google" },
        { location: "North America", custom_location: "north_america", country: null, location_type: "custom" },
      ],
      main_skills: [{ name: "Python" }, { name: "LangChain" }],
      role: { name: "Engineering" },
    },
    {
      id: 17728,
      title: "Supervisor - Accounts Payable (Barcelona)",
      employer: { name: "Etsy" },
      budget_minimum_usd: null,
      budget_maximum_usd: null,
      payment_type: null,
      locations: [{ location: "Barcelona, ES", custom_location: null, country: "ES" }],
    },
  ],
};

const DETAILS: Record<number, unknown> = {
  17694: {
    id: 17694,
    description: "<p>Own RAG pipelines, evals and observability. 7+ years required.</p>",
    requirements: "<ul><li>Kubernetes</li><li>Terraform</li></ul>",
    experience_level: "senior",
    locations_strongly_required: false,
  },
  17728: { id: 17728, description: "<p>Accounts payable supervision.</p>" },
};

async function fetchAll() {
  setHttpPort(
    fixtureHttp({
      "https://app.usebraintrust.com/api/jobs/?limit=20": LIST_PAGE,
      "https://app.usebraintrust.com/api/jobs/17694/": DETAILS[17694]!,
      "https://app.usebraintrust.com/api/jobs/17728/": DETAILS[17728]!,
    }),
  );
  try {
    return await braintrust.fetchJobs({ kind: "braintrust", handle: "10", label: "Braintrust" });
  } finally {
    resetHttpPort();
  }
}

describe("braintrust adapter", () => {
  it("names Brazil explicitly when the country field says so", async () => {
    const { jobs } = await fetchAll();
    const text = jobs[0]?.descriptionText ?? "";
    // The scorer reads prose, so structured eligibility is turned into a
    // sentence its geo component can act on. This is what lifts a genuinely
    // eligible job above a vaguely "remote" one.
    expect(text).toContain("Open to Brazil");
  });

  it("does not claim Brazil for a job restricted elsewhere", async () => {
    const { jobs } = await fetchAll();
    const text = jobs[1]?.descriptionText ?? "";
    expect(text).not.toContain("Open to Brazil");
    expect(text).toContain("Eligible countries: ES");
  });

  it("fetches the body, which the list endpoint omits entirely", async () => {
    const { jobs } = await fetchAll();
    const text = jobs[0]?.descriptionText ?? "";
    // Without the per-job detail call every posting would score zero on
    // keywords — the same failure this project already hit with Lever.
    expect(text).toContain("RAG pipelines");
    expect(text).toContain("Kubernetes");
  });

  it("reads hourly budgets as USD per hour", async () => {
    const { jobs } = await fetchAll();
    const j = jobs[0];
    expect(j?.compMin).toBe(60);
    expect(j?.compMax).toBe(70);
    expect(j?.compCurrency).toBe("USD");
    expect(j?.compPeriod).toBe("hourly");
  });

  it("leaves compensation empty rather than inventing a currency", async () => {
    const { jobs } = await fetchAll();
    const j = jobs[1];
    expect(j?.compMin).toBeNull();
    expect(j?.compCurrency).toBeNull();
  });

  it("keeps every advertised location readable", async () => {
    const { jobs } = await fetchAll();
    expect(jobs[0]?.locationRaw).toContain("Brazil");
    expect(jobs[0]?.locationRaw).toContain("North America");
  });

  it("carries the skills and role into the scorable text", async () => {
    const { jobs } = await fetchAll();
    const text = jobs[0]?.descriptionText ?? "";
    expect(text).toContain("Python");
    expect(text).toContain("LangChain");
  });
});
