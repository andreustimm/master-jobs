/**
 * `pnpm dev`: roda o comando com `JHO_ENV=local` só quando ninguém declarou
 * `JHO_ENV` — a regra mora em `src/core/dev-env.ts`.
 *
 * É um processo intermediário, então repassa os sinais: sem isso, um `kill`
 * no wrapper (o que `pnpm`, um supervisor ou um harness de teste mandam)
 * mataria só ele e deixaria o `next dev` órfão, ainda escutando em
 * 127.0.0.1:3000.
 */
import { spawn } from "node:child_process";
import { devEnvironment } from "../src/core/dev-env.ts";

const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("uso: node scripts/dev.ts <comando> [args...]");
  process.exit(2);
}

const child = spawn(command, args, { stdio: "inherit", env: devEnvironment(process.env) as NodeJS.ProcessEnv });

const forward = (signal: NodeJS.Signals) => () => {
  child.kill(signal);
};
for (const signal of FORWARDED_SIGNALS) process.on(signal, forward(signal));

child.on("error", (error) => {
  console.error(`dev: não foi possível iniciar ${command}: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  // Sai do mesmo jeito que o filho: com o sinal, se ele morreu por um. Os
  // repasses saem antes, para o sinal enviado a si mesmo ter o efeito padrão.
  for (const forwarded of FORWARDED_SIGNALS) process.removeAllListeners(forwarded);
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
