import { describe, expect, it } from "vitest";
import { decodeEncodedWords, parseEml } from "../src/core/mail/eml.ts";
import { classify, detectProvider } from "../src/core/mail/classify.ts";
import { canonicalJobUrl, extractAlertJobs } from "../src/core/mail/job-alert.ts";
import type { ParsedMail } from "../src/core/mail/eml.ts";

/* ------------------------------------------------------------- eml ------ */

describe("decodeEncodedWords", () => {
  it("decodes base64 encoded-words", () => {
    // LinkedIn encodes almost every subject this way; skipping it loses the
    // strongest classification signal.
    expect(decodeEncodedWords("=?UTF-8?B?IlNlbmlvciBBSSBBcmNoaXRlY3Qi?=")).toBe(
      '"Senior AI Architect"',
    );
  });

  it("decodes Q-encoded words, where underscore means space", () => {
    expect(decodeEncodedWords("=?UTF-8?Q?S=C3=A3o_Paulo?=")).toBe("São Paulo");
  });

  it("leaves plain text alone", () => {
    expect(decodeEncodedWords("Update on your application")).toBe("Update on your application");
  });
});

describe("parseEml", () => {
  const multipart = [
    "From: LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>",
    "Subject: =?UTF-8?B?NCBub3ZhcyB2YWdhcw==?=",
    "Date: Mon, 18 Aug 2026 09:15:00 -0300",
    "Message-ID: <abc-123@linkedin.com>",
    'Content-Type: multipart/alternative; boundary="B1"',
    "",
    "--B1",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    "plain version",
    "",
    "--B1",
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "<p>S=C3=A3o Paulo</p>",
    "",
    "--B1--",
  ].join("\n");

  it("extracts headers, including the message id without brackets", () => {
    const mail = parseEml(multipart);
    expect(mail.messageId).toBe("abc-123@linkedin.com");
    expect(mail.from.address).toBe("jobalerts-noreply@linkedin.com");
    expect(mail.from.name).toBe("LinkedIn Job Alerts");
  });

  it("decodes the subject", () => {
    expect(parseEml(multipart).subject).toBe("4 novas vagas");
  });

  it("separates the plain and html parts", () => {
    const mail = parseEml(multipart);
    expect(mail.text?.trim()).toBe("plain version");
    // Quoted-printable decoded, so the accent survives.
    expect(mail.html).toContain("São Paulo");
  });

  it("parses the date to ISO", () => {
    expect(parseEml(multipart).date).toBe("2026-08-18T12:15:00.000Z");
  });

  it("unfolds headers continued on an indented line", () => {
    const folded = ["Subject: a very long", "  subject line", "", "body"].join("\n");
    expect(parseEml(folded).subject).toBe("a very long subject line");
  });

  it("handles a single-part message with no boundary", () => {
    const simple = ["From: a@b.com", "Content-Type: text/plain", "", "hello"].join("\n");
    expect(parseEml(simple).text?.trim()).toBe("hello");
  });

  it("decodes base64 bodies", () => {
    const b64 = [
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from("rejected unfortunately").toString("base64"),
    ].join("\n");
    expect(parseEml(b64).text).toContain("unfortunately");
  });
});

/* --------------------------------------------------------- classify ----- */

function mailOf(subject: string, from = "no-reply@ashbyhq.com", name: string | null = null): ParsedMail {
  return {
    messageId: "x", from: { name, address: from }, subject,
    date: null, html: null, text: null, headers: {},
  };
}

describe("detectProvider", () => {
  it("recognises ATS and board domains", () => {
    expect(detectProvider("jobalerts-noreply@linkedin.com")).toBe("linkedin");
    expect(detectProvider("no-reply@ashbyhq.com")).toBe("ashby");
    expect(detectProvider("x@eu.greenhouse.io")).toBe("greenhouse");
    expect(detectProvider("someone@acme.com")).toBeNull();
  });
});

describe("classify", () => {
  it("identifies a job alert from the sender alone", () => {
    const r = classify(mailOf("4 novas vagas", "jobalerts-noreply@linkedin.com"), "");
    expect(r.kind).toBe("job_alert");
    expect(r.provider).toBe("linkedin");
  });

  it("identifies a rejection in English and Portuguese", () => {
    expect(classify(mailOf("Update"), "we have decided to move forward with other candidates").kind)
      .toBe("ats_rejection");
    expect(classify(mailOf("Atualização"), "infelizmente, não seguiremos com outros candidatos").kind)
      .toBe("ats_rejection");
  });

  it("does NOT call a job alert a rejection because a description says 'unfortunately'", () => {
    // The expensive error: a misfired rejection silently closes a live process.
    const r = classify(
      mailOf("New jobs for you", "jobalerts-noreply@linkedin.com"),
      "job alert · unfortunately we could not show all results",
    );
    expect(r.kind).toBe("job_alert");
  });

  it("does NOT treat an interview invite as a rejection", () => {
    const r = classify(
      mailOf("Next steps"),
      "We would like to schedule an interview with you.",
    );
    expect(r.kind).toBe("ats_interview");
  });

  it("identifies receipt, screening, interview and offer", () => {
    expect(classify(mailOf("x"), "we have received your application").kind).toBe("ats_received");
    expect(classify(mailOf("x"), "please complete the technical assessment").kind).toBe("ats_screening");
    expect(classify(mailOf("x"), "let's schedule your interview").kind).toBe("ats_interview");
    expect(classify(mailOf("x"), "we are pleased to offer you the position").kind).toBe("ats_offer");
  });

  it("identifies recruiter outreach", () => {
    const r = classify(
      mailOf("Opportunity", "jane@acme.com"),
      "I came across your profile and would you be open to a chat?",
    );
    expect(r.kind).toBe("recruiter_inbound");
  });

  it("falls back to unknown rather than guessing", () => {
    const r = classify(mailOf("Newsletter", "news@random.com"), "here is our weekly digest");
    expect(r.kind).toBe("unknown");
    expect(r.confidence).toBe(0);
  });

  it("raises confidence when the sender is a known ATS", () => {
    const known = classify(mailOf("x", "no-reply@ashbyhq.com"), "we have received your application");
    const unknown = classify(mailOf("x", "hi@random.com"), "we have received your application");
    expect(known.confidence).toBeGreaterThan(unknown.confidence);
  });
});

/* -------------------------------------------------------- job alert ----- */

describe("canonicalJobUrl", () => {
  it("strips tracking so the same job dedupes across two alerts", () => {
    expect(canonicalJobUrl("https://www.linkedin.com/comm/jobs/view/4231234567/?trackingId=abc"))
      .toBe("https://www.linkedin.com/jobs/view/4231234567");
  });
});

describe("extractAlertJobs", () => {
  const html = `
    <div>
      <a href="https://www.linkedin.com/comm/jobs/view/4231234567/?trackingId=abc">Senior AI Solutions Architect</a>
      <span>Nubank</span> · <span>São Paulo, Brazil (Remote)</span>
    </div>
    <div>
      <a href="https://www.linkedin.com/jobs/view/4239876543">Staff Platform Engineer</a>
      <span>Datadog</span> · <span>Remote - LATAM</span>
    </div>`;

  it("extracts title, company and location per opening", () => {
    const r = extractAlertJobs(html, null);
    expect(r.jobs).toHaveLength(2);
    expect(r.jobs[0]?.title).toBe("Senior AI Solutions Architect");
    expect(r.jobs[0]?.companyName).toBe("Nubank");
    expect(r.jobs[0]?.location).toContain("São Paulo");
  });

  it("keeps the job id and a canonical url", () => {
    const r = extractAlertJobs(html, null);
    expect(r.jobs[0]?.externalId).toBe("4231234567");
    expect(r.jobs[0]?.url).toBe("https://www.linkedin.com/jobs/view/4231234567");
  });

  it("does not duplicate a job linked twice in the same email", () => {
    const twice = html + html;
    expect(extractAlertJobs(twice, null).jobs).toHaveLength(2);
  });

  it("ignores anchors whose text is a call to action", () => {
    const cta = '<a href="https://www.linkedin.com/jobs/view/999">View job</a>';
    const r = extractAlertJobs(cta, null);
    expect(r.jobs).toHaveLength(0);
    // Silence would be the dangerous outcome: the user would see "no new jobs"
    // forever after a template change.
    expect(r.warnings.join(" ")).toContain("template");
  });

  it("says so when there is nothing to parse", () => {
    expect(extractAlertJobs("<p>hello</p>", null).warnings.join(" ")).toContain("Nenhum link");
    expect(extractAlertJobs(null, null).warnings.join(" ")).toContain("sem corpo");
  });

  it("falls back to the plain-text template", () => {
    const text = [
      "Nubank",
      "Senior AI Solutions Architect",
      "https://www.linkedin.com/jobs/view/4231234567",
    ].join("\n");
    const r = extractAlertJobs(null, text);
    expect(r.jobs[0]?.title).toBe("Senior AI Solutions Architect");
    expect(r.jobs[0]?.companyName).toBe("Nubank");
  });
});
