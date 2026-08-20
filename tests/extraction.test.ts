import { describe, expect, it } from "vitest";
import { firstNonEmpty, htmlToText } from "../src/core/sources/http.ts";
import {
  fixtureHttp,
  resetHttpPort,
  setHttpPort,
} from "../src/core/sources/http-port.ts";
import { lever } from "../src/core/sources/ats.ts";

describe("firstNonEmpty", () => {
  it("skips empty strings, which `??` does not", () => {
    // The bug in one line. Typed as `string | undefined` on purpose: that is
    // the shape an API field has, and it is why the compiler stayed silent.
    // With a literal "" TypeScript raises TS2869 — with an optional field it
    // cannot know the value is "" and the trap compiles clean.
    const apiField: string | undefined = "";
    expect(apiField ?? "fallback").toBe("");
    expect(firstNonEmpty(apiField, "fallback")).toBe("fallback");
  });

  it("skips whitespace-only values", () => {
    expect(firstNonEmpty("   ", "\n\n", "real")).toBe("real");
  });

  it("skips null and undefined", () => {
    expect(firstNonEmpty(null, undefined, "real")).toBe("real");
  });

  it("returns the first genuinely present value", () => {
    expect(firstNonEmpty("first", "second")).toBe("first");
  });

  it("returns null when nothing is present", () => {
    expect(firstNonEmpty("", null, undefined, "  ")).toBeNull();
  });
});

describe("htmlToText", () => {
  it("returns null — not an empty string — when stripping leaves nothing", () => {
    // Returning "" here would defeat every ?? downstream, which is how the
    // Lever descriptions were lost in the first place.
    expect(htmlToText("<div></div>")).toBeNull();
    expect(htmlToText("   ")).toBeNull();
    expect(htmlToText(null)).toBeNull();
  });

  it("extracts readable text from markup", () => {
    const text = htmlToText("<div><p>Design <strong>multi-agent</strong> systems</p></div>");
    expect(text).toContain("multi-agent");
    expect(text).not.toContain("<");
  });

  it("turns list items into lines", () => {
    const text = htmlToText("<ul><li>RAG</li><li>evals</li></ul>");
    expect(text).toContain("RAG");
    expect(text).toContain("evals");
  });
});

describe("lever adapter description extraction", () => {
  /** Shape verified against a real jobgether posting in data/jobs.db. */
  const posting = {
    id: "abc",
    text: "Senior AI Platform Engineer",
    hostedUrl: "https://jobs.lever.co/jobgether/abc",
    applyUrl: "https://jobs.lever.co/jobgether/abc/apply",
    // Lever leaves unused fields as EMPTY STRINGS, not null.
    descriptionPlain: "",
    descriptionBodyPlain: "",
    openingPlain: "",
    description: "<div><p>Build RAG pipelines and multi-agent systems.</p></div>",
    lists: [
      {
        text: "Accountabilities:",
        content: "<ul><li>Own evals and guardrails</li><li>Design distributed systems</li></ul>",
      },
    ],
    additionalPlain: "How Jobgether works: we use an AI-powered matching process...",
    categories: { commitment: "Full-time", allLocations: ["Brazil"] },
    workplaceType: "remote",
    createdAt: 1786497735996,
  };

  async function fetchOne() {
    setHttpPort(
      fixtureHttp({
        "https://api.lever.co/v0/postings/jobgether?mode=json": [posting],
      }),
    );
    try {
      return await lever.fetchJobs({ kind: "lever", handle: "jobgether", label: "Jobgether" });
    } finally {
      resetHttpPort();
    }
  }

  it("recovers the description even when descriptionPlain is empty", async () => {
    const { jobs } = await fetchOne();
    const text = jobs[0]?.descriptionText ?? "";
    expect(text).toContain("RAG pipelines");
  });

  it("includes the lists, where the requirements actually live", async () => {
    const { jobs } = await fetchOne();
    const text = jobs[0]?.descriptionText ?? "";
    // Without this the keyword scorer misses evals, guardrails and
    // distributed systems — all high-weight profile terms.
    expect(text).toContain("evals and guardrails");
    expect(text).toContain("distributed systems");
    expect(text).toContain("Accountabilities");
  });

  it("excludes the board's boilerplate", async () => {
    const { jobs } = await fetchOne();
    const text = jobs[0]?.descriptionText ?? "";
    // `additional` is identical on every Jobgether posting; including it would
    // add the same noise to 4.600 jobs and distort keyword scoring.
    expect(text).not.toContain("How Jobgether works");
  });

  it("converts Lever's epoch milliseconds to ISO", async () => {
    const { jobs } = await fetchOne();
    expect(jobs[0]?.postedAt).toBe(new Date(1786497735996).toISOString());
  });
});
