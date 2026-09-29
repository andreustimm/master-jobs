---
id: PUB-public-image-revoked-404
area: PUB
title: Link guardado da foto responde 404 depois que o perfil deixa de ser público ou a foto deixa de ser mostrada
persona: Visitante do perfil público
journey: J-open-public-profile
expected: Com o perfil público e a foto ligada, /p/<slug>/image/photo abre a imagem sem sessão; depois de tornar o perfil privado, desligar "mostrar", remover a foto ou trocar o endereço, a MESMA URL copiada antes responde 404 vazio, igual ao de um endereço que nunca existiu, e continua 404 depois do refresh; a URL do perfil antigo também é 404
entry_points: /candidate; /p/[slug]/image/[kind]
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/evidence/2026-09-28T205309000000Z-62fe85e4-perfil-publico-foto-capa-targeted/revoked-404-check.txt
last_report: docs/qa/reports/2026-09-28T205309000000Z-62fe85e4-perfil-publico-foto-capa-targeted.md
overlaps: PUB-public-photo-cover-opt-in; PUB-public-address-private-404
---

Criado com a parte B de #327. É a garantia de privacidade da issue: a imagem
não é servida por URL do provedor, e sim por uma rota do app que reconfere a
visibilidade a cada pedido. Copie a URL da foto numa janela anônima, depois
revogue de cada um dos quatro jeitos (privado, "mostrar" desligado, remover,
trocar o endereço) e recarregue a URL copiada: tem de ser 404, sem corpo,
com o mesmo cabeçalho de um endereço inventado. Religar tudo volta a servir
a foto na mesma URL do endereço atual.

**Rodada de 2026-09-28:** os quatro caminhos foram percorridos via `curl` sem
cookie (visitante real) contra o endereço `qa-foto-capa` (depois trocado para
`qa-foto-capa-v2`): (1) perfil tornado Privado → página e as duas imagens
(foto e capa) 404 com corpo vazio, idêntico a `/p/never-existed-address-xyz`;
restaurado, ambas voltam a 200 na mesma URL; (2) "Mostrar" desligado só na
foto (perfil continua Público) → só a foto 404, a capa continua 200
(confirma que os dois campos são independentes); (3) REMOVER IMAGEM → 404 e
o "Mostrar" desliga sozinho (confirmado em `/candidate` após refresh); (4)
troca de endereço com foto reenviada → endereço antigo 404 (página e imagem),
endereço novo 200 na mesma chave de versão. Reconfirmado nos commits
`ef8d359` (início da sessão) e `21724ef` (fim, depois das correções de
revisão L2 da PR que mexeram em upload/leitura/armazenamento, sem tocar essa
lógica de visibilidade) — comportamento idêntico nos dois.
