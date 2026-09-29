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
evidence: docs/qa/evidence/2026-09-28T180205401032Z-d6d772a5-perfil-publico-opt-in-targeted/CH-public-facts-edit-mobile-step3.png; docs/qa/evidence/2026-09-28T180205401032Z-d6d772a5-perfil-publico-opt-in-targeted/CH-public-facts-edit-desktop-en-step5.png; docs/qa/evidence/2026-09-29T035351654581Z-97f37e1c-full/CH-public-facts-and-name-desktop/public-profile-1280-facts-name.png
last_report: docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md
overlaps: PUB-public-facts-opt-in; PUB-edit-public-name
---

Criado com a parte A de #327. Percorra em 375px e no desktop, em pt-BR e em
inglês. Marque só alguns fatos (por exemplo, modelo de trabalho e idiomas),
salve, recarregue e confira que só eles continuam marcados. Tente gravar
"Pretensão: USD 15,000" em Área e um e-mail em Idiomas: a tela explica a
recusa e o valor anterior continua lá depois do refresh. Não há campo de
pretensão salarial — a dica do cartão diz que ela nunca sai. O efeito em
`/p/<endereço>` é o cenário `PUB-public-facts-opt-in`.

**Reconfirmado na Full 1.29 (2026-09-29, HEAD `494aa37`, desktop 1280×900,
conta `qa-full-candidate-e`):** os sete fatos (modelo de trabalho,
experiência, disponibilidade, prazo para começar, aceita mudar, área,
idiomas) preenchidos e ligados um a um; salvos e conferidos em `/p/` (ver
`PUB-public-facts-opt-in`); desligar só o modelo de trabalho e salvar de novo
fez o rótulo "Modelo de trabalho"/"Remoto" sumir por completo de `/p/`, sem
deixar rótulo órfão, enquanto os demais fatos continuaram visíveis. O aviso
de console "Base UI: A component is changing the default value state of an
uncontrolled FieldControl" reapareceu ao salvar (mesmo padrão do
`BUG-20260928-public-facts-uncontrolled-field-warning`, já aberto) — sem
efeito observável.
