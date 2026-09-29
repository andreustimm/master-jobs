---
id: PUB-public-cv-protected-content
area: PUB
title: Publicar o currículo sem publicar contato nem pretensão salarial
persona: Visitante do perfil público
journey: J-open-public-profile
expected: Com perfil público e currículo publicado, /p/<slug> mostra o texto profissional do CV sem o e-mail, o telefone nem a frase de pretensão salarial que estão escritos nele, antes e depois do reload
entry_points: /candidate; /p/[slug]
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: evidence/2026-09-22-rc-1.22.0/s3-public-alex-ribeiro.png
last_report: docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md
overlaps: PUB-public-profile-mobile-entry
---

O candidato salva um currículo que traz no cabeçalho o próprio e-mail e o
telefone no formato `(11) 91234-5678` ou `+55 11 91234-5678`, e no rodapé
"Pretensão salarial: R$ …". Marca o perfil como
público e publica o currículo em `/candidate`. Numa sessão anônima, `/p/<slug>`
mostra o restante do texto; os três trechos aparecem trocados por `[…]` ou
ausentes. Um valor escrito sem rótulo continua visível — é o limite declarado
da detecção, não defeito.

Full 1.22.0 (2026-09-22): CV publicado com e-mail, (11) 91234-5678, +55 11 91234-5678 e 'Pretensão salarial: R$ 38.000': os três viram […] ou somem, antes e depois do reload.

**Reconfirmado na Full 1.29 (2026-09-29, HEAD `494aa37`, conta
`qa-full-candidate-e`):** CV sintético salvo com
`qa.full.pub@example.com | (11) 91234-5678 | +55 11 91234-5678` numa linha e
`Pretensão salarial: R$ 38.000` em outra. No HTML servido por `curl` sem
cookie, o `source` do markdown público mostra `[…] | […] | […]` no lugar dos
três contatos, e a linha inteira da pretensão salarial desaparece por
completo (nem `[…]` sobra) — o resto do CV (título, experiência, skills)
permanece intacto. O bloco carrega `data-user-content="true"` e
`data-testid="public-cv"`.
