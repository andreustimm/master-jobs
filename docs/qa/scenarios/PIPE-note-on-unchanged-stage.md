---
id: PIPE-note-on-unchanged-stage
area: PIPE
title: Escrever uma nota sem mudar de estágio
persona: Andreus em triagem noturna
journey: J-preserve-application-decision
expected: A nota escrita com o estágio inalterado é gravada como evento, e a tela não anuncia sucesso sobre uma gravação que não aconteceu
entry_points: /jobs/<id>; jho track <id> <status> --notes
qa_status: untested
bug_ids: BUG-20260917-transition-note-never-readable
fix_status: fixed
retest_status: pending
fix_commits: 03ac0f6; cb00cbb
evidence:
last_report: docs/qa/reports/2026-09-18T022259704434Z-6535cca7-release-candidate-1.8.0-promovido.md
overlaps: PIPE-save-resume-decision
---

Nasceu de uma revisão independente do diff, não de uma sessão: de um estado
terminal (`rejected`, `withdrawn`, ou `archived` depois de aplicar) a única opção oferecida é o
próprio estágio atual, então salvar uma nota cai SEMPRE no caminho de no-op —
onde a nota era descartada enquanto a tela anunciava sucesso. Antes de a lista
ser restringida esse caminho era escapável; depois, virou o único.

A gravação agora existe como evento `note`, sem `from`/`to`, pelo mesmo
argumento que o canal já usava neste ponto do código. A LEITURA continua não
existindo em superfície pública nenhuma — isso é
BUG-20260917-transition-note-never-readable e depende de decisão humana. Por
isso este cenário só assenta quando houver onde ler: hoje a única prova
disponível seria banco, e banco não é veredito de jornada.
