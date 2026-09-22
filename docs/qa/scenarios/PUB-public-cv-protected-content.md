---
id: PUB-public-cv-protected-content
area: PUB
title: Publicar o currículo sem publicar contato nem pretensão salarial
persona: Visitante do perfil público
journey: J-open-public-profile
expected: Com perfil público e currículo publicado, /p/<slug> mostra o texto profissional do CV sem o e-mail, o telefone nem a frase de pretensão salarial que estão escritos nele, antes e depois do reload
entry_points: /candidate; /p/[slug]
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: PUB-public-profile-mobile-entry
---

O candidato salva um currículo que traz no cabeçalho o próprio e-mail e o
telefone no formato `(11) 91234-5678` ou `+55 11 91234-5678`, e no rodapé
"Pretensão salarial: R$ …". Marca o perfil como
público e publica o currículo em `/candidate`. Numa sessão anônima, `/p/<slug>`
mostra o restante do texto; os três trechos aparecem trocados por `[…]` ou
ausentes. Um valor escrito sem rótulo continua visível — é o limite declarado
da detecção, não defeito.
