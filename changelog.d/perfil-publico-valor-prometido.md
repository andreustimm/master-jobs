## Técnico

### Corrigido

- `publicCvText()`: o valor prometido por um rótulo de pretensão sem valor é procurado do rótulo em diante (`fromLabel()`); um número acima do rótulo ("Equipe de 12 pessoas") não cancela mais a retirada do parágrafo seguinte (#353).
- `narrowSalaryBlock()`: seção sem valor do rótulo em diante ("a combinar") sai sozinha e promete o bloco seguinte, em vez de derrubar o bloco inteiro; suas bordas veem qualquer número antes do nome de seção vizinho e só valor com cara de dinheiro depois dele. O bloco prometido que abre com sub-rótulo de regime (`Employment:\n150k USD`) é consumido quando a seção que o nome abre traz dinheiro, e o bloco consumido que é rótulo sem valor promete o seguinte. Limite declarado novo em G23: número sem cara de dinheiro ("150") do outro lado de um nome de seção passa (#353).

## pt-BR

### Corrigido

- "Pretensão salarial: a combinar" no currículo importado não esvazia mais o perfil público: sai só a pretensão, e o resto do currículo fica.
- O perfil público não mostra mais a pretensão escrita no parágrafo logo abaixo do rótulo, nem a que vem depois de um "CLT:"/"PJ:" ou "Employment:" em linha própria.

## en

### Fixed

- "Salary expectation: negotiable" in an imported résumé no longer empties the public profile: only the salary expectation is left out, and the rest of the résumé stays.
- The public profile no longer shows a salary expectation written in the paragraph right below its label, or one that follows a "CLT:"/"PJ:" or "Employment:" line of its own.
