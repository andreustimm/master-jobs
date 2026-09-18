---
id: PIPE-refused-transition-keeps-draft
area: PIPE
title: Recusar uma mudança de estágio sem apagar a nota digitada
persona: Andreus em triagem noturna
journey: J-preserve-application-decision
expected: O seletor oferece só estágios alcançáveis, e uma recusa do servidor mantém a nota no formulário e nomeia os dois estágios
entry_points: /jobs/<id>; /pipeline
qa_status: pass
bug_ids: BUG-20260910-application-edit-not-retained; BUG-20260917-stale-stages-after-refusal
fix_status: fixed
retest_status: verified
fix_commits: f16c2b4; 916c531; fa1269d; 03ac0f6; 9bb7fc0
evidence: docs/qa/evidence/2026-09-17T222310262016Z-5e419094-application-draft-on-rejected-transition/CH-refused-transition-draft-step3-note-kept.png; docs/qa/evidence/2026-09-17T222310262016Z-5e419094-application-draft-on-rejected-transition/CH-refused-transition-draft-retest-fresh-stages.png
last_report: docs/qa/reports/2026-09-17T222310262016Z-5e419094-application-draft-on-rejected-transition.md
overlaps: PIPE-save-resume-decision
---

Separado de `PIPE-save-resume-decision` porque a promessa é outra: aquele
cenário afirma que a decisão confirmada sobrevive; este afirma que a decisão
RECUSADA não leva junto o que a pessoa digitou.

A recusa não é mais alcançável por clique — a lista de estágios sai de
`allowedTransitions`, então de `preparing` não existe opção `interviewing` para
escolher. Ela continua alcançável quando a candidatura muda por outra aba ou
outra sessão entre a abertura da tela e o envio, e é assim que a sessão deve
provocá-la. Estado terminal (`rejected`, `withdrawn`, `archived`) é o caminho
mais curto: dele nenhum estágio é alcançável.

O veredito exige as duas metades na mesma tentativa: a nota digitada ainda
visível no campo depois do aviso, e o aviso citando o estágio gravado e o
pretendido pelo nome traduzido.

Re-andado em 17/09 sobre o head final (`9bb7fc0`), porque o formulário mudou
duas vezes depois do primeiro veredito — as correções que a revisão
independente pediu. As três propriedades se sustentam: o aviso diz "The funnel
does not go from Archived to Applied", a nota continua no campo, e o seletor
aponta para `archived`, o estágio realmente gravado. Evidência:
`CH-refused-transition-draft-final-head.png`.
