---
id: PIPE-save-resume-decision
area: PIPE
title: Salvar e retomar uma decisão de candidatura
persona: Andreus em triagem noturna
journey: J-preserve-application-decision
expected: A mesma candidatura preserva status e nota após refresh, novo login e leitura pela CLI pública
entry_points: /jobs; /pipeline; pnpm jho jobs show
qa_status: pass
bug_ids: BUG-20260910-application-edit-not-retained; BUG-20260917-transition-note-never-readable
fix_status: fixed
retest_status: verified
fix_commits: f16c2b4; 916c531; fa1269d; 03ac0f6; 9bb7fc0
evidence: docs/qa/evidence/2026-09-17T222310262016Z-5e419094-application-draft-on-rejected-transition/CH-save-resume-application-step3-reachable-stages.png
last_report: docs/qa/reports/2026-09-18T202222983242Z-8870c32d-release-candidate-1.13.1-full.md
overlaps:
---

Re-andado em 18/09 sobre `71d450c` depois que a SUPERFÍCIE do passo 3 mudou: o funil
passou a filtrar por estágio, paginar e mostrar o estado da vaga ao lado do
estágio da candidatura. Nada regrediu: gravar com nota confirma na hora, a nota
aparece no histórico da candidatura, o funil mostra a vaga no estágio salvo,
filtrar por estágio mantém a linha e leva o recorte para a URL, e tudo isso
sobrevive a refresh e a sair e entrar de novo. A CLI pública, com credencial
restrita própria, mostra o mesmo estágio.

Um defeito apareceu na superfície nova e foi corrigido nesta mesma rodada:
pedir uma página além do fim (`?page=999`) esvaziava a lista e a tela dizia
"nada no funil ainda" para quem TEM candidatura. Era a mesma mentira que a
lista vazia contaria num estágio desconhecido. O pedido passa a ser limitado à
última página real.

O passo 4 entrega o ESTÁGIO pela CLI, não a nota — `jho jobs show` imprime
`Pipeline applied · applied <data>` e nada sobre a nota. A nota é legível na
interface, no histórico da candidatura, e é assim desde a 1.8.0; a lacuna é de
paridade entre superfícies, não de dado perdido. Registrada como paper cut no
relatório.

Full do release candidate 1.7.1 (`676d5e0`, o que está em `staging`): este
cenário FALHA ali. O status deste arquivo descreve a branch de correção; o RC
ainda descarta o rascunho numa transição recusada. Relatório:
docs/qa/reports/2026-09-17T232350685065Z-1cb4e9bd-release-candidate-1.7.1-full.md

Re-andado sobre o head final (`9bb7fc0`) depois que o caminho de ESCRITA mudou
— a nota deixou de ser descartada no no-op —, porque um veredito obtido antes
dessa mudança não descreveria mais o produto. Nada regrediu: salvar com nota
grava, a decisão sobrevive a refresh, aparece no funil, resiste a sair e entrar
de novo, e a CLI pública mostra o mesmo estágio. Salvar uma nota sem mudar de
estágio conclui sem erro; que ela agora fique gravada é afirmado por teste de
unidade, já que continua sem leitura pública.

Reteste de 17/09: a metade do STATUS está confirmada ponta a ponta — gravado no
detalhe, relido após refresh, presente no funil, mantido depois de sair e
entrar de novo, e igual na CLI pública da mesma identidade. A metade da NOTA
não passa: ela é aceita e não volta em superfície pública nenhuma. Como a
correção disso é escolha de produto — gravar em `application.notes`, exibir o
histórico de eventos ou retirar o campo —, o cenário fica `blocked-decision` em
vez de `fail`. Ver BUG-20260917-transition-note-never-readable.

Planejado para a migração PostgreSQL. Usar somente conta e vaga sintéticas em
ambiente isolado; nenhuma candidatura real é enviada. O feedback imediato não
basta: confirmar persistência no funil e na leitura pública da mesma identidade.
Abandonar uma edição antes de salvar deve preservar a última decisão confirmada.
