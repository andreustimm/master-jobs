import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import type { Stats } from "node:fs";
import { join, parse, resolve } from "node:path";
import { z } from "zod";
import { commandSchema, hash } from "./protocol.ts";
import type { Command } from "./types.ts";

const executionContext = z.strictObject({
  executionId: z.string().uuid(),
  branch: z.string().min(1).max(256),
  worktreeId: z.string().regex(/^[a-zA-Z0-9._-]+$/),
});
type ExecutionContext = z.infer<typeof executionContext>;
const storedKey = executionContext.extend({
  version: z.literal(1),
  publicKey: z.string(),
  privateKeyPem: z.string(),
});
const signedActions = new Set<Command["action"]>(["claim", "heartbeat", "transition", "block", "resume", "release", "transfer"]);
const administrativeActions = new Set<Command["action"]>(["create", "adopt", "reconcile", "pause", "unpause"]);

function signatureError(): Error {
  return new Error("INVALID_COMMAND_SIGNATURE: command must be signed by its execution key");
}

function decodeBase64(value: string): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw signatureError();
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw signatureError();
  return decoded;
}

function publicKeyFrom(value: string): KeyObject {
  try {
    const key = createPublicKey({ key: decodeBase64(value), type: "spki", format: "der" });
    if (key.asymmetricKeyType !== "ed25519" || key.export({ type: "spki", format: "der" }).toString("base64") !== value) throw signatureError();
    return key;
  } catch {
    throw signatureError();
  }
}

function privateKeyFrom(pem: string): KeyObject {
  try {
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== "ed25519") throw new Error();
    return key;
  } catch {
    // Crypto parser errors may contain caller input; private material never enters errors.
    throw new Error("INVALID_EXECUTION_KEY: an Ed25519 private key is required");
  }
}

function publicKeyOf(key: KeyObject): string {
  return createPublicKey(key).export({ type: "spki", format: "der" }).toString("base64");
}

function payload(command: Command): Buffer {
  const { signature: _signature, ...unsigned } = command;
  return Buffer.from(`master-jobs-task-command:v1:${hash(unsigned)}`, "utf8");
}

export function signCommand(command: Command, privateKeyPem: string): Command {
  if (!command.execution) throw signatureError();
  const key = privateKeyFrom(privateKeyPem);
  const { signature: _signature, ...unsigned } = command;
  // Public key is part of the signed payload, including on the initial claim.
  const prepared = commandSchema.parse({ ...unsigned, execution: { ...command.execution, publicKey: publicKeyOf(key) } });
  if (prepared.action === "transfer") {
    if (!prepared.transferTo) throw signatureError();
    publicKeyFrom(prepared.transferTo.publicKey);
  }
  return { ...prepared, signature: sign(null, payload(prepared), key).toString("base64") };
}

export function verifyCommandSignature(command: Command, expectedPublicKey?: string): void {
  if (administrativeActions.has(command.action) && !command.signature) return;
  if (!signedActions.has(command.action) && !administrativeActions.has(command.action)) throw signatureError();
  try {
    if (!command.execution || !command.signature) throw signatureError();
    const publicKey = command.execution.publicKey;
    if (expectedPublicKey !== undefined && publicKey !== expectedPublicKey) throw signatureError();
    const key = publicKeyFrom(publicKey);
    const signature = decodeBase64(command.signature);
    if (signature.length !== 64 || !verify(null, payload(command), key, signature)) throw signatureError();
    if (command.action === "transfer") {
      if (!command.transferTo) throw signatureError();
      publicKeyFrom(command.transferTo.publicKey);
    }
  } catch {
    throw signatureError();
  }
}

function storeError(): Error {
  return new Error("UNSAFE_EXECUTION_KEY_STORE: use the original private key in its bound worktree; do not replace or publish it");
}

function ownPrivateFile(stats: Stats, mode: number): boolean {
  return (stats.mode & 0o7777) === mode && (process.getuid === undefined || stats.uid === process.getuid());
}

function keyDirectory(gitDir: string): string {
  if (gitDir.split(/[\\/]/).includes("..")) throw storeError();
  const base = resolve(gitDir);
  // Check the complete supplied path, so a symlinked ancestor cannot redirect key storage.
  let current = parse(base).root;
  for (const component of base.slice(current.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, component);
    const stats = lstatSync(current);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw storeError();
  }
  const directory = join(base, "task-keys");
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const stats = lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink() || !ownPrivateFile(stats, 0o700)) throw storeError();
  return directory;
}

function readKey(path: string, context: ExecutionContext): z.infer<typeof storedKey> {
  // O_NONBLOCK also makes a substituted FIFO fail the regular-file check without hanging.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile() || stats.nlink !== 1 || !ownPrivateFile(stats, 0o600) || stats.size < 1 || stats.size > 8192) throw storeError();
    const parsed = storedKey.safeParse(JSON.parse(readFileSync(fd, "utf8")));
    if (!parsed.success) throw storeError();
    const key = parsed.data;
    if (key.executionId !== context.executionId || key.branch !== context.branch || key.worktreeId !== context.worktreeId) throw storeError();
    if (publicKeyOf(privateKeyFrom(key.privateKeyPem)) !== key.publicKey) throw storeError();
    return key;
  } finally {
    closeSync(fd);
  }
}

export function loadOrCreateExecutionKey(gitDir: string, context: ExecutionContext): { publicKey: string; sign: (command: Command) => Command } {
  try {
    const bound = executionContext.parse(context);
    const directory = keyDirectory(gitDir);
    const path = join(directory, `${bound.executionId}.json`);
    let key: z.infer<typeof storedKey>;
    try {
      key = readKey(path, bound);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const pair = generateKeyPairSync("ed25519");
      const record = { version: 1 as const, ...bound, publicKey: publicKeyOf(pair.privateKey), privateKeyPem: pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString() };
      let fd: number;
      try {
        // Never overwrite another invocation's key or follow a substituted symlink.
        fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      } catch (creationError) {
        if ((creationError as NodeJS.ErrnoException).code !== "EEXIST") throw creationError;
        key = readKey(path, bound);
        return signer(key, bound);
      }
      try {
        writeFileSync(fd, JSON.stringify(record) + "\n", "utf8");
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      key = readKey(path, bound);
    }
    return signer(key, bound);
  } catch {
    throw storeError();
  }
}

function signer(key: z.infer<typeof storedKey>, context: ExecutionContext): { publicKey: string; sign: (command: Command) => Command } {
  return {
    publicKey: key.publicKey,
    sign(command) {
      const execution = command.execution;
      if (!execution || execution.executionId !== context.executionId || execution.branch !== context.branch || execution.worktreeId !== context.worktreeId) throw signatureError();
      return signCommand(command, key.privateKeyPem);
    },
  };
}
