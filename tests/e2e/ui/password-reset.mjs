// Área `password-reset` do E2E de navegador: Recuperação de senha (F-05).
// Fatiada de ui.mjs (#320); a ordem e o contexto compartilhado moram em ./index.mjs.
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { desc, inArray } from "drizzle-orm";
import { getDb } from "../../../src/core/db/client.ts";
import { authEvent } from "../../../src/core/db/schema.ts";
import { METHODS_FIXTURES } from "../account-methods-fixtures.mjs";

const UNKNOWN_EMAIL = "nao-existe-de-jeito-nenhum@local.test";

export async function run(ctx) {
  const { BASE, E2E_EMAIL, browser, check } = ctx;
  /* --------------------- Recuperação de senha (F-05) ----------------------- */

  // Percorrido de um contexto ANÔNIMO: quem esqueceu a senha não tem sessão, e
  // testar isto logado provaria outra coisa.
  const lost = await browser.newContext();
  const lostPage = await lost.newPage();
  await lost.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);

  await lostPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  check(
    "a tela de login oferece recuperar a senha",
    (await lostPage.locator('[data-testid="forgot-password"]').count()) === 1,
  );

  // Endereço que NÃO existe.
  await lostPage.goto(`${BASE}/login/forgot`, { waitUntil: "networkidle" });
  await lostPage.fill('input[name="email"]', UNKNOWN_EMAIL);
  await lostPage.locator('[data-testid="request-reset"]').click();
  await lostPage.waitForTimeout(1500);
  const unknown = {
    url: lostPage.url(),
    text: ((await lostPage.locator("main").textContent()) ?? "").trim(),
  };

  // Endereço que existe.
  await lostPage.goto(`${BASE}/login/forgot`, { waitUntil: "networkidle" });
  await lostPage.fill('input[name="email"]', E2E_EMAIL);
  await lostPage.locator('[data-testid="request-reset"]').click();
  await lostPage.waitForTimeout(1500);
  const known = {
    url: lostPage.url(),
    text: ((await lostPage.locator("main").textContent()) ?? "").trim(),
  };

  // O invariante inteiro da tela: um formulário que responde "não encontramos
  // esta conta" é um oráculo de enumeração aberto ao mundo — dá para descobrir
  // quem está cadastrado sem nunca entrar.
  check(
    "conta existente e inexistente recebem a MESMA resposta",
    unknown.url === known.url && unknown.text === known.text,
    `${unknown.url} vs ${known.url}`,
  );
  check(
    "a confirmação é redigida sem afirmar que a conta existe",
    /se existir uma conta/i.test(known.text),
    known.text.slice(0, 60),
  );

  // A comparação acima só prova G17 se os dois pedidos passaram pelo ramo que
  // CONSULTA a conta (`requestPasswordReset`). Sem origem confiável, a action
  // cai em `recordResetSendFailure`, que grava o mesmo evento para os dois
  // endereços sem olhar o cadastro — e a igualdade vira tautologia (#378).
  // `reset_requested_unknown` só nasce no ramo real.
  const events = await getDb()
    .select({ email: authEvent.email, kind: authEvent.kind, detail: authEvent.detail })
    .from(authEvent)
    .where(inArray(authEvent.email, [UNKNOWN_EMAIL, E2E_EMAIL.trim().toLowerCase()]))
    .orderBy(desc(authEvent.id));
  const lastFor = (email) => events.find((event) => event.email === email);
  const unknownEvent = lastFor(UNKNOWN_EMAIL);
  const knownEvent = lastFor(E2E_EMAIL.trim().toLowerCase());
  check(
    "o pedido de conta inexistente passou pelo ramo que consulta a conta",
    unknownEvent?.kind === "reset_requested_unknown",
    JSON.stringify(unknownEvent ?? null),
  );
  check(
    "o pedido de conta existente passou pelo ramo que consulta a conta",
    knownEvent !== undefined &&
      ["reset_requested", "reset_send_failed", "reset_rate_limited"].includes(knownEvent.kind) &&
      !/origem pública não configurada/.test(knownEvent.detail ?? ""),
    JSON.stringify(knownEvent ?? null),
  );

  // Link morto não vira 500 nem tela em branco.
  await lostPage.goto(`${BASE}/login/reset?token=nunca-existiu`, { waitUntil: "networkidle" });
  const dead = ((await lostPage.locator("main").textContent()) ?? "").trim();
  check("link de recuperação inválido explica o que fazer", /não vale mais/i.test(dead),
    dead.slice(0, 60));
  // E não oferece o formulário: um campo de senha sob um token morto convida a
  // digitar uma senha que não vai a lugar nenhum.
  check(
    "link morto não mostra o formulário de senha",
    (await lostPage.locator('input[name="password"]').count()) === 0,
  );

  await lost.close();

  /* ------------- E2E-030: o link chega por e-mail e troca a senha ---------- */

  // O e-mail sai pelo sink em arquivo do `run-isolated` (ADR-011): é a caixa
  // de entrada desta jornada. Fora dele não há onde ler o link.
  const sink = process.env.E2E_MAIL_SINK;
  if (!sink) {
    console.warn("[e2e] E2E-030 pulado: E2E_MAIL_SINK ausente (rode pelo run-isolated)");
    return;
  }
  const email = METHODS_FIXTURES.recovery.email;
  const NEW_PASSWORD = "recuperada-pelo-e2e-31";
  const recovery = await browser.newContext();
  await recovery.addCookies([{ name: "jho_locale", value: "pt-BR", url: BASE }]);
  const page = await recovery.newPage();
  await page.goto(`${BASE}/login/forgot`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', email);
  await page.locator('[data-testid="request-reset"]').click();
  await page.waitForURL((url) => url.searchParams.get("sent") === "1", { timeout: 15_000 }).catch(() => {});
  const confirmation = ((await page.locator("main").textContent()) ?? "").trim();

  const mails = (await readdir(sink).catch(() => []))
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(sink, file), "utf8")))
    .filter((mail) => mail.to === email);
  const mail = mails.at(-1);
  const link = mail?.text.match(/https?:\/\/\S+\/login\/reset\?token=\S+/)?.[0] ?? null;
  if (link) {
    await page.goto(link, { waitUntil: "networkidle" });
    await page.fill('input[name="password"]', NEW_PASSWORD);
    await page.locator('[data-testid="submit-reset"]').click();
    await page.waitForURL((url) => url.pathname === "/login" && url.searchParams.get("reset") === "1", {
      timeout: 15_000,
    }).catch(() => {});
  }
  const afterReset = page.url().replace(BASE, "");
  // Tela de login carregada e hidratada antes de digitar, como na área
  // `account`: preencher logo depois do redirect corre contra a hidratação.
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', NEW_PASSWORD);
  await page.locator('[data-testid="login-submit"]').click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 }).catch(() => {});
  check(
    "E2E-030 esqueci a senha: confirmação neutra, link do e-mail (pt-BR, uso único), senha nova e entrar com ela",
    /se existir uma conta/i.test(confirmation)
      && mail?.subject === "Recuperar o acesso ao Master Jobs"
      && link !== null
      && link.startsWith(BASE)
      && afterReset === "/login?reset=1"
      && !new URL(page.url()).pathname.startsWith("/login"),
    JSON.stringify({ subject: mail?.subject, link: link !== null, afterReset, landed: page.url().replace(BASE, "") }),
  );
  await recovery.close();
}
