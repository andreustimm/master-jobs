import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isWriterEnvelope, signWriterEnvelope, stripWriterAttestation, verifyWriterEnvelope } from "../scripts/tasks/attestation.ts";

function keys() {
  const pair = generateKeyPairSync("ed25519");
  return { privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), publicKey: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64") };
}
const KEY = keys();
const OTHER_KEY = keys();
const CONTEXT = "owner/repository#42";
const envelope = (kind: string) => `<!-- tasks-${kind}:v1 -->\n\`\`\`json\n{"protocolVersion":1,"message":"Verificação de execução"}\n\`\`\``;

describe("writer Ed25519 attestation", () => {
  it.each(["control", "coordination", "receipt"])("binds %s to exact content and its issue", (kind) => {
    const body = envelope(kind);
    const attested = signWriterEnvelope(body, KEY.privateKey, KEY.publicKey, CONTEXT);
    expect(attested).toMatch(/\n<!-- tasks-attestation:[A-Za-z0-9+/]{86}== -->$/u);
    expect(() => verifyWriterEnvelope(attested, KEY.publicKey, CONTEXT)).not.toThrow();
    expect(stripWriterAttestation(attested)).toBe(body);
    expect(signWriterEnvelope(attested, KEY.privateKey, KEY.publicKey, CONTEXT)).toBe(attested);
    expect(() => verifyWriterEnvelope(attested, KEY.publicKey, "owner/repository#43")).toThrow(/invalid/u);
    expect(() => verifyWriterEnvelope(attested, KEY.publicKey, "other/repository#42")).toThrow(/invalid/u);
  });

  it("refuses forged envelopes even when their GitHub author could be the same login", () => {
    const attested = signWriterEnvelope(envelope("receipt"), OTHER_KEY.privateKey, OTHER_KEY.publicKey, CONTEXT);
    expect(() => verifyWriterEnvelope(attested, KEY.publicKey, CONTEXT)).toThrow(/invalid/u);
    expect(() => verifyWriterEnvelope(envelope("receipt"), KEY.publicKey, CONTEXT)).toThrow(/missing/u);
  });

  it("detects body changes, whitespace changes and changed envelope kinds", () => {
    const attested = signWriterEnvelope(envelope("coordination"), KEY.privateKey, KEY.publicKey, CONTEXT);
    for (const altered of [attested.replace("execução", "cancelamento"), attested.replace("\n```json", "\n```json\n"), attested.replace("tasks-coordination", "tasks-control")]) {
      expect(() => verifyWriterEnvelope(altered, KEY.publicKey, CONTEXT)).toThrow(/invalid/u);
    }
  });

  it("does not permit malformed, doubled or truncated signatures", () => {
    const attested = signWriterEnvelope(envelope("receipt"), KEY.privateKey, KEY.publicKey, CONTEXT);
    const signatureLine = attested.split("\n").at(-1)!;
    for (const malformed of [attested.slice(0, -1), `${attested}\n`, `${attested}\n${signatureLine}`, attested.replace(/tasks-attestation:./u, "tasks-attestation:!")]) {
      expect(() => verifyWriterEnvelope(malformed, KEY.publicKey, CONTEXT)).toThrow(/Malformed/u);
      expect(() => stripWriterAttestation(malformed)).toThrow(/Malformed/u);
    }
  });

  it("does not turn an unverified signature into a valid signature by resigning", () => {
    const altered = signWriterEnvelope(envelope("control"), KEY.privateKey, KEY.publicKey, CONTEXT).replace("execução", "cancelamento");
    expect(() => signWriterEnvelope(altered, KEY.privateKey, KEY.publicKey, CONTEXT)).toThrow(/invalid/u);
  });

  it("does not attest commands or ordinary human messages", () => {
    for (const body of [envelope("command"), "Human discussion", "<!-- tasks-control:v1 -->malformed"]) {
      expect(() => signWriterEnvelope(body, KEY.privateKey, KEY.publicKey, CONTEXT)).toThrow(/Only complete/u);
      expect(stripWriterAttestation(body)).toBe(body);
    }
    expect(isWriterEnvelope(envelope("command"))).toBe(false);
    expect(isWriterEnvelope(envelope("receipt"))).toBe(true);
  });

  it("rejects missing, mismatched or non-Ed25519 signing keys without exposing key material", () => {
    expect(() => signWriterEnvelope(envelope("control"), "", KEY.publicKey, CONTEXT)).toThrow("Writer signing key is unavailable");
    expect(() => signWriterEnvelope(envelope("control"), OTHER_KEY.privateKey, KEY.publicKey, CONTEXT)).toThrow("Writer signing key does not match the configured public key");
    const secret = "sensitive-invalid-secret-material";
    expect(() => signWriterEnvelope(envelope("control"), secret, KEY.publicKey, CONTEXT)).toThrow("Writer signing key is invalid");
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const rsaPublic = rsa.publicKey.export({ type: "spki", format: "der" }).toString("base64");
    const rsaPrivate = rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(() => signWriterEnvelope(envelope("control"), rsaPrivate, rsaPublic, CONTEXT)).toThrow("Writer verification key is invalid");
  });

  it("refuses invalid public keys and contexts without echoing their values", () => {
    expect(() => signWriterEnvelope(envelope("control"), KEY.privateKey, "invalid public data", CONTEXT)).toThrow("Writer verification key is invalid");
    expect(() => signWriterEnvelope(envelope("control"), KEY.privateKey, KEY.publicKey, "bad\0context")).toThrow("Invalid writer attestation context");
  });
});
