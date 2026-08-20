/**
 * Password hashing with scrypt.
 *
 * Pure except for the CSPRNG. No dependency: Node ships scrypt, and it is a
 * memory-hard KDF designed for exactly this — unlike SHA-256, which is fast and
 * therefore terrible at protecting a low-entropy secret.
 *
 * A session token gets plain SHA-256 elsewhere in this context, and that is not
 * an inconsistency: a 256-bit random token has no structure to attack, so an
 * expensive KDF would buy latency and nothing else. A human password has very
 * little entropy and needs the work factor.
 *
 * Format: `scrypt$N$r$p$salt$hash`, all base64url. The parameters travel with
 * the hash so they can be raised later without invalidating existing accounts.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

/** OWASP-aligned for interactive login: ~64 MB, well under a second. */
const N = 2 ** 16;
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALT_BYTES = 16;

export const MIN_LENGTH = 12;

function b64(buf: Buffer): string {
  return buf.toString("base64url");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  // `maxmem` must be raised explicitly; Node's default rejects N this large.
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scryptCb(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 256 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
  return `scrypt$${N}$${R}$${P}$${b64(salt)}$${b64(derived)}`;
}

/**
 * Verifies a password against a stored hash.
 *
 * Always returns a boolean, never throws on a malformed stored value — a parse
 * error must read as "wrong password", not as a 500 that tells an attacker the
 * account exists.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4]!, "base64url");
    expected = Buffer.from(parts[5]!, "base64url");
  } catch {
    return false;
  }

  // Um hash com tamanho errado não é um hash. Rejeitar aqui, ANTES de derivar.
  //
  // Este é o defeito que esta linha corrige, e ele falhava ABERTO: o `keylen`
  // do scrypt vinha de `expected.length` — o tamanho do que estava GRAVADO, não
  // a constante. Um `password_hash` cujo campo final estivesse vazio ou com um
  // caractere produzia um buffer de zero bytes, o KDF devolvia zero bytes, e
  // `timingSafeEqual(vazio, vazio)` é verdadeiro: **qualquer senha entrava**.
  // Com dois caracteres o KDF virava uma comparação de 1 em 256.
  //
  // Exige escrita na coluna — migração malfeita, importação, correção manual em
  // SQL —, mas o modo de falha estava invertido. Dado corrompido numa coluna de
  // senha tem de negar acesso, nunca concedê-lo.
  if (expected.length !== KEYLEN) return false;

  try {
    const derived = await new Promise<Buffer>((resolve, reject) => {
      // `KEYLEN`, a constante, e não o tamanho do valor gravado. O que está no
      // banco é a coisa que se está verificando; usá-lo como parâmetro do
      // próprio verificador é deixar o atacante escolher a régua.
      scryptCb(password, salt, KEYLEN, { N: n, r, p, maxmem: 256 * 1024 * 1024 }, (err, key) =>
        err ? reject(err) : resolve(key),
      );
    });
    // Constant-time: a fast reject leaks how much of the hash matched.
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export type PasswordProblem = { ok: false; reason: string } | { ok: true };

/**
 * Minimum viable policy: length, and nothing else.
 *
 * Composition rules ("one symbol, one digit") push people toward `Password1!`
 * and are worse than length. NIST dropped them for that reason.
 */
export function checkPassword(password: string): PasswordProblem {
  if (password.length < MIN_LENGTH) {
    return { ok: false, reason: `Mínimo de ${MIN_LENGTH} caracteres.` };
  }
  if (password.length > 1024) {
    return { ok: false, reason: "Longa demais." };
  }
  return { ok: true };
}
