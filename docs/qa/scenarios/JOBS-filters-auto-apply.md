---
id: JOBS-filters-auto-apply
area: JOBS
title: Filtro se aplica ao terminar o gesto, sem clicar em Aplicar
persona: Andreus em triagem
journey: J-trust-the-filtered-board
expected: A busca aplica depois de uma pausa com três ou mais caracteres, o slider ao soltar, a faixa ao sair dela e o select ao escolher; arrastar não navega, a digitação em curso nunca é apagada pela resposta anterior e a URL final é a da última interação
entry_points: /jobs; /; /jobs?fit=45
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: JOBS-filter-fields-follow-url; NAV-same-screen-soft-transition; JOBS-score-range; JOBS-pay-filter
---

Cobertura: issue #218, `app/auto-submit.tsx` e `app/auto-apply.ts`, nas duas
barras (Vagas e Cockpit).

Percorrer em desktop e em 375 px, com rede lenta simulada pelo devtools:

1. Digitar duas letras na busca e esperar: nada acontece. Digitar a terceira e
   parar: a lista e a URL mudam sem clique, e o campo continua com foco.
2. Digitar uma palavra longa sem parar: uma atualização só, no fim.
3. Com rede lenta, digitar, pausar até a lista começar a atualizar e continuar
   digitando: o texto não volta atrás nem perde o foco; a URL final traz o texto
   inteiro.
4. Buscar "HP" com Enter: aplica na hora, mesmo com dois caracteres.
5. Arrastar o slider de Score: a lista não muda durante o arrasto; ao soltar,
   muda uma vez. Com o teclado, várias setas seguidas aplicam uma vez.
6. Preencher o piso, Tab para o teto, preencher e sair da faixa: aplica uma vez,
   com os dois valores.
7. Faixa salarial: trocar a moeda ou o período aplica ao escolher.
8. Fontes: marcar duas continua pedindo o Aplicar da lista, que fica aberta
   enquanto se escolhe.
9. Recarregar mantém tudo; Voltar devolve o filtro anterior aos campos.
10. Com leitor de tela, a transição suave anuncia "Atualizando esta tela" a cada
    aplicação automática, e o foco não é roubado.
