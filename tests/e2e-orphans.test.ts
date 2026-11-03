import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OWNER_FILE, UNOWNED_GRACE_MS, claim, findOrphans, removeOrphans } from "./e2e/orphans.mjs";

/**
 * O E2E interrompido deixava a cópia do repositório para trás: 16 pastas e
 * 11,3 GB em 2026-10-12 (#527). A execução seguinte remove só o que nenhum
 * processo vivo reclama.
 */
let parent: string;

beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), "jho-orphans-"));
});
afterEach(async () => {
  await rm(parent, { recursive: true, force: true });
});

/** Cria a cópia, o dono (objeto ou texto cru) e só então envelhece a pasta. */
async function copy(name: string, owner?: unknown, ageMs = 0) {
  const directory = join(parent, name);
  await mkdir(directory);
  if (owner !== undefined) {
    await writeFile(join(directory, OWNER_FILE), typeof owner === "string" ? owner : JSON.stringify(owner));
  }
  if (ageMs > 0) {
    const then = new Date(Date.now() - ageMs);
    await utimes(directory, then, then);
  }
  return directory;
}

const DEAD = 999_001;
const LIVE = 999_002;
const alive = (pid: number) => pid === LIVE;

describe("findOrphans", () => {
  it("remove a cópia cujo dono morreu e mantém a de dono vivo", async () => {
    const dead = await copy(".jho-e2e-dead", { pid: DEAD });
    await copy(".jho-e2e-live", { pid: LIVE });
    expect(await findOrphans(parent, { alive })).toEqual([dead]);
  });

  it("sem dono: antiga é órfã, recente pode ser uma execução nascendo", async () => {
    const legacy = await copy(".jho-e2e-legacy", undefined, UNOWNED_GRACE_MS + 60_000);
    await copy(".jho-e2e-starting");
    expect(await findOrphans(parent, { alive })).toEqual([legacy]);
  });

  it("dono ilegível conta como sem dono", async () => {
    const broken = await copy(".jho-e2e-broken", "{não é json", UNOWNED_GRACE_MS + 60_000);
    expect(await findOrphans(parent, { alive })).toEqual([broken]);
  });

  it("nunca a própria cópia, nem pasta com outro prefixo", async () => {
    const self = await copy(".jho-e2e-self", { pid: DEAD });
    await copy("outra-coisa", undefined, UNOWNED_GRACE_MS + 60_000);
    expect(await findOrphans(parent, { alive, self })).toEqual([]);
  });

  it("pasta-mãe ausente não é erro", async () => {
    expect(await findOrphans(join(parent, "nao-existe"))).toEqual([]);
  });
});

describe("removeOrphans e claim", () => {
  it("apaga só as órfãs, e o dono gravado por claim protege a cópia", async () => {
    await copy(".jho-e2e-dead", { pid: DEAD });
    const mine = await copy(".jho-e2e-mine");
    await claim(mine, LIVE);
    const removed = await removeOrphans(parent, { alive });
    expect(removed).toHaveLength(1);
    expect(await readdir(parent)).toEqual([".jho-e2e-mine"]);
  });

  it("o processo corrente conta como vivo pelo detector padrão", async () => {
    const mine = await copy(".jho-e2e-current");
    await claim(mine);
    expect(await findOrphans(parent)).toEqual([]);
  });
});
