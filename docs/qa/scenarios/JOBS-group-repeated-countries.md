---
id: JOBS-group-repeated-countries
area: JOBS
title: Ler numa linha só a vaga que foi publicada em vários países
persona: Andreus em triagem
journey: J-find-jobs-by-work-mode
expected: A mesma vaga repetida por país ocupa uma linha, com a bandeira de cada país; clicar numa bandeira abre a publicação daquele país
entry_points: /jobs?q=Engineering+Manager; /jobs?ungrouped=1
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: JOBS-source-multi-select
---

Medido no acervo: 391 grupos, 2.934 publicações, 2.543 linhas a menos — 34% do
quadro. O maior grupo é a mesma vaga em 42 países.

As vagas continuam registros separados; o agrupamento é de apresentação. A
linha escolhida é a de menor id, nunca a de melhor nota, porque nota é por
candidato e a linha canônica não pode mudar de leitor para leitor.

A conferir:

- Uma vaga publicada em sete países ocupa uma linha, com sete bandeiras.
- Passar o mouse numa bandeira mostra o nome do país no idioma da interface.
- Clicar numa bandeira abre a publicação daquele país, não a da linha.
- Cidades do mesmo país somam numa marca só, com a contagem no rótulo
  ("Brasil · 3 vagas") — três bandeiras iguais lado a lado seriam ruído.
- Localização que não nomeia país ("Remote", "Bogota") aparece como texto, sem
  bandeira inventada.
- Acima de oito países, o excedente vira "+N", que leva à página da vaga.
- O interruptor "agrupar repetidas" desliga tudo e devolve uma linha por
  publicação; a URL carrega `ungrouped=1`.
- O rodapé não mente: "N correspondem aos filtros" conta linhas agrupadas, não
  publicações.
- No Windows a bandeira não é desenhada e aparecem as duas letras do país —
  degradação esperada, e o nome continua no rótulo.
