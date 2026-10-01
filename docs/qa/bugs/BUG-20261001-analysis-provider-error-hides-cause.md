# BUG-20261001-analysis-provider-error-hides-cause: a análise estruturada falha sempre com "provider_error" e nada diz que os modelos NIM do cadastro saíram do ar

- **Status:** fixed
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

- **Root cause:** duas. (1) `processNextAnalysis`
  (`src/core/llm/job-analysis.ts`) gravava `provider_error` para todo
  `LlmError` que não fosse 429 e descartava o status HTTP: a tela não tinha
  como separar modelo desligado de chave sem permissão nem de provedor
  instável. (2) O cadastro (`src/core/llm/registry.ts`) semeava os três
  modelos NIM, já desligados pelo provedor, e `chooseModel` caía no primeiro
  com chave (Kimi K2, em ordem alfabética) quando o padrão não tinha chave.
- **Fix commit:** `908592fe`. Coluna `job_analysis.provider_status`
  (migração `0032`, aditiva) com só o número do status; `failureCause` dá a
  causa (404/410 modelo desligado, 401/403 chave sem permissão, 5xx/408/rede
  provedor instável, outro 4xx recusado, `provider_error` sem status
  desconhecida — as linhas antigas continuam legíveis); o painel do admin
  mostra a causa pelo dicionário e o botão vira "Tentar após trocar o modelo"
  quando repetir falharia de novo. `src/core/llm/model-retirement.ts` lista
  os modelos desligados com status e data: a semente não os cadastra, a
  `jho llm list` os sinaliza, `chooseModel` não os escolhe, `jho llm use`
  recusa. Sem modelo vivo, a CLI diz "Nenhum modelo disponível: escolha um"
  e não reivindica nada.
- **Regression test:** `tests/job-analysis.test.ts` (410, 403, status
  inválido e linha antiga), `tests/job-structure.test.ts` (`failureCause`,
  `httpStatusOf`), `tests/llm-registry.test.ts` (seis casos de modelo
  desligado), `tests/cov-cli-rede-llm.test.ts` e
  `tests/cov-cli-analysis.test.ts` (saída da CLI), e a área E2E
  `job-analysis` (seis verificações novas: causa 410, botão, linha antiga,
  375 px).
- **Fora do código:** a chave NVIDIA do dono recebe 403 nos modelos vivos;
  autorizá-la (ou escolher outro provedor/modelo) é do dono. Sem isso, o
  caminho de sucesso da análise segue sem observação.

## Verification

- **Retested:** 2026-10-01, `node tests/e2e/run-isolated.mjs --areas job-analysis`
  26/26 (com `auth`): admin, depois de `reload`, lê "Modelo desligado…" na
  tentativa recusada com 410 e "HTTP 410" na linha, o botão diz "Tentar após
  trocar o modelo" e cabe em 375 px, a tentativa antiga sem status aparece
  como causa desconhecida. Provedor falso na borda (nenhuma chamada real).
- **Result:** pass no E2E; reteste de jornada com o provedor real pendente
  da chave autorizada.
