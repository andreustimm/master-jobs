---
id: COMPARE-manual-cadastro-idempotente
area: COMPARE
title: Cadastrar e comparar uma vaga sem falso erro nem duplicação
persona: Andreus em triagem
journey: J-trust-the-filtered-board
expected: O cadastro manual leva à ficha da vaga com o resultado disponível ou o estado sem score; atualizar a ficha preserva o resultado e repetir o mesmo cadastro mantém uma única vaga
entry_points: /compare; /jobs
qa_status: untested
bug_ids: BUG-20260929-compare-false-failure-duplicates-job
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/evidence/2026-09-29T035351654581Z-97f37e1c-full/CH-first-party-navigation-inventory/compare-failed.png
last_report:
overlaps: JOBS-new-account-unscored-board; NAV-first-party-navigation-contract
---

Este cenário cobre o cadastro manual que alimenta a decisão de comparar uma
vaga com o perfil. A mensagem de resultado precisa descrever o estado que foi
persistido: uma conta sem perfil próprio pode ficar sem score, mas não pode
receber uma mensagem de falha depois de a vaga entrar no acervo.

Passos:

1. Entrar como candidato de triagem e abrir `/compare`.
2. Preencher cargo, empresa, localização e uma descrição com pelo menos 100
   caracteres; escolher somente uma fonte de descrição.
3. Clicar no controle `data-testid="compare-submit"`.
4. Confirmar que a navegação chega a `/compare?job=<id>#comparison-result` e
   que aparece a ficha da vaga. Com score, ler o valor; sem score, ler a
   orientação traduzida de que a vaga ainda não possui score.
5. Atualizar a página e confirmar que a mesma ficha continua visível.
6. Repetir o cadastro com os mesmos dados e abrir `/jobs`; confirmar que a
   identidade cadastrada aparece uma única vez.

Evidência mínima: URL final, texto de resultado, leitura após refresh e
contagem independente da vaga no acervo. Um erro de score derivado não pode
ser reportado como falha do cadastro.
