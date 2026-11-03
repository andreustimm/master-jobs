// E2E-004 — disponibilidade na tela da vaga (#223, tarefa 04).
//
// Vaga nunca verificada mostra "desconhecida"; verificada viva mostra
// "disponível" com a data; checagem velha mostra "vencida"; vaga fechada por
// 404 com candidatura mostra "encerrada na origem" e o histórico da candidatura.
//
// Os vereditos entram pelo mesmo `applyVerdict` que o lote e a fila usam — só
// a sonda de rede fica de fora, e nenhum teste sonda site de terceiro.
import { eq } from "drizzle-orm";
import { setApplicationStatus } from "../../src/contexts/pursuit/index.ts";
import { getDb } from "../../src/core/db/client.ts";
import { authUser, job, source } from "../../src/core/db/schema.ts";
import { applyVerdict } from "../../src/core/ingest/verdict.ts";

async function login(browser, base, email, password) {
  // Fuso de São Paulo: o "conferido em" é o dia de quem lê, não o de UTC (#500).
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, timezoneId: "America/Sao_Paulo" });
  await context.addCookies([{ name: "jho_locale", value: "pt-BR", url: base }]);
  const page = await context.newPage();
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return { context, page };
}

const fitsPhone = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

export async function checkJobAvailability(browser, base, account, check) {
  const db = getDb();
  const [anySource] = await db.select({ id: source.id }).from(source).limit(1);
  const [user] = await db.select({ candidateId: authUser.candidateId }).from(authUser).where(eq(authUser.email, account.email));
  const created = [];
  for (const slug of ["nunca", "viva", "velha", "fechada"]) {
    const [row] = await db
      .insert(job)
      .values({
        sourceId: anySource.id,
        externalId: `e2e-disp-${slug}`,
        companyName: "Acme Disponibilidade",
        title: `Vaga E2E disponibilidade ${slug}`,
        url: `https://example.test/e2e-disp-${slug}`,
        fingerprint: `e2e-disp-${slug}-fp`,
        contentHash: `e2e-disp-${slug}-h`,
        raw: {},
      })
      .returning({ id: job.id });
    created.push(row.id);
  }
  const [nunca, viva, velha, fechada] = created;
  const today = new Date().toISOString();
  await applyVerdict({ jobId: viva, verdict: "alive", httpCode: 200, checkedAt: today });
  await applyVerdict({ jobId: velha, verdict: "alive", httpCode: 200, checkedAt: "2026-01-01T00:00:00.000Z" });
  await setApplicationStatus(user.candidateId, fechada, "applied", "e2e disponibilidade");
  await applyVerdict({ jobId: fechada, verdict: "gone", httpCode: 404, checkedAt: today });

  const { context, page } = await login(browser, base, account.email, account.password);
  try {
    const state = async (id) => {
      await page.goto(`${base}/jobs/${id}`, { waitUntil: "networkidle" });
      const line = page.getByTestId("job-availability");
      return {
        state: await line.getAttribute("data-availability"),
        reason: await line.getAttribute("data-reason"),
        text: await line.innerText(),
        // A data da última checagem: o instante gravado, o que a tela mostra e
        // o dia desse instante em São Paulo e em UTC (#500).
        checked: await page.evaluate(() => {
          const time = document.querySelector('[data-testid="job-checked-at"]');
          if (!time) return null;
          const iso = time.getAttribute("datetime") ?? "";
          const format = (timeZone) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone }).format(new Date(iso));
          return { iso, shown: time.textContent, local: format("America/Sao_Paulo"), utc: format("UTC") };
        }),
      };
    };

    const never = await state(nunca);
    check("E2E-004 vaga nunca verificada mostra desconhecida", never.state === "unknown" && never.text.includes("nunca conferido"), JSON.stringify(never));

    const alive = await state(viva);
    check("E2E-004 vaga verificada mostra disponível com a última checagem, no dia de quem lê",
      alive.state === "open" && alive.checked?.iso === today && alive.checked.shown === alive.checked.local
        && alive.text.includes(alive.checked.local),
      JSON.stringify(alive));
    await page.reload({ waitUntil: "networkidle" });
    check("E2E-004 disponibilidade sobrevive a refresh",
      (await page.getByTestId("job-availability").getAttribute("data-availability")) === "open");

    const stale = await state(velha);
    check("E2E-004 checagem velha mostra vencida, não disponível", stale.state === "stale", JSON.stringify(stale));
    // E2E-500: 00:00 UTC de 1/1 é 21:00 de 31/12 em São Paulo; em UTC o dia sairia um adiante.
    check("E2E-500 'conferido em' mostra o dia no fuso de quem lê, não em UTC",
      stale.checked?.shown === stale.checked?.local && stale.checked?.local !== stale.checked?.utc
        && stale.checked?.iso === "2026-01-01T00:00:00.000Z",
      JSON.stringify(stale.checked));

    const closed = await state(fechada);
    check("E2E-004 vaga fechada com candidatura: encerrada e histórico visível",
      closed.state === "closed" && closed.reason === "closed" && (await page.getByTestId("application-timeline").count()) === 1, JSON.stringify(closed));
    check("E2E-004 cabe em 375 px", await fitsPhone(page));
  } finally {
    await context.close();
    // As vagas são desta verificação; as seguintes contam vagas do acervo.
    // Eventos e a candidatura de teste saem junto, em cascata.
    for (const id of created) await db.delete(job).where(eq(job.id, id));
  }
}
