// Recibo de gates por fingerprint (#320). Um gate verde fica registrado com o
// fingerprint do que ele validou — HEAD, hash da árvore de trabalho e versão e
// checksum do mapa de impacto — e `pnpm gates` não o roda de novo enquanto os
// três não mudarem. O recibo é conservador de propósito: qualquer mudança na
// árvore invalida todos os gates, e não só os que "cobrem" o arquivo, porque
// decidir o que cada gate cobre é o tipo de otimização que erra em silêncio.
//
// Vencido não vale: além do fingerprint, cada gate expira em RECEIPT_TTL_MS.
// O fingerprint não vê o que mora fora do Git (dependência instalada, imagem
// do Docker, navegador do Playwright), e o prazo limita por quanto tempo essa
// diferença pode passar despercebida.
//
// Funções puras: recebem os dados e o relógio, devolvem o veredito.
import { createHash } from "node:crypto";

export const RECEIPT_SCHEMA_VERSION = 1;
/** Doze horas: uma jornada de trabalho, não um fim de semana. */
export const RECEIPT_TTL_MS = 12 * 60 * 60 * 1000;

export type FingerprintParts = { head: string; tree: string; mapVersion: string; mapChecksum: string };
export type Fingerprint = FingerprintParts & { value: string };

/**
 * `command` é o hash do comando final: `related-tests` sobre `a.ts` não
 * aprova `related-tests` sobre o diff inteiro, embora o gate tenha o mesmo nome.
 */
export type GatePass = { status: "pass"; at: string; seconds: number; command: string };

export function commandKey(command: readonly string[]): string {
  return sha256(JSON.stringify(command));
}

export type Receipt = {
  schemaVersion: typeof RECEIPT_SCHEMA_VERSION;
  fingerprint: string;
  head: string;
  tree: string;
  mapVersion: string;
  mapChecksum: string;
  gates: Record<string, GatePass>;
};

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function fingerprintOf(parts: FingerprintParts): Fingerprint {
  const { head, tree, mapVersion, mapChecksum } = parts;
  for (const [name, value] of Object.entries({ head, tree, mapVersion, mapChecksum })) {
    if (typeof value !== "string" || value === "") throw new Error(`recibo: fingerprint sem ${name}`);
  }
  return { head, tree, mapVersion, mapChecksum, value: sha256(JSON.stringify([head, tree, mapVersion, mapChecksum])) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * O recibo lido do disco, ou o motivo de ele não valer para este fingerprint.
 * Formato inesperado conta como ausente: recibo que não se entende não aprova.
 */
export function readReceipt(raw: unknown, fingerprint: Fingerprint): { receipt: Receipt } | { reason: string } {
  if (raw === null || raw === undefined) return { reason: "sem recibo" };
  if (!isRecord(raw) || raw.schemaVersion !== RECEIPT_SCHEMA_VERSION || !isRecord(raw.gates)) {
    return { reason: "recibo em formato desconhecido" };
  }
  if (raw.fingerprint !== fingerprint.value) {
    const changed = (["head", "tree", "mapVersion", "mapChecksum"] as const).filter((part) => raw[part] !== fingerprint[part]);
    return { reason: `recibo de outro estado (${changed.length > 0 ? changed.join(", ") : "fingerprint"} mudou)` };
  }
  const gates: Record<string, GatePass> = {};
  for (const [id, pass] of Object.entries(raw.gates)) {
    if (
      isRecord(pass) &&
      pass.status === "pass" &&
      typeof pass.at === "string" &&
      typeof pass.seconds === "number" &&
      typeof pass.command === "string"
    ) {
      gates[id] = { status: "pass", at: pass.at, seconds: pass.seconds, command: pass.command };
    }
  }
  return {
    receipt: {
      schemaVersion: RECEIPT_SCHEMA_VERSION,
      fingerprint: fingerprint.value,
      head: fingerprint.head,
      tree: fingerprint.tree,
      mapVersion: fingerprint.mapVersion,
      mapChecksum: fingerprint.mapChecksum,
      gates,
    },
  };
}

/**
 * O gate está coberto se o recibo (já conferido contra o fingerprint) o
 * registra verde, com o mesmo comando, há no máximo `ttl`. Data no futuro ou
 * ilegível não cobre: relógio adiantado não pode estender a validade.
 */
export function covers(
  receipt: Receipt | null,
  gate: string,
  command: readonly string[],
  now: number,
  ttl = RECEIPT_TTL_MS,
): boolean {
  const pass = receipt?.gates[gate];
  if (!pass || pass.command !== commandKey(command)) return false;
  const at = Date.parse(pass.at);
  return Number.isFinite(at) && at <= now && now - at <= ttl;
}

/**
 * Registra o gate verde. Recibo de outro fingerprint é descartado inteiro, e
 * não mesclado: o que ele aprovou era outro código.
 */
export function recordPass(
  receipt: Receipt | null,
  fingerprint: Fingerprint,
  gate: string,
  command: readonly string[],
  seconds: number,
  now: number,
): Receipt {
  const base: Receipt =
    receipt !== null && receipt.fingerprint === fingerprint.value
      ? receipt
      : {
          schemaVersion: RECEIPT_SCHEMA_VERSION,
          fingerprint: fingerprint.value,
          head: fingerprint.head,
          tree: fingerprint.tree,
          mapVersion: fingerprint.mapVersion,
          mapChecksum: fingerprint.mapChecksum,
          gates: {},
        };
  const pass: GatePass = { status: "pass", at: new Date(now).toISOString(), seconds, command: commandKey(command) };
  return { ...base, gates: { ...base.gates, [gate]: pass } };
}

/**
 * Registra o gate vermelho: o recibo deste fingerprint sai sem ele. Gravar é
 * obrigatório mesmo sem recibo em memória (`--fresh`), porque o do disco pode
 * ainda trazer o verde antigo deste mesmo estado — e o próximo `pnpm gates`
 * pularia o gate que acabou de falhar.
 */
export function recordFail(receipt: Receipt | null, fingerprint: Fingerprint, gate: string): Receipt {
  const base: Receipt =
    receipt !== null && receipt.fingerprint === fingerprint.value
      ? receipt
      : {
          schemaVersion: RECEIPT_SCHEMA_VERSION,
          fingerprint: fingerprint.value,
          head: fingerprint.head,
          tree: fingerprint.tree,
          mapVersion: fingerprint.mapVersion,
          mapChecksum: fingerprint.mapChecksum,
          gates: {},
        };
  const { [gate]: _failed, ...gates } = base.gates;
  return { ...base, gates };
}

export type TreeEntry = { path: string; kind: "file" | "executable" | "symlink" | "deleted" | "other"; content: string | Buffer };

/**
 * Hash do que difere de HEAD: caminho, tipo e conteúdo, em ordem. Junto com o
 * HEAD, identifica a árvore inteira sem ler os arquivos que o commit já fixa.
 * Mudar só o índice (`git add`) não muda o hash — o gate validou o disco.
 */
export function treeHash(entries: readonly TreeEntry[]): string {
  const hash = createHash("sha256");
  for (const entry of [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    hash.update(`\0${entry.path}\0${entry.kind}\0`);
    hash.update(entry.content);
  }
  return hash.digest("hex");
}
