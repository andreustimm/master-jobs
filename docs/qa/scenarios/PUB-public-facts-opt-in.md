---
id: PUB-public-facts-opt-in
area: PUB
title: Ver no perfil público só os fatos que o candidato decidiu mostrar
persona: Visitante do perfil público
journey: J-open-public-profile
expected: Em /p/<slug>, sem sessão, cada fato com "mostrar" ligado aparece — modelo de trabalho, nível e disponibilidade na faixa do topo; área, idiomas, prazo e aceita mudar no cartão "Em resumo" —, e nenhum fato desligado aparece, nem o rótulo; sem rolagem horizontal em 375px; nenhuma pretensão salarial em lugar nenhum
entry_points: /candidate; /p/[slug]
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/evidence/2026-09-28T180205401032Z-d6d772a5-perfil-publico-opt-in-targeted/CH-public-facts-visitor-mobile-en-step1.png; docs/qa/evidence/2026-09-28T180205401032Z-d6d772a5-perfil-publico-opt-in-targeted/CH-public-facts-visitor-desktop-ptbr-step1.png; docs/qa/evidence/2026-09-28T180205401032Z-d6d772a5-perfil-publico-opt-in-targeted/CH-public-facts-visitor-mobile-full7-step6.png; docs/qa/evidence/2026-09-29T035351654581Z-97f37e1c-full/CH-public-facts-and-name-desktop/public-profile-1280-facts-name.png; docs/qa/evidence/2026-09-29T035351654581Z-97f37e1c-full/CH-public-facts-and-name-desktop/public-profile-375-facts-name.png
last_report: docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md
overlaps: PUB-edit-public-facts; PUB-public-profile-layout; PUB-public-cv-protected-content
---

Criado com a parte A de #327. O candidato preenche os sete fatos em
`/candidate`, liga só uma parte deles e deixa o perfil Público. Um visitante
em janela anônima abre `/p/<endereço>` no celular e no desktop: os ligados
aparecem no lugar certo, os desligados não aparecem nem como "não informado"
— sem nenhum, a faixa e o cartão somem. Voltar um fato para desligado e
recarregar o tira da página na hora. Em inglês, os rótulos e os valores
escolhidos em lista saem traduzidos; área e idiomas continuam como a pessoa
escreveu.

**Reconfirmado na Full 1.29 (2026-09-29, HEAD `494aa37`, 375px e 1280×900,
`curl` sem cookie, sem cookie de idioma — locale padrão pt-BR):** com os sete
fatos ligados, `/p/qa-full-pub-v2` mostrou "Modelo de trabalho: Remoto",
"Nível de experiência: Senior", "Disponibilidade: Procurando ativamente",
"Prazo para começar: Imediato", "Aceita mudar de cidade ou país: Sim", "Área:
AI Engineering" e "Portuguese (native)" em Idiomas — todos os valores de
enum traduzidos para pt-BR, área e idiomas como escritos. Desligando o
modelo de trabalho e recarregando, "Modelo de trabalho" e "Remoto" saíram por
completo da página (sem rótulo vazio), os outros seis fatos continuaram.
`document.documentElement.scrollWidth === innerWidth` em 375px e em 1280px
(sem rolagem horizontal).
