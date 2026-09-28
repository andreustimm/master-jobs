/**
 * #325: o currículo importado de PDF, visto por quem não tem sessão em
 * `/p/<slug>`, sai com seções e listas — e continua sem contato nem piso.
 *
 * Fixture própria, sem conta: nenhum outro cenário lê este candidato, e o
 * texto imita o que `cleanPdfText` gravava antes de #325 (título em caixa alta
 * sem `#`, itens com `●` colados na mesma linha). O documento fica gravado
 * como texto; a forma nasce na leitura.
 *
 * #326 reaproveita o MESMO candidato para o layout: hero (headline,
 * localização, LinkedIn, GitHub) e skills confirmadas em duas categorias —
 * `language` com 8 (para forçar o "+2" recolhido além do topo 6) e `ai` com 2
 * (grupo sem "+N", sempre visível inteiro). `setup.mjs` grava os dois.
 */
export const PUBLIC_CV_FIXTURE = Object.freeze({
  slug: "e2e-cv-formatado",
  name: "Perfil Formatado",
  email: "cv-formatado@local.test",
  headline: "Senior AI Software Architect",
  location: "São Paulo, Brazil",
  linkedinUrl: "https://www.linkedin.com/in/e2e-perfil-formatado",
  githubUrl: "https://github.com/e2e-perfil-formatado",
  // Ordem de exibição esperada dentro do grupo `language` (occurrences desc,
  // nome asc no empate): TypeScript, Go, Python, Rust, Java, Kotlin — top 6 —
  // e Elixir, Scala atrás do "+2".
  skills: Object.freeze([
    { name: "TypeScript", category: "language", occurrences: 5 },
    { name: "Go", category: "language", occurrences: 4 },
    { name: "Rust", category: "language", occurrences: 3 },
    { name: "Python", category: "language", occurrences: 3 },
    { name: "Java", category: "language", occurrences: 2 },
    { name: "Kotlin", category: "language", occurrences: 2 },
    { name: "Elixir", category: "language", occurrences: 1 },
    { name: "Scala", category: "language", occurrences: 1, level: "intermediário" },
    { name: "LangGraph", category: "ai", occurrences: 3 },
    { name: "RAG", category: "ai", occurrences: 2 },
  ]),
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

/**
 * #326: hero, duas colunas a partir de 1024px, skills agrupadas com "+N"
 * recolhido e CV completo atrás de `<details>` — no mesmo candidato de
 * `checkPublicCvFormat`, que já carrega headline, localização, links e as
 * skills confirmadas descritas em `PUBLIC_CV_FIXTURE.skills`.
 */
export async function checkPublicProfileLayout(browser, base, check) {
  const url = `${base}/p/${PUBLIC_CV_FIXTURE.slug}`;

  {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    try {
      const page = await context.newPage();
      const response = await page.goto(url, { waitUntil: "networkidle" });
      const shape = await page.evaluate(() => {
        const main = document.querySelector('[data-testid="route-public-profile"]');
        const linkedin = main?.querySelector('[data-testid="public-profile-linkedin"]');
        const github = main?.querySelector('[data-testid="public-profile-github"]');
        const skillsAside = main?.querySelector('[data-testid="public-profile-skills"]');
        const groups = [...(main?.querySelectorAll('[data-testid="public-skill-group"]') ?? [])];
        const cvFull = main?.querySelector('[data-testid="public-cv-full"]');
        const rect = (el) => el?.getBoundingClientRect();
        return {
          heroRect: rect(main?.querySelector("h1")),
          skillsRect: rect(skillsAside),
          linkedinHref: linkedin?.getAttribute("href") ?? null,
          linkedinTop: rect(linkedin)?.top ?? null,
          githubHref: github?.getAttribute("href") ?? null,
          groupCount: groups.length,
          cvFullOpen: cvFull?.hasAttribute("open") ?? null,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      check(
        "#326 375px: hero e CTA do LinkedIn acima da dobra, sem rolagem horizontal",
        response?.status() === 200
          && shape.linkedinHref === PUBLIC_CV_FIXTURE.linkedinUrl
          && shape.githubHref === PUBLIC_CV_FIXTURE.githubUrl
          && shape.linkedinTop !== null
          && shape.linkedinTop < 812
          && shape.overflow <= 1,
        JSON.stringify(shape),
      );
      check(
        "#326 375px: uma coluna — skills abaixo do conteúdo principal, não ao lado",
        shape.heroRect !== undefined
          && shape.skillsRect !== undefined
          && shape.skillsRect.top > shape.heroRect.top,
        JSON.stringify({ hero: shape.heroRect, skills: shape.skillsRect }),
      );
      check(
        "#326 duas categorias de skill aparecem (ai, language), CV completo recolhido por padrão",
        shape.groupCount === 2 && shape.cvFullOpen === false,
        JSON.stringify(shape),
      );
    } finally {
      await context.close();
    }
  }

  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "networkidle" });
      const shape = await page.evaluate(() => {
        const main = document.querySelector('[data-testid="route-public-profile"]');
        const groups = [...(main?.querySelectorAll('[data-testid="public-skill-group"]') ?? [])];
        const skillsAside = main?.querySelector('[data-testid="public-profile-skills"]');
        const rect = (el) => el?.getBoundingClientRect();
        const badgeText = (group) => [...group.querySelectorAll('[data-user-content]')].map((n) => n.textContent?.trim());
        return {
          skillsRect: rect(skillsAside),
          heroRect: rect(main?.querySelector("h1")),
          firstGroupBadges: badgeText(groups[0]),
          uppercaseBadge: groups[1]
            ? getComputedStyle(groups[1].querySelector('[data-user-content]')).textTransform
            : null,
        };
      });
      // Alfabética pela CHAVE: "ai" vem antes de "language".
      const aiIsFirst = (shape.firstGroupBadges ?? []).some((t) => t?.includes("LangGraph"));
      check(
        "#326 ≥1024px: skills ao lado do conteúdo principal (duas colunas)",
        shape.skillsRect !== undefined
          && shape.heroRect !== undefined
          && Math.abs(shape.skillsRect.top - shape.heroRect.top) < 400
          && shape.skillsRect.left > shape.heroRect.left,
        JSON.stringify(shape),
      );
      check(
        "#326 categorias em ordem alfabética da chave: ai antes de language",
        aiIsFirst,
        JSON.stringify(shape.firstGroupBadges),
      );
      check(
        "#326 skill sem caixa alta forçada no badge",
        shape.uppercaseBadge !== "uppercase",
        String(shape.uppercaseBadge),
      );

      // Expande o "+2" do grupo `language` e confere as 2 skills que sobraram.
      const more = page.locator('[data-testid="public-skill-more"]');
      await more.click();
      const expanded = await page.evaluate(() => {
        const groups = [...document.querySelectorAll('[data-testid="public-skill-group"]')];
        const language = groups.find((g) => g.textContent?.includes("Elixir"));
        return language ? [...language.querySelectorAll('[data-user-content]')].map((n) => n.textContent?.trim()) : [];
      });
      check(
        "#326 \"+2\" expande e revela Elixir e Scala (com o nível confirmado)",
        expanded.some((t) => t === "Elixir") && expanded.some((t) => t?.includes("Scala") && t.includes("intermediário")),
        JSON.stringify(expanded),
      );
    } finally {
      await context.close();
    }
  }
}
