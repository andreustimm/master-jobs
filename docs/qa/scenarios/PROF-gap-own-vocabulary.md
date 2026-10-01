---
id: PROF-gap-own-vocabulary
area: PROF
title: A análise de lacunas compara o currículo com a busca principal do próprio candidato
persona: Candidato convidado sem perfil
journey: J-refresh-candidate-ranking
expected: Em /candidate, "Vocabulário do currículo contra as vagas" lista só termos da trilha principal do próprio candidato, medidos nas vagas pontuadas para ela; nunca os termos do profile.yaml do dono em outra conta, nem as skills do perfil derivado do currículo; quem tem a principal pendente vê zero vagas analisadas e termo nenhum
entry_points: /candidate
qa_status: pass
bug_ids: BUG-20261001-gap-uses-owner-profile
fix_status: fixed
retest_status: pass
fix_commits: e53f4972, 78c047fd
evidence: tests/cov-core-candidate-gap.test.ts; tests/e2e/ui/candidate-gap.mjs; tests/candidate-vocabulary-gap.test.ts
last_report: docs/qa/reports/2026-10-01T201500Z-gap-trilha-principal-retest.md
overlaps: PROF-rescore-refused-reason
---

Duas contas de papel candidato. A convidada tem currículo próprio, perfil
derivado dele pela fila e a trilha principal editada para outros termos. O
dono salvou o currículo e a fila derivou um perfil dele também. Entrar com
cada uma, abrir `/candidate` e ler a seção de lacunas: os termos "ausentes",
"confirmados" e "raros" são os da trilha principal de cada conta, e não os do
perfil derivado do currículo nem os da outra conta. Recarregar e repetir em
sessão nova. Uma conta sem perfil próprio (principal pendente) mostra a
mensagem de nenhuma vaga analisada.

Cobertura: `tests/cov-core-candidate-gap.test.ts` (dono com perfil derivado e
principal editada, promoção de outra trilha, dono com CV salvo e fila drenada,
convidada com trilha própria, convidada sem perfil) e a área E2E
`candidate-gap`, que entra pelo login com a convidada e o dono, lê a seção a
375 px, depois do refresh e em sessão nova.

Limite conhecido do E2E: no acervo de fixtures, as vagas do dono acima de 60
não citam termo do perfil, então a tela do dono só tem termos raros, que
coincidem com os do perfil derivado. O E2E prova que o dono vê só termos da
principal; a distinção entre principal e perfil derivado no dono está no teste
de banco (caso b).
