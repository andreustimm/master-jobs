---
id: PUB-public-profile-layout
area: PUB
title: Entender o perfil público em segundos, no layout de referência Jobicy
persona: Recrutador
journey: J-open-public-profile
expected: Em /p/<slug>, o hero (nome, headline, localização, CTA LinkedIn, GitHub, copiar link) aparece acima da dobra em 375px sem rolagem horizontal; a partir de 1024px o conteúdo principal (Resumo/Experiência/Formação, só quando existem) e as skills agrupadas por categoria aparecem em duas colunas; skills sem caixa alta forçada, com "+N" recolhido além do topo 6 por categoria; o currículo completo fica atrás de um `<details>` recolhido
entry_points: /candidate; /p/[slug]
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: evidence/2026-09-28T164126181554Z-de433ca6-perfil-publico-layout-targeted/pub-375-en-fold.png; evidence/2026-09-28T164126181554Z-de433ca6-perfil-publico-layout-targeted/pub-375-pt-fold.png; evidence/2026-09-28T164126181554Z-de433ca6-perfil-publico-layout-targeted/pub-1280-en.png; evidence/2026-09-28T164126181554Z-de433ca6-perfil-publico-layout-targeted/pub-1280-pt-expanded.png
last_report: docs/qa/reports/2026-09-28T164126181554Z-de433ca6-perfil-publico-layout-targeted.md
overlaps: PUB-public-cv-formatted; PUB-public-cv-protected-content; PUB-public-profile-mobile-entry
---

O candidato preenche headline, localização, LinkedIn, GitHub e confirma
skills em mais de uma categoria (com mais de 6 numa delas, para expor o
"+N"). Marca o perfil como público e publica o currículo. Um recrutador em
sessão anônima abre `/p/<slug>` no celular: o hero e o botão "Ver no
LinkedIn" aparecem sem precisar rolar, sem estouro lateral. No desktop
(≥1024px), o conteúdo principal — cartões de Resumo, Experiência e Formação,
cada um só quando a seção existe no currículo — fica ao lado da lista de
skills, agrupadas por categoria em ordem alfabética e com nome em caixa
normal (não mais em maiúsculas). O currículo completo abre por um `<details>`
nativo, recolhido por padrão. Nada de piso salarial, contato, funil ou
candidaturas aparece em nenhum lugar da tela.

Complementa `PUB-public-cv-formatted` (a estrutura do CV em si) e
`PUB-public-cv-protected-content` (o que nunca sai): aqui o que se mede é se
um recrutador que nunca viu o produto entende o perfil sem instrução.
