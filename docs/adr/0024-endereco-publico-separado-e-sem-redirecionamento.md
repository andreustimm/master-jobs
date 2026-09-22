# ADR 0024 — Endereço público separado do identificador, e troca sem redirecionamento

**Status:** aceita · 2026-09-22 · issue #235

## Contexto

Cada candidato precisa de um endereço público próprio, `/p/<slug>`, escolhido
por ele. Até aqui a rota lia `candidate.slug`, que também é o identificador
interno: a CLI (`activeCandidateId`), o modo aberto e `syncCandidateFromProfile`
acham o dono por `slug = 'default'`. Deixar o dono trocar esse valor faria o
próximo `jho db seed` criar um segundo candidato para ele, e a CLI passaria a
operar sobre a linha errada.

A issue pede também que se decida o que acontece com o endereço antigo depois
de uma troca.

## Decisão

1. **Coluna própria.** `candidate.public_slug`, com índice único, é o endereço
   público. `slug` continua sendo o identificador interno e nunca muda pela
   tela. A migração é aditiva: `0009` cria a coluna anulável e o índice,
   `0010` copia `slug` para quem ainda não tem endereço — todo perfil público
   segue respondendo onde respondia.
2. **Escolha validada no domínio.** Minúsculas, números e hífen entre eles,
   de 3 a 40 caracteres; nomes reservados (rotas de primeiro nível do app,
   `default`, `api`…) e os prefixos que outros caminhos reaproveitam pelo slug
   (`user-`, `e2e-`) são recusados. A unicidade é do índice, não de uma
   consulta anterior.
3. **Troca sem redirecionamento.** O endereço antigo passa a responder 404 na
   hora, exatamente como um endereço que nunca existiu, e fica livre para outra
   pessoa escolher.
4. **Visibilidade continua mandando.** Perfil privado ou só para recrutadores
   responde 404 em qualquer endereço — o antigo, o novo e o identificador.

## Consequências

- Redirecionar do antigo para o novo diria a quem guardou o link antigo qual é
  o endereço atual. A troca existe, entre outros motivos, para quem quer se
  desligar de um endereço que circulou; redirecionar anularia isso.
- O custo é o link antigo quebrar para quem o recebeu de boa-fé, e o endereço
  liberado poder ser escolhido por outra pessoa. A tela avisa as duas coisas
  antes da troca. Guardar histórico de endereços para reservá-los exigiria uma
  tabela nova e decidir por quanto tempo reservar — fica para quando houver
  demanda.
- Linha inserida fora dos caminhos do produto sem `public_slug` não responde em
  `/p/`: ausência nega, nunca publica.
