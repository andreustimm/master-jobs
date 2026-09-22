# BUG-20260922-admin-password-hint-wrong-command: a tela de usuários manda definir a senha com um comando que não existe

- **Status:** fixed <!-- open | fixed | verified | wont-fix | invalid -->
- **Impact (user-side):** Friction
- **Severity:** Medium · **Priority:** P2
- **Persona Affected:** Andreus em triagem (admin criando a conta de outra pessoa)
- **Journey Step:** J-create-own-profile, preparação: o admin cria a conta que a pessoa vai usar
- **Scenarios:** ADMN-new-account-password-hint
- **Found:** 2026-09-22 · **Report:** docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md

## Summary

Em `/admin/users`, logo abaixo de "Criar conta", o texto diz que a conta "não
entra até alguém definir uma [senha] com `jho auth password`". Esse comando não
existe: a CLI responde `error: too many arguments for 'status'`. O comando certo
é `jho auth set-password <email>`, que a própria tela de login ensina. O admin
que segue a instrução da tela fica sem saída até descobrir o nome certo.

## Reproduction

- **Charter:** CH-account-isolation-first-entry · **Tour:** Garbage Collector's Tour
- **Environment:** ambiente de paridade `run-isolated.mjs --manual`; laptop 1280×800, pt-BR (o texto em inglês tem o mesmo comando)

1. Entrar como admin e abrir `/admin/users`.
2. Ler a orientação sob o botão Criar conta.
3. Rodar `jho auth password nina@local.test`.

**Expected:** o comando citado define a senha (`jho auth set-password <email>`).
**Actual:** `error: too many arguments for 'status'. Expected 0 arguments but got 2: password, nina@local.test.`

## Evidence

- `src/core/i18n/pt-BR.ts:755` e `src/core/i18n/en.ts:735` (`noPasswordHint`) citam `jho auth password`.
- `docs/qa/evidence/2026-09-22-rc-1.22.0/s1-admin-edit-nina.png`

## Fix

<!-- filled when status moves to fixed -->
- **Root cause:** `admin.noPasswordHint` nos dois dicionários citava `jho auth password`, que nunca existiu.
- **Fix commit:** 2371b8b (`fix/bugs-qa-1.22.0`) — o texto cita `jho auth set-password <email>`.
- **Regression test:** `tests/public-name.test.ts` ("orientação de senha em /admin/users").

## Verification

<!-- filled when status moves to verified -->
- **Retested:**
- **Result:**
