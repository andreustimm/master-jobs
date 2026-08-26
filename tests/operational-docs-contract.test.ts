import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configuredMailer } from "../src/contexts/auth/infra/resend-mailer.ts";

const read = (path: string) => readFileSync(path, "utf8");

function fakeEnv(values: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...values };
}

function exampleVariables(contents: string): Set<string> {
  return new Set(
    contents
      .split("\n")
      .map((line) => /^\s*#?\s*([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
      .filter((name): name is string => name !== undefined),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("operational environment contract", () => {
  it("UT-001: .env.example names the canonical Resend variables only", () => {
    const variables = exampleVariables(read(".env.example"));

    expect(variables).toContain("RESEND_API_KEY");
    expect(variables).toContain("RESEND_FROM");
    expect(variables).not.toContain("RESEND_FROM_EMAIL");
  });

  it("UT-002: only the canonical sender name configures Resend", () => {
    expect(
      configuredMailer(fakeEnv({ RESEND_API_KEY: "re_fake", RESEND_FROM: "mail@example.test" })).name,
    ).toBe("resend");
    expect(
      configuredMailer(fakeEnv({
        RESEND_API_KEY: "re_fake",
        RESEND_FROM_EMAIL: "mail@example.test",
      })).name,
    ).toBe("console");
  });

  it("UT-003: absent or blank values select console without printing the key", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    expect(configuredMailer(fakeEnv()).name).toBe("console");
    expect(
      configuredMailer(fakeEnv({ RESEND_API_KEY: "re_fake_secret", RESEND_FROM: "  " })).name,
    ).toBe("console");
    expect(log).not.toHaveBeenCalled();
  });

  it("IT-001: the deployment contract agrees with the tracked example", () => {
    const example = read(".env.example");
    const deploy = read("docs/engineering/deploy.md");

    expect(example).toContain("RESEND_API_KEY=");
    expect(example).toContain("RESEND_FROM=");
    expect(deploy).toContain("`RESEND_API_KEY`");
    expect(deploy).toContain("`RESEND_FROM`");
    expect(`${example}\n${deploy}`).not.toContain("RESEND_FROM_EMAIL");
  });
});
