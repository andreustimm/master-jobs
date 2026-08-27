#!/usr/bin/env node
/**
 * Gate pós-deploy: prova que o CSS servido em produção é da mesma geração do
 * HTML.
 *
 * ## O defeito que isto impede de voltar
 *
 * Em 2026-08-26 a produção serviu HTML da v1.3.7 com CSS da era v1.0.0: o
 * deploy do Vercel completou verde, mas o build compilou a folha de estilo de
 * uma geração antiga (cache de build reaproveitado). O seletor de safe-area
 * desse CSS mirava `body > header`, que não existe mais desde que o cabeçalho
 * entrou no `#application-shell` — resultado: a PWA no iPhone nasceu com a
 * marca sob a barra de status, e quatro correções corretas "não funcionaram"
 * porque nenhuma delas chegou ao aparelho.
 *
 * O CI roda contra o build local, onde HTML e CSS estão sempre em sincronia —
 * nada dele teria visto isso. Este script olha o que está no ar: baixa o HTML,
 * extrai as folhas de estilo e exige um marcador de cada geração de regra de
 * que o cabeçalho precisa. Faltou um marcador, o deploy não conta como bom.
 *
 * Uso: node scripts/check-deployed-css.mjs [base-url]
 *      (padrão: produção; DEPLOY_URL para staging/dev)
 */

const BASE = (
  process.argv[2] ??
  process.env.DEPLOY_URL ??
  "https://jobs.mastertimm.com.br"
).replace(/\/$/, "");

const MARKERS = [
  // Piso de safe-area para launcher que entrega inset 0 (BUG-20260825).
  "--safe-area-top-floor",
  // Padrão de área segura ligado aos insets informados pelo aparelho.
  "safe-area-inset-top",
  // Navegação responsiva medida (PRs #58 e #61).
  "data-responsive-nav",
  // Shell determinístico de largura integral com calha fixa (issue-topo).
  "1760px",
];

const page = await fetch(`${BASE}/login`, { redirect: "follow" });
if (!page.ok) {
  console.error(`check-deployed-css: ${BASE}/login respondeu ${page.status}`);
  process.exit(1);
}
const html = await page.text();
const hrefs = [...html.matchAll(/href="(\/[^"]*?\.css[^"]*)"/g)].map((m) => m[1]);
if (hrefs.length === 0) {
  console.error("check-deployed-css: nenhuma folha de estilo referenciada no HTML servido");
  process.exit(1);
}

let css;
try {
  css = (
    await Promise.all(
      hrefs.map(async (href) => {
        const res = await fetch(`${BASE}${href}`);
        if (!res.ok) throw new Error(`CSS ${href} respondeu ${res.status}`);
        return res.text();
      }),
    )
  ).join("\n");
} catch (error) {
  console.error(`check-deployed-css: falha ao baixar folhas de estilo — ${error.message}`);
  process.exit(1);
}

const missing = MARKERS.filter((marker) => !css.includes(marker));
if (missing.length > 0) {
  console.error(
    `check-deployed-css: CSS de produção é de outra geração. Faltando: ${missing.join(", ")}`,
  );
  console.error(`Folhas verificadas: ${hrefs.join(", ")}`);
  process.exit(1);
}
console.log(
  `check-deployed-css: ok — ${hrefs.length} folha(s) em ${BASE}, todos os ${MARKERS.length} marcadores presentes.`,
);
