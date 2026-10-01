# BUG-20261001-analysis-provider-error-hides-cause: a análise estruturada falha sempre com "provider_error" e nada diz que os modelos NIM do cadastro saíram do ar

- **Status:** open
- **Impact (user-side):** Trust-Damage
- **Severity:** High · **Priority:** P1
- **Persona Affected:** Andreus em triagem (admin)
- **Journey Step:** J-read-structured-job-analysis, passo 2 (recarregar depois que o operador processou a fila)
- **Scenarios:** JOBS-structured-analysis
- **Found:** 2026-10-01 (visto também em 2026-09-28, sem registro) · **Report:** docs/qa/reports/2026-10-01-qa-223-verificacoes.md

## Summary

Depois de `jho analysis run`, a tela da vaga diz "A última tentativa não
terminou (falhou)" e o painel do admin mostra só "erro: provider_error", com o
botão "Tentar de novo". A pessoa não tem como saber que o modelo padrão do
cadastro (NVIDIA NIM · Kimi K2) foi desligado pelo provedor em 2026-05-12, nem
que tentar de novo repete a mesma falha: o erro não traz próximo passo. Os três
modelos NIM que `jho llm seed` cadastra estão fora do ar.

## Reproduction

- **Charter:** CH-structured-analysis-first-read · **Tour:** Feature Tour
- **Environment:** laptop, wifi-fast, pt-BR; `pnpm dev` local contra PostgreSQL
  descartável, chave NVIDIA do operador no ambiente (nunca em arquivo)

1. Como admin, cadastrar uma vaga em `/compare` e, em `/jobs/<id>`, pedir a
   análise; recarregar (fica pendente).
2. No terminal do operador: `jho analysis run --max 1 --yes` (imprime
   `{"id":1,"status":"failed"}`).
3. Recarregar `/jobs/<id>` como admin.

**Expected:** o erro diz o que aconteceu (modelo desligado, chave sem
permissão, provedor instável) e o cadastro não oferece como padrão um modelo
desligado.
**Actual:** "modelo nvidia/moonshotai/kimi-k2-instruct · erro: provider_error".

## Evidence

- `docs/qa/evidence/2026-10-01-qa-223-verificacoes/CH-structured-analysis-first-read-falhou.png`
- Leitura independente (chamadas diretas ao provedor, uma por modelo, 1 token de
  saída): `moonshotai/kimi-k2-instruct` HTTP 410 (fim de vida em 2026-05-12),
  `qwen/qwen3-coder-480b-a35b-instruct` HTTP 410 (2026-06-11),
  `meta/llama-3.1-405b-instruct` HTTP 404. Chave de controle inválida: 401; a
  chave configurada: 403 em cinco modelos vivos (autentica, sem autorização) —
  causa de conta, fora do código.
- Issue: #438.

## Fix

<!-- Hipótese de causa, não confirmada por correção: `processNextAnalysis`
(`src/core/llm/job-analysis.ts`) grava `provider_error` para todo `LlmError`
que não seja 429 e descarta o status HTTP; o cadastro (`src/core/llm/registry.ts`)
não tem como saber que um modelo foi desligado. -->

## Verification

<!-- pendente -->
