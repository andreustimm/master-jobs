# BUG-20260922-long-address-cut-silently: endereço público colado acima de 40 caracteres é cortado e salvo sem aviso

- **Status:** open <!-- open | fixed | verified | wont-fix | invalid -->
- **Impact (user-side):** Friction
- **Severity:** Medium · **Priority:** P2
- **Persona Affected:** Andreus no celular
- **Journey Step:** J-choose-public-address, salvar um endereço novo em `/candidate`
- **Scenarios:** PUB-public-address-refusals
- **Found:** 2026-09-22 · **Report:** docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md

## Summary

O campo Endereço tem `maxlength=40`. Colar 41 caracteres faz o navegador
descartar o último antes do envio, e a tela responde "Endereço salvo." com os
primeiros 40. O endereço público passa a ser outro, diferente do que a pessoa
colou e provavelmente já divulgou, sem nenhum aviso. É o mesmo mecanismo do
[BUG-20260921-long-term-cut-silently](BUG-20260921-long-term-cut-silently.md),
em outro campo: o limite do navegador impede que a regra de tamanho do servidor
chegue a responder.

## Reproduction

- **Charter:** CH-public-address-change · **Tour:** Antisocial Tour
- **Environment:** ambiente de paridade `run-isolated.mjs --manual`; celular 375×812, pt-BR, conta `alex@local.test`

1. Abrir `/candidate`.
2. Colar em Endereço um texto de 41 letras `a` e tocar Salvar endereço.
3. Recarregar a página.

**Expected:** a recusa por tamanho ("de 3 a 40 caracteres") e o endereço atual sem mudança.
**Actual:** "Endereço salvo."; depois do reload o endereço é `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` (40).

## Evidence

- `docs/qa/evidence/2026-09-22-rc-1.22.0/log.txt` (linhas `recusa? "aaaaaaaa…(41)"` e `endereço atual após recusas + reload`)

## Fix

<!-- filled when status moves to fixed -->
- **Root cause:**
- **Fix commit:**
- **Regression test:**

## Verification

<!-- filled when status moves to verified -->
- **Retested:**
- **Result:**
