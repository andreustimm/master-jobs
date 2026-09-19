# BUG-20260919-mobile-searches-overflow: no celular, Buscas corta os cartões e os campos dão zoom na tela inteira

- **Status:** fixed <!-- open | fixed | verified | wont-fix | invalid -->
- **Impact (user-side):** Usability
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

## Evidence

Medição com Playwright em 375 e 390px, logado no clone local, antes e depois:
`term-N` e `track-evidence-N` terminavam em 388px; depois, nenhum elemento
passa da borda e a menor fonte de campo é 16px em todas as telas autenticadas.
