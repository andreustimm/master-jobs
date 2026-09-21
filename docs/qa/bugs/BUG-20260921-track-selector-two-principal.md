# BUG-20260921-track-selector-two-principal: depois de promover outra trilha, Vagas mostra dois botões "PRINCIPAL"

- **Status:** open <!-- open | fixed | verified | wont-fix | invalid -->
- **Impact (user-side):** Trust-Damage
- **Severity:** Medium · **Priority:** P2
- **Persona Affected:** Andreus em triagem
- **Journey Step:** J-manage-target-tracks, passo de tornar outra trilha principal e voltar a Vagas
- **Scenarios:** SRCH-track-primary-archive
- **Found:** 2026-09-21 · **Report:** docs/qa/reports/2026-09-21T175034729239Z-e901131e-qa-buscas.md

## Summary

Toda conta nasce com uma trilha chamada "Principal". Quando a pessoa torna outra
trilha a principal — "laravel", neste caso —, o seletor de trilha da tela Vagas
passa a mostrar **dois botões com o mesmo texto**: `PRINCIPAL` e `PRINCIPAL`,
seguidos de `TODAS AS TRILHAS`. Um é a trilha principal atual, que o botão não
nomeia; o outro é a trilha antiga, que continua se chamando "Principal". Nada na
tela diz qual é qual, e escolher o errado mostra o ranking de outro alvo sem
aviso — a pessoa lê notas de uma trilha achando que são da outra.

## Reproduction

- **Charter:** CH-target-track-edit-archive · **Tour:** Back-Button Tour
- **Environment:** laptop 1280×800 / wifi-fast / pt-BR, ambiente de paridade `run-isolated.mjs --manual`, conta `alex@local.test`

1. Entrar como o dono e abrir Vagas, buscar `laravel` e aceitar a oferta de buscar nas plataformas.
2. Criar a trilha sugerida "laravel".
3. Em Buscas, clicar em TORNAR PRINCIPAL na trilha "laravel".
4. Abrir Vagas e ler a linha TRILHA dos filtros.

**Expected:** uma trilha é a principal, e o seletor deixa claro qual é.
**Actual:** dois botões `PRINCIPAL`; o primeiro leva a `/jobs?fit=45` (a principal, "laravel") e o segundo a `/jobs?fit=45&track=1` (a trilha chamada "Principal").

## Evidence

- `docs/qa/evidence/2026-09-21T175034729239Z-e901131e-qa-buscas/CH-target-track-edit-archive-baseline-seletor-dois-principal.png`
- Leitura independente: em Buscas, depois de recarregar, só "laravel" carrega o selo "principal", e a trilha "Principal" tem o botão TORNAR PRINCIPAL — o estado está certo; é o seletor de Vagas que não o diz.

## Fix

<!-- filled when status moves to fixed -->
- **Root cause:** o botão da trilha principal em `app/filters.tsx` usa o rótulo genérico `filters.trackPrimary` ("principal") em vez do nome da trilha, e os demais botões usam o nome que a trilha tem. A trilha padrão se chama "Principal", então basta ela deixar de ser a principal para os dois rótulos coincidirem. O sintoma é o seletor ambíguo; a causa é o rótulo da principal não nomear a trilha.
- **Fix commit:**
- **Regression test:**

## Verification

<!-- filled when status moves to verified -->
- **Retested:**
- **Result:**
