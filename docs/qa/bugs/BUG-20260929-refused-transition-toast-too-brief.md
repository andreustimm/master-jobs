# BUG-20260929-refused-transition-toast-too-brief: toast de recusa de transição some rápido demais para ler

- **Status:** verified
- **Impact (user-side):** Friction
- **Severity:** Low · **Priority:** P3
- **Persona Affected:** Andreus em triagem noturna
- **Journey Step:** J-preserve-application-decision, passo de tentar uma transição de estágio recusada
- **Scenarios:** PIPE-refused-transition-keeps-draft
- **Found:** 2026-09-29 · **Report:** docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md

## Summary

O comportamento central do cenário está correto — a transição recusada
mantém o rascunho intacto. Mas o toast que explica a recusa some em
aproximadamente 4 segundos, tempo curto demais para uma pessoa ler a
mensagem completa numa primeira passada, especialmente para quem depende de
leitor de tela ou tem baixa visão. Não impede a tarefa (o rascunho
permanece), mas deixa a pessoa sem saber por que a transição foi recusada
sem precisar tentar de novo.

## Reproduction

- **Charter:** CH-refused-transition-draft · **Tour:** Feature Tour
- **Environment:** `next dev` local (127.0.0.1:3210), pt-BR, conta
  `qa-full-candidate`

1. Entrar como o candidato e abrir o funil (`/pipeline`).
2. Tentar uma transição de estágio que o produto recusa.
3. Cronometrar quanto tempo o toast de recusa permanece visível.

**Expected:** tempo suficiente para leitura confortável (referência comum:
5-7 s para mensagens curtas, ou até interação/foco do usuário).
**Actual:** toast desaparece em ~4 s.

## Evidence

- `docs/qa/evidence/2026-09-29T035351654581Z-97f37e1c-full/CH-refused-transition-draft/step3-toast-visible.png`

## Fix

<!-- filled when status moves to fixed -->
- **Root cause:** recusa usava a duração genérica de cinco segundos; agora define sete segundos.
- **Fix commit:** 5b70e2c (PR #407 draft).
- **Regression test:** pipeline E2E falhou antes aos seis segundos e passou depois (27/27).

## Verification

<!-- filled when status moves to verified -->
- **Retested:** 2026-09-29, duas abas, pt-BR, 375px, ambiente descartável.
- **Result:** Pass. Aviso legível aos seis segundos, nota preservada e salva em transição válida sem redigitar; refresh, novo login e CLI confirmam persistência. Relatório: docs/qa/reports/2026-09-29T141040713402Z-531aac7a-recusa-transicao-legivel.md
