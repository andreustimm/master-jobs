---
id: PIPE-undo-and-move-back
area: PIPE
title: Corrigir um estágio errado — desfazer ou voltar — sem perder o histórico
persona: Andreus em triagem noturna
journey: J-preserve-application-decision
expected: Todo estágio anterior aparece em Voltar e encerramentos reabrem; Desfazer (aviso de 10 s ou linha mais recente do histórico) volta ao estágio anterior, marca o evento desfeito e, no primeiro registro, tira a vaga do funil sem apagar o histórico
entry_points: /jobs/<id>; /pipeline
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/reports/2026-10-06-qa-478-funil-filtros.md
last_report: docs/qa/reports/2026-10-06-qa-478-funil-filtros.md
overlaps: PIPE-refused-transition-keeps-draft; PIPE-read-application-history; PIPE-save-resume-decision
---

Pedido do dono na #316: um status registrado errado não tinha volta, e as
opções anteriores nunca mais apareciam no "Mover para".

A conferir, sempre com refresh e leitura independente (o `/pipeline` e o
histórico da vaga):

1. Em Triagem, o seletor mostra "Voltar" com A fazer, Pré-selecionada,
   Preparando e Candidatura enviada, em ordem de funil; a trilha acima marca
   Triagem como atual.
2. Voltar de Triagem para Pré-selecionada, com nota: o histórico mostra a linha
   nova com a nota, e a data da candidatura continua a mesma.
3. Mover e clicar "Desfazer" no aviso dentro de 10 s: o estágio volta, o
   histórico mostra "desfazer: de X para Y" e a linha revertida riscada com
   "desfeito". Nenhuma linha some.
4. Rejeitada e Retirada oferecem, em "Voltar", até onde a candidatura chegou
   de verdade antes de fechar — nunca um estágio mais adiantado que ela nunca
   alcançou (#346: confirmado por E2E, `tests/e2e/ui/pipeline.mjs` — avança até
   Entrevista, rejeita, e "Voltar" oferece até Entrevista mas nunca Oferta).
   Sem histórico conhecido, a reabertura continua livre para qualquer estágio.
   Preparando oferece Arquivar.
5. Desfazer até o primeiro registro: a vaga some do `/pipeline` e das
   contagens, reaparece no quadro como "sem registro", e o histórico continua
   na vaga.
6. Com duas abas: mover na segunda enquanto o aviso da primeira está aberto;
   "Desfazer" na primeira avisa que a candidatura mudou em outra tela e não
   desfaz nada.
7. 375 px: seletor, trilha e botão Desfazer cabem sem rolagem horizontal; em
   inglês, nenhum texto em português.

**QA de jornada 28/09 (PR #354, commit `da2b8f9`): os 7 passos passam.**
Cobertos com e sem `appliedAt` (progresso real vs. registro direto em
estágio avançado); a reabertura de uma vaga registrada direto em Entrevista
respeita o teto real (não trava pela ausência do carimbo, não libera sem
teto); desfazer uma reabertura e reabrir de novo chega ao estágio certo — o
Major da 2ª rodada de revisão (`da2b8f9`) está corrigido. O conflito de duas
abas avisa "Esta candidatura mudou em outra tela..." e não corrompe nada.
Relatório: `docs/qa/reports/2026-09-28-pr-354-funil-desfazer.md`.

**Canária 06/10 (#478, funil filtrado, `origin/dev` 4f62a49a): passa no
recorte percorrido.** Com `/pipeline?channel=referral` aberto, mover a vaga de
Candidatura enviada para Triagem com nota e desfazer pelo aviso; mover de novo
e desfazer pela linha do histórico. O histórico ganhou as linhas "desfazer:"
com as revertidas marcadas "desfeito", e a segunda sessão (375 px, inglês) viu
o contador filtrado ir de 1 Applied + 1 Screening para 2 Screening e voltar,
sem perder o filtro de canal. Os passos 1, 4, 5 e 6 não foram refeitos nesta
rodada. Relatório: `docs/qa/reports/2026-10-06-qa-478-funil-filtros.md`.
