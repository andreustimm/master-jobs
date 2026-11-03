/**
 * Cópias `.jho-e2e-*` que nenhuma execução viva reclama (#527).
 *
 * O runner isolado copia o repositório para uma pasta irmã do checkout e a
 * apaga no `finally`. Um Ctrl+C, um `kill` ou um terminal fechado encerram o
 * processo sem passar pelo `finally`: em 2026-10-12 eram 16 cópias, 11,3 GB,
 * com o disco a 95 %. Cada execução grava agora o próprio PID em `owner.json`;
 * a seguinte remove a cópia cujo dono morreu.
 *
 * Pasta sem `owner.json` é de antes desta regra — ou de uma execução que
 * acabou de criar a pasta e ainda não escreveu o dono. Só a primeira é órfã,
 * e a idade distingue as duas.
 */
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const PREFIX = ".jho-e2e-";
export const OWNER_FILE = "owner.json";
/** Pasta sem dono mais nova que isto pode ser uma execução nascendo. */
export const UNOWNED_GRACE_MS = 6 * 60 * 60 * 1000;

/** `kill(pid, 0)` não mata nada: só pergunta se o processo existe. */
export function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: existe, mas é de outro usuário — vivo, então não é nosso para apagar.
    return error?.code === "EPERM";
  }
}

export async function claim(directory, pid = process.pid) {
  await writeFile(join(directory, OWNER_FILE), JSON.stringify({ pid }));
}

async function ownerPid(directory) {
  try {
    const { pid } = JSON.parse(await readFile(join(directory, OWNER_FILE), "utf8"));
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * As cópias em `parent` que podem ser removidas, sem tocar em nenhuma.
 * `self` é a cópia da execução corrente, que nunca é órfã.
 *
 * @param {string} parent
 * @param {{ self?: string, now?: number, alive?: (pid: number) => boolean }} [options]
 * @returns {Promise<string[]>}
 */
export async function findOrphans(parent, { self, now = Date.now(), alive = processAlive } = {}) {
  let entries;
  try {
    entries = await readdir(parent, { withFileTypes: true });
  } catch {
    return [];
  }
  const orphans = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(PREFIX)) continue;
    const directory = join(parent, entry.name);
    if (directory === self) continue;
    const pid = await ownerPid(directory);
    if (pid !== null) {
      if (!alive(pid)) orphans.push(directory);
      continue;
    }
    const { mtimeMs } = await stat(directory);
    if (now - mtimeMs > UNOWNED_GRACE_MS) orphans.push(directory);
  }
  return orphans;
}

/**
 * @param {string} parent
 * @param {{ self?: string, now?: number, alive?: (pid: number) => boolean }} [options]
 */
export async function removeOrphans(parent, options) {
  const orphans = await findOrphans(parent, options);
  for (const directory of orphans) await rm(directory, { recursive: true, force: true });
  return orphans;
}
