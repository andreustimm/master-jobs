import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUERY,
  buildAuthUrl,
  createPkce,
  credentialsFromEnv,
} from "../src/core/mail/gmail.ts";

const CREDS = { clientId: "id.apps.googleusercontent.com", clientSecret: "secret" };

describe("credentialsFromEnv", () => {
  it("returns null rather than half a credential", () => {
    expect(credentialsFromEnv({})).toBeNull();
    expect(credentialsFromEnv({ GMAIL_CLIENT_ID: "a" })).toBeNull();
    expect(credentialsFromEnv({ GMAIL_CLIENT_SECRET: "b" })).toBeNull();
  });

  it("reads both halves", () => {
    expect(credentialsFromEnv({ GMAIL_CLIENT_ID: "a", GMAIL_CLIENT_SECRET: "b" })).toEqual({
      clientId: "a",
      clientSecret: "b",
    });
  });
});

describe("createPkce", () => {
  it("derives the challenge from the verifier with S256", async () => {
    const { createHash } = await import("node:crypto");
    const { verifier, challenge } = createPkce();
    const expected = createHash("sha256")
      .update(verifier)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(challenge).toBe(expected);
  });

  it("is base64url — no character needing escaping in a URL", () => {
    for (let i = 0; i < 20; i++) {
      const { verifier, challenge } = createPkce();
      expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("never repeats", () => {
    const seen = new Set(Array.from({ length: 50 }, () => createPkce().verifier));
    expect(seen.size).toBe(50);
  });
});

describe("buildAuthUrl", () => {
  const url = new URL(buildAuthUrl(CREDS, "http://127.0.0.1:5051/callback", "chal", "st"));

  it("asks only for read access", () => {
    // The structural guarantee behind ADR 0008: mail is a sourcing signal, and
    // a read-only token cannot send, delete or modify whatever else goes wrong.
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.readonly");
    expect(url.searchParams.get("scope")).not.toContain("modify");
    expect(url.searchParams.get("scope")).not.toContain("send");
  });

  it("requests offline access and forces consent", () => {
    // Without prompt=consent a re-authorization returns no refresh token, and
    // the stored one silently becomes the only copy.
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("carries the PKCE challenge and the state", () => {
    expect(url.searchParams.get("code_challenge")).toBe("chal");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("st");
  });

  it("redirects only to loopback", () => {
    // The out-of-band "paste this code" flow is deprecated and phishable.
    const redirect = new URL(url.searchParams.get("redirect_uri")!);
    expect(redirect.hostname).toBe("127.0.0.1");
  });

  it("does not put the client secret in the browser URL", () => {
    expect(url.toString()).not.toContain(CREDS.clientSecret);
  });
});

describe("DEFAULT_QUERY", () => {
  it("is time-boxed so a first run does not pull an entire mailbox", () => {
    expect(DEFAULT_QUERY).toContain("newer_than:");
  });
});
