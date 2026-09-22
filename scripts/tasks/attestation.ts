import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import type { KeyObject } from "node:crypto";

const WRITER_ENVELOPE = /^<!-- tasks-(?:control|coordination|receipt):v1 -->/u;
const ATTESTATION_LINE = /^<!-- tasks-attestation:/gmu;

export function isWriterEnvelope(body: string): boolean {
  return WRITER_ENVELOPE.test(body);
}

function split(body: string): { unsigned: string; signature: Buffer | null } {
  if (!isWriterEnvelope(body)) return { unsigned: body, signature: null };
  const markers = [...body.matchAll(ATTESTATION_LINE)];
  if (markers.length === 0) return { unsigned: body, signature: null };
  const suffix = /\n<!-- tasks-attestation:([A-Za-z0-9+/]{86}==) -->(?![\s\S])/u.exec(body);
  if (markers.length !== 1 || !suffix?.[1] || suffix.index === undefined) throw new Error("Malformed writer attestation");
  const signature = Buffer.from(suffix[1], "base64");
  if (signature.length !== 64 || signature.toString("base64") !== suffix[1]) throw new Error("Malformed writer attestation");
  return { unsigned: body.slice(0, suffix.index), signature };
}

export function stripWriterAttestation(body: string): string {
  return split(body).unsigned;
}

function validateEnvelope(body: string): void {
  if (!isWriterEnvelope(body) || !/^<!-- tasks-(?:control|coordination|receipt):v1 -->\n```json\n[\s\S]+\n```\s*$/u.test(body)) {
    throw new Error("Only complete control, coordination and receipt envelopes may be attested");
  }
}

function payload(context: string, body: string): Buffer {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9][0-9]*$/u.test(context)) throw new Error("Invalid writer attestation context");
  return Buffer.from(`${context}\0${body}`, "utf8");
}

function publicKey(encoded: string): KeyObject {
  try {
    if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) throw new Error();
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.toString("base64") !== encoded) throw new Error();
    const key = createPublicKey({ key: bytes, format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ed25519" || !key.export({ format: "der", type: "spki" }).equals(bytes)) throw new Error();
    return key;
  } catch {
    throw new Error("Writer verification key is invalid");
  }
}

export function verifyWriterEnvelope(body: string, expectedPublicKey: string, context: string): void {
  if (!isWriterEnvelope(body)) throw new Error("Only writer envelopes carry writer attestations");
  const { unsigned, signature } = split(body);
  if (!signature) throw new Error("Writer attestation is missing");
  validateEnvelope(unsigned);
  const key = publicKey(expectedPublicKey);
  let valid = false;
  try { valid = verify(null, payload(context, unsigned), key, signature); }
  catch { throw new Error("Writer attestation could not be verified"); }
  if (!valid) throw new Error("Writer attestation is invalid");
}

export function signWriterEnvelope(body: string, privateKeyPem: string, expectedPublicKey: string, context: string): string {
  if (!privateKeyPem) throw new Error("Writer signing key is unavailable");
  const expected = publicKey(expectedPublicKey);
  let key: KeyObject;
  try {
    key = createPrivateKey({ key: privateKeyPem, format: "pem", type: "pkcs8" });
    if (key.asymmetricKeyType !== "ed25519") throw new Error();
  } catch {
    throw new Error("Writer signing key is invalid");
  }
  if (!createPublicKey(key).export({ type: "spki", format: "der" }).equals(expected.export({ type: "spki", format: "der" }))) {
    throw new Error("Writer signing key does not match the configured public key");
  }
  const { unsigned, signature } = split(body);
  validateEnvelope(unsigned);
  if (signature) verifyWriterEnvelope(body, expectedPublicKey, context);
  const bytes = payload(context, unsigned);
  let attestation: string;
  try { attestation = sign(null, bytes, key).toString("base64"); }
  catch { throw new Error("Writer attestation could not be created"); }
  return `${unsigned}\n<!-- tasks-attestation:${attestation} -->`;
}
