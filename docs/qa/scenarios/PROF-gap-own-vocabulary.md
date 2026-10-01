---
id: PROF-gap-own-vocabulary
area: PROF
title: A análise de lacunas compara o currículo com o vocabulário do próprio candidato
persona: Candidato convidado sem perfil
journey: J-refresh-candidate-ranking
expected: Em /candidate, "Vocabulário do currículo contra as vagas" lista só termos do perfil de busca do próprio candidato; quem não tem perfil próprio e não é o dono não vê termo nenhum (zero vagas analisadas), e nunca os termos do profile.yaml do dono
entry_points: /candidate
qa_status: untested
bug_ids: BUG-20261001-gap-uses-owner-profile
fix_status: fixed
retest_status: pending
fix_commits: pendente (PR da #427 ainda não mesclada)
evidence: tests/cov-core-candidate-gap.test.ts; tests/e2e/ui/candidate-rescore.mjs
last_report: docs/qa/reports/2026-10-01-gap-perfil-proprio-targeted.md
overlaps: PROF-rescore-refused-reason
---

Entrar com duas contas de papel candidato: a do dono (perfil de `profile.yaml`)
e uma conta convidada cujo currículo gerou um perfil próprio. Abrir `/candidate`
em cada uma e comparar a seção de lacunas: os termos "ausentes", "confirmados"
e "raros" da conta convidada têm de sair das competências do currículo dela, não
das do dono. Uma conta convidada ainda sem perfil próprio (currículo fraco ou
sem competência reconhecida) mostra a mensagem de nenhuma vaga analisada, e
não termos do dono.

Cobertura automatizada: `tests/cov-core-candidate-gap.test.ts` (duas contas no
banco, B não recebe os termos do dono; B sem perfil recebe relatório vazio; o
dono sem perfil gravado usa o `profile.yaml`) e `candidate-rescore` no E2E (a
conta de CV fraco mostra "nenhuma vaga" em pt-BR e en, 375 px). O percurso
manual com duas contas e leitura independente após refresh continua pendente.
