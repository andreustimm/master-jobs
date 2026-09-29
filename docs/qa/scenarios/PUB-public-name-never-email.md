---
id: PUB-public-name-never-email
area: PUB
title: Perfil público nunca exibe e-mail, nem como nome
persona: Visitante do perfil público
journey: J-open-public-profile
expected: Qualquer que seja a forma de criação da conta (admin, CLI ou autoatendimento), /p/<slug> de um perfil público não mostra endereço de e-mail em nenhum campo, inclusive no nome
entry_points: jho auth add-user; /admin/users; /candidate; /p/[slug]
qa_status: pass
bug_ids: BUG-20260922-public-profile-shows-email-as-name
fix_status: fixed
retest_status:
fix_commits: 2371b8b
evidence: evidence/2026-09-22-rc-1.22.0/s3-pia-public-name-is-email.png; docs/qa/evidence/2026-09-29T035351654581Z-97f37e1c-full/CH-public-facts-and-name-desktop/public-profile-375-facts-name.png
last_report: docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md
overlaps: PUB-public-cv-protected-content
---

Criado no Full da 1.22.0. Conta de `jho auth add-user` tem o e-mail como nome
do candidato e o publica em `/p/<slug>`. Contas de `/admin/users` (nome
digitado) e do autoatendimento (nome do formulário) não têm o problema.

Corrigido em `fix/bugs-qa-1.22.0` (2371b8b): a CLI dá o nome de exibição da
conta ou nenhum; `/p/` esvazia nome, headline, localização e links com e-mail
ou telefone; `/candidate` tem o cartão "Nome no perfil"; a migration 0014 zera
os nomes gravados. Reteste: repetir o passo a passo do bug (`add-user` →
endereço → Público → `/p/<endereço>` anônimo), conferir o título neutro, depois
escrever o nome em `/candidate` e conferir que ele aparece.

**Reteste cumprido na Full 1.29 (2026-09-29, HEAD `494aa37`):** conta
`qa-full-candidate-e@local.test` criada por `jho auth add-user` (sem nome),
endereço `qa-full-pub-v2` marcado Público — `/p/qa-full-pub-v2` sem sessão
mostrou "Perfil sem nome" (nenhum e-mail em nenhum campo). Depois de escrever
"QA Full Candidate E" em `/candidate`, o mesmo `curl` sem cookie mostrou o
nome novo no `<h1>`. `retest_status` volta a vazio — este reteste específico
está cumprido; o campo continua disponível para futuras rodadas se o
comportamento mudar.
