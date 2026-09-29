---
id: PUB-public-photo-cover-opt-in
area: PUB
title: Ver no perfil público a foto e a capa só quando o candidato decidiu mostrar
persona: Visitante do perfil público
journey: J-open-public-profile
expected: Em /p/<slug>, sem sessão, a capa aparece acima do nome e a foto ao lado dele só quando o "mostrar" de cada uma está ligado; desligada, a imagem não aparece nem como espaço vazio ou iniciais; sem rolagem horizontal em 375px e o nome continua legível ao lado da foto; a imagem vem do próprio endereço do app, nunca de um domínio de armazenamento
entry_points: /candidate; /p/[slug]
qa_status: pass
bug_ids: BUG-20260928-public-profile-broken-image-icon-storage-unconfigured
fix_status: pending
retest_status:
fix_commits:
evidence: docs/qa/evidence/2026-09-28T205309000000Z-62fe85e4-perfil-publico-foto-capa-targeted/CH-photo-cover-visitor-mobile.png; docs/qa/evidence/2026-09-28T205309000000Z-62fe85e4-perfil-publico-foto-capa-targeted/CH-photo-cover-visitor-desktop.png; docs/qa/evidence/2026-09-28T205309000000Z-62fe85e4-perfil-publico-foto-capa-targeted/CH-photo-cover-visitor-cover-off.png; docs/qa/evidence/2026-09-28T205309000000Z-62fe85e4-perfil-publico-foto-capa-targeted/CH-photo-cover-visitor-both-off.png; docs/qa/evidence/2026-09-28T205309000000Z-62fe85e4-perfil-publico-foto-capa-targeted/CH-photo-cover-visitor-ptbr.png
last_report: docs/qa/reports/2026-09-28T205309000000Z-62fe85e4-perfil-publico-foto-capa-targeted.md
overlaps: PUB-edit-public-photo-cover; PUB-public-profile-layout; PUB-public-facts-opt-in
---

Criado com a parte B de #327. O candidato envia foto e capa, liga só a foto
e deixa o perfil Público. Um visitante em janela anônima abre
`/p/<endereço>` no celular e no desktop: vê a foto ao lado do nome e nenhuma
capa. Ligar a capa e recarregar a faz aparecer acima do nome, mais alta no
celular (3:1) do que no desktop (4:1). No inspetor de rede, as imagens vêm de
`/p/<endereço>/image/photo` e `/image/cover`, com `Cache-Control: no-store`.

**Rodada de 2026-09-28:** confirmado por `getBoundingClientRect()` — desktop
(1280×900) capa 1184×296 (4:1 exato), foto 128×128; mobile (375×812) capa
356×119 (~3:1), foto 80×80. `document.documentElement.scrollWidth ===
clientWidth` em 375px (sem rolagem horizontal). Alternar "mostrar" desliga
capa e foto independentemente, sem espaço vazio nem iniciais — confirmado nos
três estados (só foto, nenhuma, ambas). Imagens sempre em
`http://localhost:3102/p/<endereço>/image/<kind>` (mesma origem do app, nunca
domínio de armazenamento), `Cache-Control: private, no-store, max-age=0`,
`Cross-Origin-Resource-Policy: same-origin`, confirmado por `curl` sem
cookie. Testado em pt-BR e inglês.

Achado adjacente (não é o que este cenário promete, mas apareceu ao testar o
caso "sem `JHO_STORAGE_DRIVER`" pedido pela tarefa): quando a foto/capa já
existem e estão com "mostrar" ligado, mas o driver de armazenamento fica sem
configuração, o visitante vê o ícone de imagem quebrada do navegador em vez
de simplesmente não ver a imagem (que é o que acontece quando o candidato
desliga "mostrar" manualmente). Registrado como
`BUG-20260928-public-profile-broken-image-icon-storage-unconfigured`;
reconfirmado nos commits `ef8d359` e `21724ef` (início e fim da sessão).
