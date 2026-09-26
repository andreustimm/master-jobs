---
id: PIPE-undo-and-move-back
area: PIPE
title: Corrigir um estágio errado — desfazer ou voltar — sem perder o histórico
persona: Andreus em triagem noturna
journey: J-preserve-application-decision
expected: Todo estágio anterior aparece em Voltar e encerramentos reabrem; Desfazer (aviso de 10 s ou linha mais recente do histórico) volta ao estágio anterior, marca o evento desfeito e, no primeiro registro, tira a vaga do funil sem apagar o histórico
entry_points: /jobs/<id>; /pipeline
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
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
4. Rejeitada e Retirada oferecem os estágios de progresso em "Voltar";
   Preparando oferece Arquivar.
5. Desfazer até o primeiro registro: a vaga some do `/pipeline` e das
   contagens, reaparece no quadro como "sem registro", e o histórico continua
   na vaga.
6. Com duas abas: mover na segunda enquanto o aviso da primeira está aberto;
   "Desfazer" na primeira avisa que a candidatura mudou em outra tela e não
   desfaz nada.
7. 375 px: seletor, trilha e botão Desfazer cabem sem rolagem horizontal; em
   inglês, nenhum texto em português.
