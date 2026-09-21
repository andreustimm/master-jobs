# BUG-20260919-mobile-searches-overflow: no celular, Buscas corta os cartões e os campos dão zoom na tela inteira

- **Status:** fixed <!-- open | fixed | verified | wont-fix | invalid -->
- **Impact (user-side):** Friction <!-- normalizado em 2026-09-21: 'Usability' não é um nível do registro -->
- **Severity:** Medium · **Priority:** P1
- **Persona Affected:** Andreus no celular
- **Journey Step:** J-save-term-search, steps 2–4
- **Scenarios:** SRCH-mobile-layout, JOBS-work-mode-mobile
- **Found:** 2026-09-19 (produção 1.15.0, iPhone, relato do usuário com prints)

## Summary

Com dados reais — seis trilhas, sete termos — a tela Buscas no celular ficou
cortada: as linhas por plataforma e o botão "de novo a partir de 20/09/2026,
15:10 UTC" passavam da borda do cartão, e a página parecia rolar na
horizontal, com "Sair" e "Nova trilha" fora da tela. Em Vagas, o mesmo aparelho
mostrava o cabeçalho cortado e uma barra de rolagem horizontal.

Duas causas, independentes:

1. **Grade sem coluna mínima 0.** O conteúdo da trilha é um `grid`; item de
   grade tem `min-width: auto`, e o botão do intervalo herda `whitespace-nowrap`
   do botão. A coluna crescia até a largura desse rótulo (388px numa tela de
   375) e o cartão, com `overflow: hidden`, cortava o texto. O `scrollWidth` da
   página continuava 375 — por isso o E2E, que só media o `scrollWidth`, não viu.
2. **Zoom do iOS em campo abaixo de 16px.** Os selects usam a escala do
   DESIGN.md (`type-body-md`, 15px). Focar um deles no iPhone dá zoom e o Safari
   não desfaz: a tela fica cortada nas bordas, que é o que aparecia em Vagas.

## Fix

- `@media (pointer: coarse)` em `app/globals.css`, fora de camada: todo campo
  com ao menos `1rem` em tela de toque; desktop inalterado.
- Buscas: `grid-cols-1` (`minmax(0,1fr)`) no conteúdo da trilha; ações do termo
  em grade de duas colunas no celular, alvo de 44px até `xl`, rótulo do
  intervalo quebrando linha; "Salvar um termo" empilhado.
- E2E: a varredura de larguras inclui `/searches` e `/jobs?track=all` e acusa
  elemento que passa da borda mesmo quando um cartão o corta; a semente deixa um
  termo com busca pedida agora, para o rótulo longo aparecer.
- Skills (achado na revisão de todas as telas): evidência com link markdown
  longo ia a 480px em 375. `grid-cols-1` no cartão e `wrap-anywhere` no
  parágrafo.

## Evidence

Medição com Playwright em 375 e 390px, logado no clone local, antes e depois:
`term-N` e `track-evidence-N` terminavam em 388px; depois, nenhum elemento
passa da borda e a menor fonte de campo é 16px em todas as telas autenticadas.

Revisão de todas as telas, logado, 23 rotas (19 autenticadas, 4 públicas) em
320×700, 375×812, 390×844, 412×915, 667×375 e 812×375: antes, 4 de 138
combinações falhavam, todas em `/candidate/skills` (evidência a 482px); depois,
138 de 138 sem rolagem horizontal e sem elemento além da borda.

## Re-found (2026-09-21)

- **Persona:** Andreus no celular · **Charter:** CH-searches-one-hand · **Report:** docs/qa/reports/2026-09-21T175034729239Z-e901131e-qa-buscas.md
- **Reteste:** o sintoma voltou por outro gatilho. Em 375×812 (Chromium emulando iPhone 15), com um termo salvo de 60 letras sem espaço, o cartão desse termo em Buscas fica mais largo que a trilha: o termo corta à direita, APAGAR aparece só pela borda esquerda, e "mover para" e MOVER saem da tela — a persona não alcança nenhum dos três. `scrollWidth` segue igual à janela; a medição de elemento além da borda acusa `term-platforms-3` e seus filhos em 536px numa janela de 360.
- **Causa provável:** a correção de 19/09 deu `minmax(0,1fr)` ao conteúdo da trilha e quebra ao rótulo do intervalo, mas o nome do termo não quebra palavra longa — a coluna do cartão do termo cresce até a largura dele.
- **Não reproduzido nesta rodada:** o rótulo longo "de novo a partir de…" (exige uma captura real, desligada no ambiente de paridade) e o zoom do iOS em campo abaixo de 16px (exige Safari em iPhone físico).
- Evidência: `docs/qa/evidence/2026-09-21T175034729239Z-e901131e-qa-buscas/CH-searches-one-hand-baseline-termo-longo-cortado.png`

## Fix (2026-09-21, Re-found)

- **Root cause:** o cartão do termo é um grid sem `grid-cols-1`, e o nome do termo usava `break-words`, que não reduz a largura mínima do conteúdo — a coluna implícita crescia até a largura de um termo sem espaço. Em Vagas, o chip "trazida pelo termo" herdava `shrink-0` e `whitespace-nowrap` do botão, dentro de um grupo sem `min-w-0`.
- **Fix commit:** `5e6d6aa`
- **Regression test:** `tests/e2e/setup.mjs` semeia um termo de 60 letras; a varredura de larguras de `tests/e2e/ui.mjs` reprovou sem a correção ("320px /jobs: filter-by-2 · 320px /jobs?track=all: filter-by-2 · 320px /searches: div, span", 262/263) e passa com ela (263/263).

## Verification (2026-09-21, parcial)

- **Retested:** Andreus no celular, `J-save-term-search`, sessão nova no ambiente de paridade com `5e6d6aa` · **Report:** docs/qa/reports/2026-09-21T175034729239Z-e901131e-qa-buscas.md
- **Result:** em 375 e 320 px, nenhum elemento de `/searches` nem de `/jobs?track=all` passa da borda. O termo de 60 letras quebra em duas linhas, e BUSCAR DE NOVO, PAUSAR, APAGAR, "mover para" e MOVER ficam dentro do cartão; APAGAR, tocado, apaga o termo, e a recarga confirma. Em Vagas, o chip do termo quebra em três linhas a 320 px e mantém 28 px de altura em desktop.
- **O que a medição cobriu:** o termo longo, nas rotas da varredura (`/searches` e `/jobs?track=all`, 320 a 1024 px) e no reteste em persona — todo elemento de `main`, o link "0 novas · ver vagas" do cartão incluído. **Não coberto:** nome de trilha longo (nenhuma semente tem um; a correção do título da trilha e dos chips de trilha não tem prova) e o toque real (o perfil do celular não emulou toque).
- **Ainda sem verificação:** o zoom do iOS em campo abaixo de 16 px, que o Chromium não reproduz — exige Safari num iPhone físico. Por isso o bug fica `fixed`, e não `verified`.

## Irmãos ainda não tratados (2026-09-21)

A revisão profunda da rodada achou o mesmo padrão — texto de trilha ou termo sem quebra em qualquer ponto — fora das telas corrigidas, e a varredura de larguras não visita nenhum deles: `app/searches/tracks/[id]/page.tsx:54` (título do editor de trilha), `app/jobs/[id]/page.tsx:178` (nota por trilha no detalhe da vaga), `app/joblist.tsx:57` e `:129` (linhas da lista) e `app/jobs/page.tsx:140` (oferta de salvar o termo). Ficam para a próxima correção, com uma semente de nome de trilha longo.

