/**
 * #325: o currículo importado de PDF, visto por quem não tem sessão em
 * `/p/<slug>`, sai com seções e listas — e continua sem contato nem piso.
 *
 * Fixture própria, sem conta: nenhum outro cenário lê este candidato, e o
 * texto imita o que `cleanPdfText` gravava antes de #325 (título em caixa alta
 * sem `#`, itens com `●` colados na mesma linha). O documento fica gravado
 * como texto; a forma nasce na leitura.
 */
export const PUBLIC_CV_FIXTURE = Object.freeze({
  slug: "e2e-cv-formatado",
  name: "Perfil Formatado",
  email: "cv-formatado@local.test",
  content: [
    "PERFIL FORMATADO",
    "cv-formatado@local.test · +55 11 91234-5678",
    "SUMMARY",
    "Arquiteto de software em São Paulo com 20 anos em plataformas distribuídas.",
    "Liderou times em três países.",
    "CORE EXPERTISE",
    "● Arquitetura de software ● Sistemas orientados a eventos",
    "● Aplicações com LLM",
    "PROFESSIONAL EXPERIENCE",
    "Principal Architect | Example Corp | 2020–2026",
    "● Desenhou a plataforma de ingestão de 4M eventos por dia.",
    "● Reduziu o custo de infraestrutura em 30%.",
    "",
    "PRETENSÃO SALARIAL",
    "USD 15,000/month",
    "",
    "EDUCATION",
    "Bacharelado em Ciência da Computação",
  ].join("\n"),
});

export async function checkPublicCvFormat(browser, base, check) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  try {
    const page = await context.newPage();
    const response = await page.goto(`${base}/p/${PUBLIC_CV_FIXTURE.slug}`, { waitUntil: "networkidle" });
    const shape = await page.evaluate(() => {
      const main = document.querySelector('[data-testid="route-public-profile"]');
      const cv = main?.querySelector('[data-testid="public-cv"]');
      return {
        found: Boolean(cv),
        headings: [...(cv?.querySelectorAll("h2") ?? [])].map((h) => h.textContent?.trim() ?? ""),
        items: cv?.querySelectorAll("li").length ?? 0,
        longestParagraph: Math.max(0, ...[...(cv?.querySelectorAll("p") ?? [])].map((p) => p.textContent?.length ?? 0)),
        stray: /[●■]/.test(cv?.textContent ?? ""),
        text: main?.textContent ?? "",
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    check(
      "#325 CV do PDF em /p/<slug> sai com h2 e li, sem parágrafo gigante nem glifo solto",
      response?.status() === 200
        && shape.found
        && ["SUMMARY", "CORE EXPERTISE", "PROFESSIONAL EXPERIENCE", "EDUCATION"].every((h) => shape.headings.includes(h))
        && shape.items === 5
        && shape.longestParagraph <= 600
        && !shape.stray
        && shape.overflow <= 1,
      JSON.stringify({ status: response?.status(), ...shape, text: undefined }),
    );
    check(
      "#325 a forma nova não reabre contato nem piso no CV público",
      shape.found
        && ![PUBLIC_CV_FIXTURE.email, "91234-5678", "15,000", "PRETENSÃO"].some((term) => shape.text.includes(term)),
      shape.text.slice(0, 300),
    );
  } finally {
    await context.close();
  }
}
