import { generateKeyPairSync, randomUUID } from "node:crypto";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadOrCreateExecutionKey, signCommand, verifyCommandSignature } from "../scripts/tasks/signing.ts";
import { commandBody, parseCommand } from "../scripts/tasks/protocol.ts";
import type { Command } from "../scripts/tasks/types.ts";

let root: string;
let gitDir: string;
let context: { executionId: string; branch: string; worktreeId: string };

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "jho-task-signing-")));
  gitDir = join(root, "git-worktree");
  mkdirSync(gitDir);
  context = { executionId: randomUUID(), branch: "feat/task-signing", worktreeId: "task-signing" };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function command(overrides: Partial<Command> = {}): Command {
  return {
    protocolVersion: 1, operationId: randomUUID(), action: "claim", issue: 184,
    expectedRevision: "a".repeat(64),
    execution: { ...context, publicKey: "", generation: 1 },
    ...overrides,
  };
}

function keyFile(): string {
  return join(gitDir, "task-keys", `${context.executionId}.json`);
}

describe("execution command signatures", () => {
  it("survives the public wire format without exposing private material or mutating the input", () => {
    const key = loadOrCreateExecutionKey(gitDir, context);
    const input = command();
    const signed = key.sign(input);
    const wire = commandBody(signed);
    const decoded = parseCommand(wire)!;
    expect(() => verifyCommandSignature(decoded, key.publicKey)).not.toThrow();
    expect(Buffer.from(key.publicKey, "base64")).toHaveLength(44);
    expect(input.signature).toBeUndefined();
    expect(input.execution?.publicKey).toBe("");
    expect(wire).not.toContain("PRIVATE KEY");
    expect(JSON.stringify(key)).toBe(JSON.stringify({ publicKey: key.publicKey }));
  });

  it("signs stable JSON regardless of property insertion order", () => {
    const key = loadOrCreateExecutionKey(gitDir, context);
    const first = key.sign(command({ reason: "Confirmar início", evidence: ["https://github.com/andreustimm/master-jobs/issues/184"] }));
    const reordered = Object.fromEntries(Object.entries(first).reverse()) as unknown as Command;
    reordered.execution = Object.fromEntries(Object.entries(first.execution!).reverse()) as unknown as Command["execution"];
    expect(() => verifyCommandSignature(reordered, key.publicKey)).not.toThrow();
    expect(key.sign(reordered).signature).toBe(first.signature);
  });

  it.each([
    ["operationId", (c: Command) => { c.operationId = randomUUID(); }],
    ["action", (c: Command) => { c.action = "release"; }],
    ["issue", (c: Command) => { c.issue = 999; }],
    ["expectedRevision", (c: Command) => { c.expectedRevision = "b".repeat(64); }],
    ["branch", (c: Command) => { c.execution!.branch = "feat/another-task"; }],
    ["worktree", (c: Command) => { c.execution!.worktreeId = "other-worktree"; }],
    ["executionId", (c: Command) => { c.execution!.executionId = randomUUID(); }],
    ["generation", (c: Command) => { c.execution!.generation = 2; }],
    ["reason", (c: Command) => { c.reason = "Changed after signing"; }],
    ["evidence", (c: Command) => { c.evidence = ["https://github.com/andreustimm/master-jobs/pull/1"]; }],
    ["status", (c: Command) => { c.status = "Concluído"; }],
  ] as const)("rejects modification of %s", (_name, mutate) => {
    const key = loadOrCreateExecutionKey(gitDir, context);
    const signed = key.sign(command());
    mutate(signed);
    expect(() => verifyCommandSignature(signed, key.publicKey)).toThrow("INVALID_COMMAND_SIGNATURE");
  });

  it("rejects another execution forging the visible holder metadata with its own key", () => {
    const owner = loadOrCreateExecutionKey(gitDir, context);
    const other = generateKeyPairSync("ed25519");
    const forged = signCommand(command({ action: "heartbeat" }), other.privateKey.export({ format: "pem", type: "pkcs8" }).toString());
    expect(() => verifyCommandSignature(forged, owner.publicKey)).toThrow("INVALID_COMMAND_SIGNATURE");
    forged.execution!.publicKey = owner.publicKey;
    expect(() => verifyCommandSignature(forged, owner.publicKey)).toThrow("INVALID_COMMAND_SIGNATURE");
  });

  it.each(["claim", "heartbeat", "transition", "block", "resume", "release", "transfer"] as const)("requires a signature for %s", (action) => {
    expect(() => verifyCommandSignature(command({ action }))).toThrow("INVALID_COMMAND_SIGNATURE");
  });

  it.each(["create", "adopt", "reconcile", "pause", "unpause"] as const)("leaves unsigned %s authorization to the GitHub actor policy", (action) => {
    expect(() => verifyCommandSignature(command({ action, execution: undefined }))).not.toThrow();
  });

  it("rejects malformed public keys, signatures and other signing algorithms", () => {
    const key = loadOrCreateExecutionKey(gitDir, context);
    const signed = key.sign(command());
    for (const signature of ["malformed", "", signed.signature! + "\n", Buffer.alloc(63).toString("base64"), Buffer.alloc(64).toString("base64")]) {
      expect(() => verifyCommandSignature({ ...signed, signature }, key.publicKey)).toThrow("INVALID_COMMAND_SIGNATURE");
    }
    expect(() => verifyCommandSignature({ ...signed, execution: { ...signed.execution!, publicKey: key.publicKey + "\n" } })).toThrow("INVALID_COMMAND_SIGNATURE");
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(() => signCommand(command(), rsa.privateKey.export({ format: "pem", type: "pkcs8" }).toString())).toThrow("INVALID_EXECUTION_KEY");
    expect(() => verifyCommandSignature({ ...signed, execution: { ...signed.execution!, publicKey: rsa.publicKey.export({ format: "der", type: "spki" }).toString("base64") } })).toThrow("INVALID_COMMAND_SIGNATURE");
  });

  it("covers the transfer recipient key and rejects invalid recipients", () => {
    const key = loadOrCreateExecutionKey(gitDir, context);
    const recipient = loadOrCreateExecutionKey(gitDir, { executionId: randomUUID(), branch: "fix/next", worktreeId: "next" });
    const transferTo = { executionId: randomUUID(), branch: "fix/next", worktreeId: "next", publicKey: recipient.publicKey };
    const signed = key.sign(command({ action: "transfer", transferTo, reason: "Handoff do WIP" }));
    expect(() => verifyCommandSignature(signed, key.publicKey)).not.toThrow();
    signed.transferTo!.publicKey = key.publicKey;
    expect(() => verifyCommandSignature(signed, key.publicKey)).toThrow("INVALID_COMMAND_SIGNATURE");
    expect(() => key.sign(command({ action: "transfer", transferTo: { ...transferTo, publicKey: "x".repeat(60) } }))).toThrow("INVALID_COMMAND_SIGNATURE");
  });
});

describe("private keys bound to a worktree", () => {
  it("persists one key at mode 0600 in a 0700 directory and reuses it across generations", () => {
    const first = loadOrCreateExecutionKey(gitDir, context);
    const initial = readFileSync(keyFile(), "utf8");
    const reopened = loadOrCreateExecutionKey(gitDir, context);
    expect(reopened.publicKey).toBe(first.publicKey);
    expect(readFileSync(keyFile(), "utf8")).toBe(initial);
    expect(statSync(keyFile()).mode & 0o777).toBe(0o600);
    expect(statSync(join(gitDir, "task-keys")).mode & 0o777).toBe(0o700);
    const next = reopened.sign(command({ execution: { ...context, publicKey: first.publicKey, generation: 9 } }));
    expect(() => verifyCommandSignature(next, first.publicKey)).not.toThrow();
  });

  it.each(["branch", "worktreeId"] as const)("refuses a stored key rebound to another %s", (field) => {
    loadOrCreateExecutionKey(gitDir, context);
    const initial = readFileSync(keyFile(), "utf8");
    expect(() => loadOrCreateExecutionKey(gitDir, { ...context, [field]: "another" })).toThrow("UNSAFE_EXECUTION_KEY_STORE");
    expect(readFileSync(keyFile(), "utf8")).toBe(initial);
  });

  it("refuses signing for another branch, worktree or execution with the bound signer", () => {
    const key = loadOrCreateExecutionKey(gitDir, context);
    for (const replacement of [{ branch: "fix/other" }, { worktreeId: "other" }, { executionId: randomUUID() }]) {
      expect(() => key.sign(command({ execution: { ...context, publicKey: key.publicKey, ...replacement } }))).toThrow("INVALID_COMMAND_SIGNATURE");
    }
  });

  it("does not follow traversal, a symlinked Git directory, key directory or key file", () => {
    const key = loadOrCreateExecutionKey(gitDir, context);
    const original = readFileSync(keyFile(), "utf8");
    expect(() => loadOrCreateExecutionKey(gitDir, { ...context, executionId: "../../outside" })).toThrow("UNSAFE_EXECUTION_KEY_STORE");
    expect(() => loadOrCreateExecutionKey(`${gitDir}/../git-worktree`, context)).toThrow("UNSAFE_EXECUTION_KEY_STORE");
    const alias = join(root, "git-alias");
    symlinkSync(gitDir, alias);
    expect(() => loadOrCreateExecutionKey(alias, context)).toThrow("UNSAFE_EXECUTION_KEY_STORE");
    const ancestorAlias = join(root, "ancestor");
    symlinkSync(root, ancestorAlias);
    expect(() => loadOrCreateExecutionKey(join(ancestorAlias, "git-worktree"), context)).toThrow("UNSAFE_EXECUTION_KEY_STORE");
    const outside = join(root, "outside.json");
    writeFileSync(outside, original, { mode: 0o600 });
    rmSync(keyFile());
    symlinkSync(outside, keyFile());
    expect(() => loadOrCreateExecutionKey(gitDir, context)).toThrow("UNSAFE_EXECUTION_KEY_STORE");
    rmSync(join(gitDir, "task-keys"), { recursive: true });
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere, { mode: 0o700 });
    symlinkSync(elsewhere, join(gitDir, "task-keys"));
    expect(() => loadOrCreateExecutionKey(gitDir, context)).toThrow("UNSAFE_EXECUTION_KEY_STORE");
    expect(readFileSync(outside, "utf8")).toBe(original);
    expect(() => verifyCommandSignature(key.sign(command()), key.publicKey)).not.toThrow();
  });

  it("refuses hardlinked keys and relaxed file or directory permissions", () => {
    loadOrCreateExecutionKey(gitDir, context);
    chmodSync(keyFile(), 0o644);
    expect(() => loadOrCreateExecutionKey(gitDir, context)).toThrow("UNSAFE_EXECUTION_KEY_STORE");
    chmodSync(keyFile(), 0o600);
    chmodSync(join(gitDir, "task-keys"), 0o755);
    expect(() => loadOrCreateExecutionKey(gitDir, context)).toThrow("UNSAFE_EXECUTION_KEY_STORE");
    chmodSync(join(gitDir, "task-keys"), 0o700);
    linkSync(keyFile(), join(root, "hardlink.json"));
    expect(() => loadOrCreateExecutionKey(gitDir, context)).toThrow("UNSAFE_EXECUTION_KEY_STORE");
  });

  it("fails closed for corrupted or mismatched private material without regenerating or revealing it", () => {
    loadOrCreateExecutionKey(gitDir, context);
    const initial = JSON.parse(readFileSync(keyFile(), "utf8")) as Record<string, unknown>;
    const other = generateKeyPairSync("ed25519");
    const otherPem = other.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    for (const content of ["{broken", JSON.stringify({ ...initial, privateKeyPem: "PRIVATE-SENTINEL" }), JSON.stringify({ ...initial, privateKeyPem: otherPem }), JSON.stringify({ ...initial, executionId: randomUUID() })]) {
      writeFileSync(keyFile(), content, "utf8");
      let message = "";
      try { loadOrCreateExecutionKey(gitDir, context); } catch (error) { message = (error as Error).message; }
      expect(message).toContain("UNSAFE_EXECUTION_KEY_STORE");
      expect(message).not.toContain("PRIVATE-SENTINEL");
      expect(message).not.toContain("PRIVATE KEY");
      expect(message).not.toContain(root);
      expect(readFileSync(keyFile(), "utf8")).toBe(content);
    }
  });
});
