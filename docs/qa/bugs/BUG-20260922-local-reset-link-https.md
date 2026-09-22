# BUG-20260922-local-reset-link-https: o link de recuperação impresso no terminal local não abre

- **Status:** open <!-- open | fixed | verified | wont-fix | invalid -->
- **Impact (user-side):** Friction
- **Severity:** Low · **Priority:** P3
- **Persona Affected:** Candidato após falha, no ambiente local com build de produção
- **Journey Step:** J-manage-own-account, recuperação: abrir o link recebido
- **Scenarios:** AUTH-recovery-same-answer
- **Found:** 2026-09-22 · **Report:** docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md

## Summary

Sem Resend, o processo local imprime o e-mail de recuperação no terminal, como
previsto. Mas com o build de produção servido em loopback (`pnpm build` e
`pnpm start`, e o próprio harness de paridade), o link sai como
`https://127.0.0.1:<porta>/login/reset?token=…` e o servidor só fala HTTP: o
navegador responde `ERR_SSL_PROTOCOL_ERROR`. Trocando o esquema para `http` à
mão, a página abre e o resto do fluxo funciona. Em produção o link é HTTPS e
correto; o defeito é só do processo local.

`requestResetAction` (`app/login/forgot/actions.ts`) decide o esquema por
`NODE_ENV === "production"`, que é verdadeiro no build local. Existe desde a
F-05 (`d800d2b9`); não é regressão da 1.22.0.

## Reproduction

- **Charter:** CH-own-account-sessions · **Tour:** Saboteur Tour
- **Environment:** ambiente de paridade `run-isolated.mjs --manual`; laptop 1280×800, pt-BR

1. Abrir `/login/forgot`, informar `daniel@local.test` e enviar.
2. Copiar o link impresso no terminal do servidor.
3. Abrir o link no navegador.

**Expected:** a tela Definir nova senha.
**Actual:** `net::ERR_SSL_PROTOCOL_ERROR`; o mesmo token com `http://` abre a tela.

## Evidence

- `docs/qa/evidence/2026-09-22-rc-1.22.0/log.txt` ("link como impresso (https) falha: … ERR_SSL_PROTOCOL_ERROR")
- Saída do harness: bloco do e-mail de recuperação com `https://127.0.0.1:57522/login/reset?token=…`

## Fix

<!-- filled when status moves to fixed -->
- **Root cause:**
- **Fix commit:**
- **Regression test:**

## Verification

<!-- filled when status moves to verified -->
- **Retested:**
- **Result:**
