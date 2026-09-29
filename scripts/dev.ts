/**
 * `pnpm dev`: declara `JHO_ENV=local` só quando ninguém declarou nada.
 *
 * `isLocalProcess()` exige o sinal positivo (#378), e `next dev` só roda na
 * máquina de quem desenvolve — então o script pode declará-lo sozinho. Mas um
 * `JHO_ENV=${JHO_ENV:-local}` no shell passaria por cima do `.env`: o Next
 * nunca sobrescreve variável que já está no processo, e o shell não lê o
 * `.env`. Aqui a declaração existente vence, na mesma ordem em que o Next a
 * carregaria em desenvolvimento: processo, `.env.development.local`,
 * `.env.local`, `.env.development`, `.env`. Só a ausência total vira `local`.
 *
 * Declarada vazia continua declarada: quem escreveu `JHO_ENV=` pediu isso.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
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

/** O ambiente do filho: o mesmo, mais `JHO_ENV=local` se ninguém declarou. */
export function devEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  read: ReadFile = readIfExists,
): Record<string, string | undefined> {
  return declaredJhoEnv(env, read) === undefined ? { ...env, JHO_ENV: "local" } : { ...env };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    console.error("uso: node scripts/dev.ts <comando> [args...]");
    process.exit(2);
  }
  const child = spawn(command, args, { stdio: "inherit", env: devEnvironment(process.env) as NodeJS.ProcessEnv });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
}
