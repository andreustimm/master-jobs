import { describe, expect, it, vi } from "vitest";
import {
  assertSafeRemoteUrl,
  isGloballyRoutableAddress,
  safeRemoteFetch,
  UnsafeRemoteUrlError,
  type LookupHost,
} from "../src/core/remote-url.ts";

const publicLookup: LookupHost = async () => [
  { address: "93.184.216.34", family: 4 },
];

describe("server-side remote URL policy", () => {
  it("accepts globally routable IPv4 and IPv6 addresses", () => {
    expect(isGloballyRoutableAddress("8.8.8.8")).toBe(true);
    expect(isGloballyRoutableAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("rejects local, private, link-local, documentation and metadata ranges", () => {
    for (const address of [
      "0.0.0.0",
      "10.0.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "198.51.100.2",
      "::1",
      "fc00::1",
      "fe80::1",
      "2001:db8::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isGloballyRoutableAddress(address), address).toBe(false);
    }
  });

  it("distinguishes a navigable localhost URL from a server-fetchable URL", async () => {
    await expect(assertSafeRemoteUrl("http://localhost:3000/role")).rejects.toBeInstanceOf(
      UnsafeRemoteUrlError,
    );
    await expect(assertSafeRemoteUrl("http://2130706433/role")).rejects.toBeInstanceOf(
      UnsafeRemoteUrlError,
    );
  });

  it("rejects a hostname when any DNS answer is private", async () => {
    const mixedLookup: LookupHost = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];
    await expect(
      assertSafeRemoteUrl("https://jobs.example.test/role", {
        lookupHost: mixedLookup,
      }),
    ).rejects.toBeInstanceOf(UnsafeRemoteUrlError);
  });

  it("allows a hostname only after public DNS resolution", async () => {
    await expect(
      assertSafeRemoteUrl("https://jobs.example.test/role", {
        lookupHost: publicLookup,
      }),
    ).resolves.toMatchObject({ hostname: "jobs.example.test" });
  });

  it("validates redirects before making the next request", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("jobs.example.test")) {
        return new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data" },
        });
      }
      return new Response("secret", { status: 200 });
    }) as unknown as typeof fetch;

    await expect(
      safeRemoteFetch("https://jobs.example.test/role", {}, {
        fetchImpl,
        lookupHost: publicLookup,
      }),
    ).rejects.toBeInstanceOf(UnsafeRemoteUrlError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
