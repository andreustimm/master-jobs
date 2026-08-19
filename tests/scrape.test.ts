import { describe, expect, it } from "vitest";
import { cleanBullets, extractFields, extractPage, extractTitle, mainContent, stripHtml } from "../src/core/scrape/extract.ts";
import { isAllowed, parseRobots } from "../src/core/scrape/robots.ts";
import { retryable } from "../src/core/scrape/fetcher.ts";

describe("robots.txt", () => {
  it("lets the longest matching rule win", () => {
    // What the spec says, and the difference between crawling a permitted
    // subtree and skipping it.
    const r = parseRobots("User-agent: *\nDisallow: /private\nAllow: /private/jobs");
    expect(isAllowed(r, "/private/x")).toBe(false);
    expect(isAllowed(r, "/private/jobs/1")).toBe(true);
  });

  it("permits anything no rule mentions", () => {
    const r = parseRobots("User-agent: *\nDisallow: /admin");
    expect(isAllowed(r, "/careers/123")).toBe(true);
  });

  it("treats an empty Disallow as permission", () => {
    // `Disallow:` with no value is the documented way to allow everything.
    const r = parseRobots("User-agent: *\nDisallow:");
    expect(isAllowed(r, "/anything")).toBe(true);
  });

  it("prefers a group naming us over the wildcard", () => {
    const r = parseRobots(
      "User-agent: *\nDisallow: /\n\nUser-agent: jho\nDisallow: /admin",
    );
    expect(isAllowed(r, "/jobs")).toBe(true);
    expect(isAllowed(r, "/admin")).toBe(false);
  });

  it("shares one rule set across consecutive user-agent lines", () => {
    const r = parseRobots("User-agent: googlebot\nUser-agent: *\nDisallow: /x");
    expect(isAllowed(r, "/x")).toBe(false);
  });

  it("reads crawl-delay in milliseconds", () => {
    expect(parseRobots("User-agent: *\nCrawl-delay: 2.5").crawlDelayMs).toBe(2500);
  });

  it("ignores comments and blank lines", () => {
    const r = parseRobots("# comment\n\nUser-agent: *\nDisallow: /x # trailing");
    expect(isAllowed(r, "/x")).toBe(false);
  });

  it("expands the two wildcards robots.txt defines", () => {
    const r = parseRobots("User-agent: *\nDisallow: /*.pdf$");
    expect(isAllowed(r, "/files/report.pdf")).toBe(false);
    expect(isAllowed(r, "/files/report.html")).toBe(true);
  });

  it("allows everything when the file is empty", () => {
    expect(isAllowed(parseRobots(""), "/anything")).toBe(true);
  });
});

describe("retryable", () => {
  it("does not retry a posting that is gone or a bot block", () => {
    // Retrying a 404 four times only annoys the server and delays the queue.
    expect(retryable(404)).toBe(false);
    expect(retryable(410)).toBe(false);
    expect(retryable(403)).toBe(false);
  });

  it("retries rate limits and server errors", () => {
    expect(retryable(429)).toBe(true);
    expect(retryable(500)).toBe(true);
    expect(retryable(503)).toBe(true);
  });
});

describe("stripHtml", () => {
  it("drops script and style content entirely", () => {
    const out = stripHtml("<p>real</p><script>var x=1</script><style>.a{}</style>");
    expect(out).toContain("real");
    expect(out).not.toContain("var x");
    expect(out).not.toContain(".a{");
  });

  it("keeps block structure as newlines", () => {
    expect(stripHtml("<p>um</p><p>dois</p>")).toBe("um\ndois");
  });

  it("turns list items into readable bullets", () => {
    expect(stripHtml("<ul><li>um</li><li>dois</li></ul>")).toContain("- um");
  });

  it("decodes entities, including accented ones", () => {
    expect(stripHtml("<p>caf&eacute; &amp; a&ccedil;&atilde;o &#8212; fim</p>")).toContain("café &");
  });
});

describe("mainContent", () => {
  const body = "Sobre esta vaga. ".repeat(40);

  it("narrows to the posting container", () => {
    // A careers page is mostly navigation and footer; feeding all of it to the
    // scorer would dilute every keyword frequency.
    const html = `<nav>${"menu ".repeat(50)}</nav><div class="job-description">${body}</div><footer>rodape</footer>`;
    expect(stripHtml(mainContent(html))).not.toContain("menu");
  });

  it("falls back to the whole page when the container is too thin", () => {
    // A container holding two words is a mis-detection, not the description.
    const html = `<div class="job-description">curto</div><main>${body}</main>`;
    expect(stripHtml(mainContent(html)).length).toBeGreaterThan(400);
  });
});

describe("extractTitle", () => {
  it("prefers the h1", () => {
    expect(extractTitle("<title>X | Board</title><h1>Staff Engineer</h1>")).toBe("Staff Engineer");
  });

  it("falls back to the first segment of the document title", () => {
    expect(extractTitle("<title>Staff Engineer — Acme | Board</title>")).toBe("Staff Engineer");
  });

  it("returns null when there is nothing usable", () => {
    expect(extractTitle("<p>nada</p>")).toBeNull();
  });
});

describe("extractFields", () => {
  it("recovers the fields a human scans for first", () => {
    const f = extractFields(
      "This is a Full-time, fully remote Senior role paying $150,000 - $200,000 per year.",
    );
    expect(f.employmentType).toMatch(/full[- ]time/i);
    expect(f.workplace).toMatch(/remote/i);
    expect(f.seniority).toMatch(/senior/i);
    expect(f.salary).toContain("150,000");
  });

  it("returns nothing rather than guessing", () => {
    expect(extractFields("Uma frase qualquer sem sinal nenhum.")).toEqual({});
  });
});

describe("cleanBullets", () => {
  it("drops navigation masquerading as a list", () => {
    // Every careers page wraps its menu in <li>, so a naive scrape returns
    // "Home" and "Privacy Policy" as if they were requirements.
    const out = cleanBullets([
      "Home",
      "Privacy Policy",
      "Careers",
      "Five or more years building distributed systems in production",
    ]);
    expect(out).toEqual(["Five or more years building distributed systems in production"]);
  });

  it("deduplicates", () => {
    const line = "Experience with Kubernetes and container orchestration";
    expect(cleanBullets([line, line, line])).toHaveLength(1);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 80 }, (_, i) => `Requisito número ${i} com texto suficiente aqui`);
    expect(cleanBullets(many).length).toBeLessThanOrEqual(20);
  });
});

describe("extractPage", () => {
  it("returns null text rather than a fragment", () => {
    // A page that yields three words is a failure, and calling it a description
    // would silently poison the scorer.
    expect(extractPage("<p>oi</p>").text).toBeNull();
  });

  it("pulls title, fields and requirements from a realistic posting", () => {
    const html = `<html><head><title>Staff AI Engineer — Acme</title></head><body>
      <div class="job-description">
        <h1>Staff AI Engineer</h1>
        <p>${"We build agent infrastructure for enterprises. ".repeat(20)}</p>
        <p>Full-time, fully remote. Senior level. $180,000 - $220,000 per year.</p>
        <ul>
          <li>Eight or more years designing distributed backend systems</li>
          <li>Hands-on experience with Kubernetes and observability tooling</li>
          <li>Home</li>
        </ul>
      </div></body></html>`;
    const r = extractPage(html);
    expect(r.title).toBe("Staff AI Engineer");
    expect(r.text!.length).toBeGreaterThan(400);
    expect(r.fields.salary).toContain("180,000");
    expect(r.requirements).toHaveLength(2);
    expect(r.requirements.join(" ")).not.toContain("Home");
  });
});
