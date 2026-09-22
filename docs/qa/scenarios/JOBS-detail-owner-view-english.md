---
id: JOBS-detail-owner-view-english
area: JOBS
title: Na tela de detalhe, o que só o dono vê também segue o idioma e tem nome acessível
persona: Candidato por teclado
journey: J-preserve-application-decision
expected: Com a interface em inglês, o cartão de score mostra "Matched keywords" e "Missing keywords" e o seletor de etapa é anunciado como "move to"; em português, "Palavras-chave casadas", "Palavras-chave ausentes" e "mover para"
entry_points: /jobs/<id>
qa_status: pass
bug_ids: BUG-20260921-job-detail-labels-untranslated
fix_status: fixed
retest_status: pending
fix_commits: 52ba067
evidence: evidence/2026-09-22-rc-1.22.0/log.txt
last_report: docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md
overlaps: JOBS-english-keeps-posting-data
---

Nasce da revisão profunda da PR #170, não de uma sessão de QA.

A tela de detalhe tem duas partes que só aparecem com escopo de candidato: o
cartão de score (atrás de `score &&`) e o formulário de funil (atrás de
`candidateId !== null`). A persona de `JOBS-english-keeps-posting-data` é a
recrutadora convidada, que não alcança nenhuma das duas — e foi por isso que
`casadas:` e `ausentes:` passaram pelo primeiro conserto de i18n.

O que mudou em `52ba067`, e que este cenário confere pela interface:

- os rótulos das palavras-chave casadas e ausentes, nos dois idiomas — em
  português o texto também mudou, de `casadas:` para `Palavras-chave casadas:`;
- o `<select>` de etapa, que não tinha nome acessível e agora anuncia o mesmo
  texto do rótulo visível ao lado.

A varredura E2E renderiza as duas linhas do cartão, mas não reprovaria se elas
voltassem a ser literal sem acento: só a jornada confirma o texto, e só um leitor
de tela confirma o nome do controle.

Full 1.22.0 (2026-09-22): Inglês: 'Matched keywords' e 'move to'; português: 'Palavras-chave casadas' e 'mover para'. 'Missing keywords' não apareceu porque a vaga não tinha palavra ausente.
