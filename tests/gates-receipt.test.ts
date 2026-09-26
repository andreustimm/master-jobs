// Suite: recibo de gates por fingerprint (#320)
// Invariant: gate verde não roda de novo no mesmo estado (HEAD, árvore e mapa)
//   dentro do prazo; qualquer mudança de estado, prazo vencido, data no futuro
//   ou recibo ilegível faz o gate rodar. Gate vermelho nunca entra no recibo, e
//   gate que mudou a árvore durante a execução também não.
// Boundary IN: scripts/gates/receipt.ts, runPlan/treeEntries/loadReceipt de
//   scripts/gates/cli.ts, num repositório Git temporário
// Boundary OUT: os comandos reais dos gates (substituídos por um executor falso)
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadReceipt, parseArgs, receiptFile, runPlan, treeEntries, type RunDeps } from "../scripts/gates/cli.ts";
import type { Plan, PlannedGate } from "../scripts/gates/impact.ts";
import { covers, fingerprintOf, readReceipt, recordPass, RECEIPT_TTL_MS, treeHash, type Fingerprint, type Receipt } from "../scripts/gates/receipt.ts";

const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

const T0 = Date.parse("2026-09-25T12:00:00.000Z");
const PARTS = { head: "a".repeat(40), tree: "t1", mapVersion: "1.0.0", mapChecksum: "c1" };
const FP = fingerprintOf(PARTS);

function git(cwd: string, ...args: string[]) {
  const run = spawnSync("git", args, { cwd, encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
  return run.stdout.trim();
}

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "jho-gates-receipt-"));
  temporary.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "e2e@local.test");
  git(dir, "config", "user.name", "gates");
  git(dir, "config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
  writeFileSync(join(dir, ".gitignore"), "ignorado/\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "--no-verify", "-m", "base");
  return dir;
}

function gate(id: string): PlannedGate {
  return { id, description: id, command: ["run", id], appendFiles: false, e2eAreas: false, reasons: ["x"], files: ["a.ts"] };
}

const PLAN: Plan = { mapVersion: "1.0.0", paths: [], unknown: [], gates: [gate("typecheck"), gate("tests")] };

function deps(overrides: Partial<RunDeps> & { codes?: Record<string, number> } = {}) {
  const ran: string[] = [];
  const saved: Receipt[] = [];
  const { codes = {}, ...rest } = overrides;
  const value: RunDeps = {
    exec: (command) => { ran.push(command[1]!); return codes[command[1]!] ?? 0; },
    now: () => T0,
    fingerprint: () => FP,
    receipt: null,
    save: (receipt) => { saved.push(receipt); },
    log: () => {},
    ...rest,
  };
  return { value, ran, saved };
}

describe("fingerprint e validade do recibo", () => {
  it("muda com cada uma das quatro partes", () => {
    const values = new Set([
      FP.value,
      fingerprintOf({ ...PARTS, head: "b".repeat(40) }).value,
      fingerprintOf({ ...PARTS, tree: "t2" }).value,
      fingerprintOf({ ...PARTS, mapVersion: "1.0.1" }).value,
      fingerprintOf({ ...PARTS, mapChecksum: "c2" }).value,
    ]);
    expect(values.size).toBe(5);
    expect(fingerprintOf(PARTS).value).toBe(FP.value);
    expect(() => fingerprintOf({ ...PARTS, head: "" })).toThrow("sem head");
  });

  it("recibo de outro estado não vale, e diz o que mudou", () => {
    const receipt = recordPass(null, FP, "typecheck", ["run", "typecheck"], 3, T0);
    const other = fingerprintOf({ ...PARTS, tree: "t2" });
    expect(readReceipt(receipt, other)).toEqual({ reason: "recibo de outro estado (tree mudou)" });
    expect(readReceipt(receipt, FP)).toEqual({ receipt });
  });

  it.each([
    ["ausente", undefined, "sem recibo"],
    ["nulo", null, "sem recibo"],
    ["outro esquema", { schemaVersion: 2, gates: {} }, "formato desconhecido"],
    ["sem gates", { schemaVersion: 1 }, "formato desconhecido"],
    ["lista", [], "formato desconhecido"],
  ])("recibo %s não vale", (_name, raw, reason) => {
    expect(readReceipt(raw, FP)).toEqual({ reason: expect.stringContaining(reason) });
  });

  it("registro fora do formato é descartado, o resto continua", () => {
    const receipt = recordPass(null, FP, "typecheck", ["run", "typecheck"], 3, T0);
    const raw = {
      ...receipt,
      gates: {
        ...receipt.gates,
        tests: { status: "fail", at: new Date(T0).toISOString(), seconds: 1 },
        build: { status: "pass", at: 42, seconds: 1 },
      },
    };
    const read = readReceipt(raw, FP);
    expect("receipt" in read && Object.keys(read.receipt.gates)).toEqual(["typecheck"]);
  });

  it("vencido não vale; data no futuro nem ilegível também não", () => {
    const receipt = recordPass(null, FP, "typecheck", ["run", "typecheck"], 3, T0);
    expect(covers(receipt, "typecheck", ["run", "typecheck"], T0)).toBe(true);
    expect(covers(receipt, "typecheck", ["run", "typecheck"], T0 + RECEIPT_TTL_MS)).toBe(true);
    expect(covers(receipt, "typecheck", ["run", "typecheck"], T0 + RECEIPT_TTL_MS + 1)).toBe(false);
    expect(covers(receipt, "typecheck", ["run", "typecheck"], T0 - 1)).toBe(false);
    expect(covers(receipt, "tests", ["run", "tests"], T0)).toBe(false);
    expect(covers(null, "typecheck", ["run", "typecheck"], T0)).toBe(false);
    // Mesmo gate, outro comando: related-tests sobre a.ts não aprova sobre b.ts.
    expect(covers(receipt, "typecheck", ["run", "typecheck", "b.ts"], T0)).toBe(false);
    const broken = { ...receipt, gates: { typecheck: { ...receipt.gates.typecheck!, at: "ontem" } } };
    expect(covers(broken, "typecheck", ["run", "typecheck"], T0)).toBe(false);
  });

  it("registrar sob outro fingerprint descarta o que o recibo antigo aprovava", () => {
    const first = recordPass(recordPass(null, FP, "typecheck", ["run", "typecheck"], 3, T0), FP, "tests", ["run", "tests"], 9, T0);
    expect(Object.keys(first.gates)).toEqual(["typecheck", "tests"]);
    const next = recordPass(first, fingerprintOf({ ...PARTS, head: "b".repeat(40) }), "tests", ["run", "tests"], 8, T0);
    expect(Object.keys(next.gates)).toEqual(["tests"]);
    expect(next.head).toBe("b".repeat(40));
  });
});

describe("runPlan — pula o que o recibo cobre e só registra verde estável", () => {
  it("primeira rodada roda e registra; a segunda, no mesmo estado, não roda nada", () => {
    const first = deps();
    expect(runPlan(PLAN, (item) => item.command, first.value).map((result) => result.status)).toEqual(["pass", "pass"]);
    expect(first.ran).toEqual(["typecheck", "tests"]);
    const receipt = first.saved.at(-1)!;
    expect(Object.keys(receipt.gates)).toEqual(["typecheck", "tests"]);

    const second = deps({ receipt });
    expect(runPlan(PLAN, (item) => item.command, second.value).map((result) => result.status)).toEqual(["receipt", "receipt"]);
    expect(second.ran).toEqual([]);
  });

  it("recibo vencido roda de novo", () => {
    const receipt = recordPass(recordPass(null, FP, "typecheck", ["run", "typecheck"], 1, T0), FP, "tests", ["run", "tests"], 1, T0);
    const later = deps({ receipt, now: () => T0 + RECEIPT_TTL_MS + 1 });
    runPlan(PLAN, (item) => item.command, later.value);
    expect(later.ran).toEqual(["typecheck", "tests"]);
  });

  it("estado novo roda de novo, mesmo com recibo verde", () => {
    const receipt = recordPass(recordPass(null, FP, "typecheck", ["run", "typecheck"], 1, T0), FP, "tests", ["run", "tests"], 1, T0);
    const edited = deps({ receipt, fingerprint: () => fingerprintOf({ ...PARTS, tree: "t2" }) });
    runPlan(PLAN, (item) => item.command, edited.value);
    expect(edited.ran).toEqual(["typecheck", "tests"]);
  });

  it("gate vermelho para a rodada e não entra no recibo", () => {
    const failing = deps({ codes: { typecheck: 2 } });
    expect(runPlan(PLAN, (item) => item.command, failing.value).map((result) => result.status)).toEqual(["fail"]);
    expect(failing.saved.map((receipt) => Object.keys(receipt.gates))).toEqual([[]]);
  });

  it("gate que falha sob --fresh tira do disco o verde antigo do mesmo estado", () => {
    // O disco tem typecheck verde para FP; `--fresh` entra sem recibo em memória.
    let disk: Receipt | null = recordPass(null, FP, "typecheck", ["run", "typecheck"], 1, T0);
    const fresh = deps({ receipt: null, codes: { typecheck: 2 }, save: (receipt) => { disk = receipt; } });
    expect(runPlan(PLAN, (item) => item.command, fresh.value).map((result) => result.status)).toEqual(["fail"]);

    // Rodada seguinte, sem --fresh, lê o que ficou no disco: typecheck roda de novo.
    const next = deps({ receipt: disk });
    expect(runPlan(PLAN, (item) => item.command, next.value).map((result) => result.status)).toEqual(["pass", "pass"]);
    expect(next.ran).toEqual(["typecheck", "tests"]);
  });

  it("gate que falha sai do recibo e preserva os verdes anteriores da rodada", () => {
    const receipt = recordPass(recordPass(null, FP, "typecheck", ["run", "typecheck"], 1, T0), FP, "tests", ["run", "tests"], 1, T0 - RECEIPT_TTL_MS - 1);
    const failing = deps({ receipt, codes: { tests: 1 } });
    expect(runPlan(PLAN, (item) => item.command, failing.value).map((result) => result.status)).toEqual(["receipt", "fail"]);
    expect(Object.keys(failing.saved.at(-1)!.gates)).toEqual(["typecheck"]);
  });

  it("gate que mudou a árvore durante a execução não entra no recibo", () => {
    let calls = 0;
    const drifting = deps({ fingerprint: () => (calls++ === 1 ? fingerprintOf({ ...PARTS, tree: "t2" }) : FP) });
    runPlan({ ...PLAN, gates: [gate("typecheck")] }, (item) => item.command, drifting.value);
    expect(drifting.ran).toEqual(["typecheck"]);
    expect(drifting.saved).toEqual([]);
  });
});

describe("hash da árvore num repositório real", () => {
  const hashOf = (dir: string) => treeHash(treeEntries(dir));

  it("muda com edição, arquivo novo, bit executável e remoção; não muda com git add nem com ignorado", () => {
    const dir = repo();
    const clean = hashOf(dir);
    expect(hashOf(dir)).toBe(clean);

    writeFileSync(join(dir, "ignorado.txt"), "x");
    const withUntracked = hashOf(dir);
    expect(withUntracked).not.toBe(clean);
    git(dir, "add", "ignorado.txt");
    expect(hashOf(dir)).toBe(withUntracked);
    git(dir, "reset", "-q", "ignorado.txt");
    unlinkSync(join(dir, "ignorado.txt"));
    expect(hashOf(dir)).toBe(clean);

    mkdirSync(join(dir, "ignorado"));
    writeFileSync(join(dir, "ignorado", "x.txt"), "artefato");
    expect(hashOf(dir)).toBe(clean);

    writeFileSync(join(dir, "a.ts"), "export const a = 2;\n");
    const edited = hashOf(dir);
    expect(edited).not.toBe(clean);

    writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
    expect(hashOf(dir)).toBe(clean);
    chmodSync(join(dir, "a.ts"), 0o755);
    expect(hashOf(dir)).not.toBe(clean);
    chmodSync(join(dir, "a.ts"), 0o644);

    unlinkSync(join(dir, "a.ts"));
    expect(hashOf(dir)).not.toBe(clean);
  });

  it("o recibo mora no diretório Git, e recibo ilegível conta como ausente", () => {
    const dir = repo();
    const file = receiptFile(dir);
    expect(file.startsWith(join(dir, ".git"))).toBe(true);
    expect(loadReceipt(file, FP)).toEqual({ receipt: null, reason: "sem recibo" });
    mkdirSync(join(dir, ".git", "jho-gates"), { recursive: true });
    writeFileSync(file, "{ quebrado");
    expect(loadReceipt(file, FP)).toEqual({ receipt: null, reason: "recibo ilegível" });
    writeFileSync(file, JSON.stringify(recordPass(null, FP, "typecheck", ["run", "typecheck"], 1, T0)));
    expect(loadReceipt(file, FP).receipt?.gates.typecheck?.status).toBe("pass");
    const other: Fingerprint = fingerprintOf({ ...PARTS, mapVersion: "2.0.0" });
    expect(loadReceipt(file, other).reason).toContain("mapVersion");
  });

  it("--fresh é aceito", () => {
    expect(parseArgs(["--fresh"]).fresh).toBe(true);
  });
});
