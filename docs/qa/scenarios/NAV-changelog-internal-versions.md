---
id: NAV-changelog-internal-versions
area: NAV
title: Ver no modal Novidades toda versão publicada, inclusive as sem nota de usuário
persona: Andreus em triagem
journey: J-open-dashboard-direct
expected: A lista começa na versão do rodapé e não pula nenhuma versão do changelog técnico; versão sem nota mostra só "Melhorias internas, sem mudança visível." (em inglês, "Internal improvements, no visible change.") com a data da versão; versões com nota continuam iguais
entry_points: /
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: tests/changelog-build.test.ts; tests/e2e/ui.mjs
last_report:
overlaps: NAV-full-width-shell
---

Até a #340 o modal mostrava só versões com nota de usuário: o cabeçalho dizia
v1.26.0 e a lista começava em v1.25.3, o que parecia changelog faltando. Agora
a compilação cruza o `CHANGELOG.md` técnico com as notas de usuário, de forma
retroativa, sem reescrever o histórico.

A conferir: a primeira versão da lista é a do rodapé; nenhuma versão do
changelog técnico falta; a linha interna aparece traduzida nos dois idiomas; a
data da versão interna segue o formato do idioma; em 375 px a linha cabe no
card sem rolagem horizontal; nenhum texto do changelog técnico aparece no
modal.
