# BUG-20260922-short-address-wrong-reason: endereço curto demais é recusado com a razão errada

- **Status:** fixed <!-- open | fixed | verified | wont-fix | invalid -->
- **Impact (user-side):** Friction
- **Severity:** Low · **Priority:** P3
- **Persona Affected:** Andreus no celular
- **Journey Step:** J-choose-public-address, salvar um endereço novo em `/candidate`
- **Scenarios:** PUB-public-address-refusals
- **Found:** 2026-09-22 · **Report:** docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md

## Summary

Em `/candidate`, salvar o endereço `ab` responde "Use só letras minúsculas,
números e hífen entre eles." — mas `ab` só tem letras minúsculas. A razão real é
o tamanho. No formulário de criação de perfil a mesma entrada recebe a mensagem
certa ("The address needs at least 3 characters."), então as duas telas
discordam sobre a mesma regra. A pessoa lê a instrução, confere que já cumpre, e
não sabe o que mudar.

## Reproduction

- **Charter:** CH-public-address-change · **Tour:** Antisocial Tour
- **Environment:** ambiente de paridade `run-isolated.mjs --manual`; celular 375×812, pt-BR, conta `alex@local.test`

1. Abrir `/candidate`.
2. Em Endereço público, digitar `ab` e tocar Salvar endereço.

**Expected:** "O endereço precisa de pelo menos 3 caracteres." e o endereço atual sem mudança.
**Actual:** "Use só letras minúsculas, números e hífen entre eles."; o endereço atual não muda (correto).

## Evidence

- `docs/qa/evidence/2026-09-22-rc-1.22.0/log.txt` (linha `recusa? "ab"`), comparar com a linha `endereço "ab"` da sessão 1
- `docs/qa/evidence/2026-09-22-rc-1.22.0/s3-refusals-375.png`

## Fix

<!-- filled when status moves to fixed -->
- **Root cause:** `minLength={SLUG_MIN}` no campo: o navegador barra o envio de `ab`, o servidor não responde, e o aviso visível é o da tentativa anterior (`-abc`, formato). `validatePublicSlug("ab")` já devolvia `slugTooShort`.
- **Fix commit:** 2371b8b (`fix/bugs-qa-1.22.0`) — campo sem `minLength`; `ab` chega ao domínio e volta com a razão de tamanho.
- **Regression test:** `tests/public-name.test.ts` (atributos do campo); `tests/e2e/ui.mjs` ("endereço curto é recusado pelo tamanho").

## Verification

<!-- filled when status moves to verified -->
- **Retested:**
- **Result:**
