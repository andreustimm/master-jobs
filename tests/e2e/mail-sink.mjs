/**
 * Leitura do sink de e-mail do E2E (#464, ADR-011).
 *
 * O `run-isolated` declara `JHO_MAIL_SINK` (com `JHO_ENV=e2e`), e o servidor
 * grava cada mensagem como um JSON ali (`fileMailer`). A suíte lê o código do
 * cadastro e confere as boas-vindas por aqui, sem caixa de entrada real. O
 * nome do arquivo começa pelo instante, então a ordem alfabética é a de envio.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** As mensagens para `to`, na ordem de envio. Diretório ainda inexistente é lista vazia. */
export async function mailsTo(dir, to) {
  let files = [];
  try {
    files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const all = await Promise.all(files.map(async (file) => JSON.parse(await readFile(join(dir, file), "utf8"))));
  return all.filter((mail) => mail.to === to);
}

/** Espera a mensagem que satisfaz `match`, por até `timeoutMs`; `null` se não chegar. */
export async function waitForMail(dir, to, match = () => true, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = (await mailsTo(dir, to)).filter(match);
    if (found.length > 0) return found[found.length - 1];
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

/** O código de 6 dígitos de uma mensagem, ou `null`. */
export function codeIn(mail) {
  return /\b(\d{6})\b/.exec(mail?.text ?? "")?.[1] ?? null;
}
