import { en } from "../../src/core/i18n/en.ts";
import { ptBR } from "../../src/core/i18n/pt-BR.ts";

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
  // Acentuado de propósito (G30): a varredura de inglês sem sessão
  // (`ENGLISH_ANONYMOUS_SWEEP`) só passa aqui porque `data-user-content`
  // isenta o texto da pessoa — sem acento em lugar nenhum, uma regressão que
  // apagasse a marca passaria batido.
  name: "André Formatado",
  email: "cv-formatado@local.test",
  headline: "Arquiteto de Soluções em IA",
  location: "São Paulo, Brazil",
  linkedinUrl: "https://www.linkedin.com/in/e2e-perfil-formatado",
  githubUrl: "https://github.com/e2e-perfil-formatado",
  // Ordem de exibição esperada dentro do grupo `language` (occurrences desc,
  // nome asc no empate): TypeScript, Go, Python, Rust, Java, Kotlin — top 6 —
  // e Elixir, Scala atrás do "+2". `level` do TypeScript é de propósito longo
  // e sem quebra natural: prova que o badge quebra linha em vez de estourar a
  // largura em 375px (`OVERFLOW_SWEEP` já visita esta rota).
  skills: Object.freeze([
    {
      name: "TypeScript",
      category: "language",
      occurrences: 5,
      level: "especialista sênior, anos de experiência em produção de alta criticidade",
    },
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
  // #327: os sete fatos, todos com o opt-in LIGADO. Área e idiomas
  // acentuados (G30): só `data-user-content` os deixa passar pela varredura de
  // inglês sem sessão. `setup.mjs` grava as catorze colunas.
  facts: Object.freeze({
    workModel: ["remote", "b2b"],
    experienceLevel: "principal",
    availability: "open",
    startTimeframe: "one-month",
    openToRelocation: false,
    area: "Arquitetura de software e IA",
    languages: "Português (nativo), Inglês (fluente)",
  }),
  factsPublic: true,
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
    // Acentuado (G30): prova que o micro-rótulo da seção (dado do usuário, ao
    // lado do título fixo traduzido) sobrevive intacto à varredura de inglês.
    "FORMAÇÃO",
    "Bacharelado em Ciência da Computação",
  ].join("\n"),
});

/**
 * #327: um segundo candidato público com os MESMOS sete valores gravados e
 * todos os opt-ins DESLIGADOS. Sentinelas próprias (texto que só existe
 * aqui), para que "ausente do HTML" não passe por acaso nem reprove por texto
 * de outro lugar da página.
 */
export const PUBLIC_FACTS_OFF_FIXTURE = Object.freeze({
  slug: "e2e-fatos-desligados",
  name: "Bruna Discreta",
  email: "fatos-desligados@local.test",
  facts: Object.freeze({
    workModel: ["hybrid", "contractor"],
    experienceLevel: "staff",
    availability: "actively-looking",
    startTimeframe: "two-weeks",
    openToRelocation: true,
    area: "Sentinela de área desligada",
    languages: "Sentinela de idiomas desligados",
  }),
  factsPublic: false,
});

/** As catorze colunas de `candidate` de uma fixture: os sete valores e o mesmo opt-in em todos. */
export function factColumns(fixture) {
  const on = fixture.factsPublic;
  return {
    ...fixture.facts,
    workModel: [...fixture.facts.workModel],
    publicWorkModel: on,
    publicExperienceLevel: on,
    publicAvailability: on,
    publicStartTimeframe: on,
    publicRelocation: on,
    publicArea: on,
    publicLanguages: on,
  };
}

export async function checkPublicCvFormat(browser, base, check) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  try {
    const page = await context.newPage();
    const response = await page.goto(`${base}/p/${PUBLIC_CV_FIXTURE.slug}`, { waitUntil: "networkidle" });
    // #326: o CV completo agora mora atrás de um `<details>` recolhido por
    // padrão, e conteúdo colapsado não entra no `scrollWidth` (a UA aplica
    // `display: none`) — medir overflow ANTES de abrir provaria só o hero e
    // os cards, nunca o currículo inteiro que é o alvo original deste teste.
    await page.locator('[data-testid="public-cv-full"] summary').click();
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
        && ["SUMMARY", "CORE EXPERTISE", "PROFESSIONAL EXPERIENCE", "FORMAÇÃO"].every((h) => shape.headings.includes(h))
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
        const mainColumn = main?.querySelector('[data-testid="public-profile-main"]');
        const skillsAside = main?.querySelector('[data-testid="public-profile-skills"]');
        const groups = [...(main?.querySelectorAll('[data-testid="public-skill-group"]') ?? [])];
        const cvFull = main?.querySelector('[data-testid="public-cv-full"]');
        const sectionCards = ["summary", "experience", "education"].map(
          (kind) => Boolean(main?.querySelector(`[data-testid="public-section-${kind}"]`)),
        );
        const longLevelBadge = [...(main?.querySelectorAll('[data-user-content]') ?? [])]
          .find((n) => n.textContent?.startsWith("TypeScript"));
        const rect = (el) => el?.getBoundingClientRect();
        return {
          heroRect: rect(main?.querySelector("h1")),
          mainRect: rect(mainColumn),
          skillsRect: rect(skillsAside),
          linkedinHref: linkedin?.getAttribute("href") ?? null,
          linkedinTop: rect(linkedin)?.top ?? null,
          githubHref: github?.getAttribute("href") ?? null,
          groupCount: groups.length,
          cvFullOpen: cvFull?.hasAttribute("open") ?? null,
          sectionCards,
          longLevelBadgeWhiteSpace: longLevelBadge ? getComputedStyle(longLevelBadge).whiteSpace : null,
          longLevelBadgeWidth: rect(longLevelBadge)?.width ?? null,
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
        "#326 375px: uma coluna — skills abaixo do FIM do conteúdo principal, mesmo início horizontal",
        shape.mainRect !== undefined
          && shape.skillsRect !== undefined
          // Tolerância de 1px: arredondamento de subpixel entre o fim de um
          // elemento e o começo do próximo na mesma coluna.
          && shape.skillsRect.top >= shape.mainRect.bottom - 1
          && Math.abs(shape.skillsRect.left - shape.mainRect.left) <= 1,
        JSON.stringify({ main: shape.mainRect, skills: shape.skillsRect }),
      );
      check(
        "#326 os três cards de seção aparecem (Resumo, Experiência, Formação) — a fixture tem as três",
        shape.sectionCards.every(Boolean),
        JSON.stringify(shape.sectionCards),
      );
      check(
        "#326 duas categorias de skill aparecem (ai, language), CV completo recolhido por padrão",
        shape.groupCount === 2 && shape.cvFullOpen === false,
        JSON.stringify(shape),
      );
      check(
        "#326 375px: nível longo quebra linha (badge não é largo o bastante pra estourar a tela)",
        shape.longLevelBadgeWhiteSpace !== null
          && shape.longLevelBadgeWhiteSpace !== "nowrap"
          && (shape.longLevelBadgeWidth ?? 0) < 375,
        JSON.stringify({ whiteSpace: shape.longLevelBadgeWhiteSpace, width: shape.longLevelBadgeWidth }),
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
        // #327: a lateral leva "Em resumo" ACIMA das skills; medir as skills
        // contra o h1 passou a depender da altura do resumo. Mede-se a
        // lateral inteira contra a coluna principal: mesmo topo, à direita.
        const aside = main?.querySelector('[data-testid="public-profile-aside"]');
        const mainColumn = main?.querySelector('[data-testid="public-profile-main"]');
        const rect = (el) => el?.getBoundingClientRect();
        const badgeText = (group) => [...group.querySelectorAll('[data-user-content]')].map((n) => n.textContent?.trim());
        return {
          asideRect: rect(aside),
          mainRect: rect(mainColumn),
          firstGroupBadges: badgeText(groups[0]),
          uppercaseBadge: groups[1]
            ? getComputedStyle(groups[1].querySelector('[data-user-content]')).textTransform
            : null,
        };
      });
      // Alfabética pela CHAVE: "ai" vem antes de "language".
      const aiIsFirst = (shape.firstGroupBadges ?? []).some((t) => t?.includes("LangGraph"));
      check(
        "#326 ≥1024px: lateral (resumo + skills) ao lado do conteúdo principal (duas colunas)",
        shape.asideRect !== undefined
          && shape.mainRect !== undefined
          // Mesma linha do grid: topo igual (1px de subpixel) e a lateral
          // começa depois do fim da coluna principal.
          && Math.abs(shape.asideRect.top - shape.mainRect.top) <= 1
          && shape.asideRect.left >= shape.mainRect.right,
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

/**
 * #327: fatos opt-in no HTML de `/p/<slug>`.
 *
 * Ligado: cada fato de `PUBLIC_CV_FIXTURE.facts` aparece no lugar certo —
 * modelo, nível e disponibilidade na faixa do topo; área, idiomas, prazo e
 * aceita mudar no "Em resumo". Desligado: `PUBLIC_FACTS_OFF_FIXTURE` tem os
 * mesmos sete gravados e NADA deles chega ao HTML — nem valor, nem rótulo,
 * nem o cartão. Os rótulos são comparados contra os dois dicionários, porque
 * o idioma da página depende do navegador e não é o que se mede aqui.
 */
export async function checkPublicFacts(browser, base, check) {
  const both = (key) => [ptBR.publicFacts[key], en.publicFacts[key]];
  const FACT_KEYS = ["workModel", "experienceLevel", "availability", "startTimeframe", "openToRelocation", "area", "languages"];
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  try {
    const page = await context.newPage();

    const on = await page.goto(`${base}/p/${PUBLIC_CV_FIXTURE.slug}`, { waitUntil: "networkidle" });
    const shown = await page.evaluate((keys) => {
      const main = document.querySelector('[data-testid="route-public-profile"]');
      const strip = main?.querySelector('[data-testid="public-profile-facts"]');
      const glance = main?.querySelector('[data-testid="public-profile-glance"]');
      const item = (root, key) => {
        const node = root?.querySelector(`[data-testid="public-fact-${key}"]`);
        if (!node) return null;
        return {
          label: node.querySelector("dt")?.textContent?.trim() ?? "",
          value: node.querySelector("dd")?.textContent?.trim() ?? "",
          userContent: node.querySelector("dd")?.hasAttribute("data-user-content") ?? false,
        };
      };
      return {
        strip: Object.fromEntries(keys.map((key) => [key, item(strip, key)])),
        glance: Object.fromEntries(keys.map((key) => [key, item(glance, key)])),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    }, FACT_KEYS);
    const { facts } = PUBLIC_CV_FIXTURE;
    const inStrip = ["workModel", "experienceLevel", "availability"];
    const inGlance = ["area", "languages", "startTimeframe", "openToRelocation"];
    check(
      "#327 ligado: modelo, nível e disponibilidade na faixa de fatos, com rótulo do dicionário",
      on?.status() === 200
        && inStrip.every((key) => shown.strip[key] && both(key).includes(shown.strip[key].label))
        && inStrip.every((key) => shown.glance[key] === null)
        && [ptBR.publicFacts.levelPrincipal, en.publicFacts.levelPrincipal].includes(shown.strip.experienceLevel?.value)
        && [ptBR.publicFacts.availabilityOpen, en.publicFacts.availabilityOpen].includes(shown.strip.availability?.value)
        && [ptBR.publicFacts.workModelB2b, en.publicFacts.workModelB2b].some((label) => shown.strip.workModel?.value.includes(label)),
      JSON.stringify(shown.strip),
    );
    check(
      "#327 ligado: área, idiomas, prazo e aceita mudar em \"Em resumo\"; texto da pessoa marcado como dado do usuário",
      inGlance.every((key) => shown.glance[key] && both(key).includes(shown.glance[key].label))
        && inGlance.every((key) => shown.strip[key] === null)
        && shown.glance.area?.value === facts.area
        && shown.glance.area?.userContent === true
        && shown.glance.languages?.value === facts.languages
        && shown.glance.languages?.userContent === true
        && [ptBR.publicFacts.startOneMonth, en.publicFacts.startOneMonth].includes(shown.glance.startTimeframe?.value)
        && [ptBR.publicFacts.no, en.publicFacts.no].includes(shown.glance.openToRelocation?.value),
      JSON.stringify(shown.glance),
    );
    check("#327 375px: faixa e resumo cheios sem rolagem horizontal", shown.overflow <= 1, String(shown.overflow));

    const off = await page.goto(`${base}/p/${PUBLIC_FACTS_OFF_FIXTURE.slug}`, { waitUntil: "networkidle" });
    const hidden = await page.evaluate(() => {
      const main = document.querySelector('[data-testid="route-public-profile"]');
      return {
        found: Boolean(main),
        html: document.documentElement.outerHTML,
        text: main?.textContent ?? "",
        factNodes: main?.querySelectorAll('[data-testid^="public-fact-"]').length ?? -1,
        glance: Boolean(main?.querySelector('[data-testid="public-profile-glance"]')),
        strip: Boolean(main?.querySelector('[data-testid="public-profile-facts"]')),
      };
    });
    const offFacts = PUBLIC_FACTS_OFF_FIXTURE.facts;
    const valueSentinels = [
      offFacts.area,
      offFacts.languages,
      ...both("workModelContractor"),
      ...both("levelStaff"),
      ...both("availabilityActivelyLooking"),
      ...both("startTwoWeeks"),
    ];
    const labelSentinels = [...FACT_KEYS.flatMap(both), ...both("glance")];
    const valueLeaks = valueSentinels.filter((term) => hidden.html.includes(term));
    const labelLeaks = labelSentinels.filter((term) => hidden.text.includes(term));
    check(
      "#327 desligado: nenhum dos sete fatos gravados chega ao HTML — nem valor, nem rótulo, nem cartão",
      off?.status() === 200
        && hidden.found
        && hidden.factNodes === 0
        && !hidden.glance
        && !hidden.strip
        && valueLeaks.length === 0
        && labelLeaks.length === 0,
      JSON.stringify({ status: off?.status(), ...hidden, html: undefined, text: hidden.text.slice(0, 200), valueLeaks, labelLeaks }),
    );
  } finally {
    await context.close();
  }
}
