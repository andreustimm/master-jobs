/**
 * `JHO_ENV` como o `next dev` o veria — e se `pnpm dev` precisa declará-lo.
 *
 * `isLocalProcess()` exige o sinal positivo (#378), e `next dev` só roda na
 * máquina de quem desenvolve — então `pnpm dev` (`scripts/dev.ts`) pode
 * declarar `JHO_ENV=local` sozinho. Mas não por cima de uma declaração: o
 * Next nunca sobrescreve variável que já está no processo, e um valor posto
 * pelo script venceria o `.env`. Aqui a declaração existente vence, na ordem
 * em que o Next carrega em desenvolvimento: processo,
 * `.env.development.local`, `.env.local`, `.env.development`, `.env`. Só a
 * ausência total vira `local`.
 *
 * Mora em `src/` porque dois chamadores precisam da MESMA resposta: o
 * `scripts/dev.ts`, que decide, e o `jho auth status`, que avisa quando o
 * `pnpm dev` abriria o modo aberto que a CLI recusa.
 *
 * Declarada vazia continua declarada: quem escreveu `JHO_ENV=` pediu isso.
 */
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

export const NEXT_DEV_ENV_FILES = [".env.development.local", ".env.local", ".env.development", ".env"] as const;

export type ReadFile = (path: string) => string | undefined;

const readIfExists: ReadFile = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
};

/** `JHO_ENV` como o Next o veria em `next dev`, ou `undefined` se ninguém declara. */
export function declaredJhoEnv(
  env: Readonly<Record<string, string | undefined>>,
  read: ReadFile = readIfExists,
): string | undefined {
  if (env.JHO_ENV !== undefined) return env.JHO_ENV;
  for (const file of NEXT_DEV_ENV_FILES) {
    const contents = read(file);
    if (contents === undefined) continue;
    const parsed = parseEnv(contents);
    if (Object.hasOwn(parsed, "JHO_ENV")) return parsed.JHO_ENV;
  }
  return undefined;
}

/** O ambiente do `next dev`: o mesmo, mais `JHO_ENV=local` se ninguém declarou. */
export function devEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  read: ReadFile = readIfExists,
): Record<string, string | undefined> {
  return declaredJhoEnv(env, read) === undefined ? { ...env, JHO_ENV: "local" } : { ...env };
}
