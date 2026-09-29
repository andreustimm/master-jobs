---
id: PUB-edit-public-facts
area: PUB
title: Preencher os dados do perfil público e escolher, campo a campo, o que aparece
persona: Andreus no celular
journey: J-choose-public-address
expected: Em /candidate, o cartão "Dados do perfil público" mostra os sete fatos, cada um com "Mostrar no perfil público" desmarcado por padrão; salvar grava valor e opt-in, que sobrevivem ao refresh; e-mail, telefone ou pretensão salarial em Área ou Idiomas são recusados com a razão, sem apagar o que já estava salvo
entry_points: /candidate
qa_status: pass
bug_ids: BUG-20260928-public-facts-uncontrolled-field-warning
fix_status: pending
retest_status:
fix_commits:
evidence: docs/qa/evidence/2026-09-28T180205401032Z-d6d772a5-perfil-publico-opt-in-targeted/CH-public-facts-edit-mobile-step3.png; docs/qa/evidence/2026-09-28T180205401032Z-d6d772a5-perfil-publico-opt-in-targeted/CH-public-facts-edit-desktop-en-step5.png
last_report: docs/qa/reports/2026-09-28T180205401032Z-d6d772a5-perfil-publico-opt-in-targeted.md
overlaps: PUB-public-facts-opt-in; PUB-edit-public-name
---

Criado com a parte A de #327. Percorra em 375px e no desktop, em pt-BR e em
inglês. Marque só alguns fatos (por exemplo, modelo de trabalho e idiomas),
salve, recarregue e confira que só eles continuam marcados. Tente gravar
"Pretensão: USD 15,000" em Área e um e-mail em Idiomas: a tela explica a
recusa e o valor anterior continua lá depois do refresh. Não há campo de
pretensão salarial — a dica do cartão diz que ela nunca sai. O efeito em
`/p/<endereço>` é o cenário `PUB-public-facts-opt-in`.
