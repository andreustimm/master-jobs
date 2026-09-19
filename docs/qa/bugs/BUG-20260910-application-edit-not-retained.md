# BUG-20260910-application-edit-not-retained: edição da candidatura não é relida como enviada

- **Status:** verified
- **Impact (user-side):** Data-Loss
- **Severity:** Critical · **Priority:** P0
- **Persona Affected:** Andreus em triagem noturna
- **Journey Step:** J-preserve-application-decision, steps 2–4
- **Scenarios:** PIPE-save-resume-decision
- **Found:** 2026-09-10 · **Report:** docs/qa/reports/2026-09-10T011143000000Z-8bd417c2-supabase-production.md

## Summary

A pessoa escolhe um status e digita uma nota, mas não consegue reler a edição
completa após salvar. A primeira mudança para Preparando persistiu entre sessões;
a nota não apareceu na CLI. Na segunda edição, Em entrevista e a nova nota
estavam visíveis antes de Salvar; depois, tela e CLI continuaram em Preparando.
Classificação provisória pela edição digitada não recuperável na superfície
pública. Não há prova de destruição do registro anterior nem de causa no banco.

## Reproduction

- **Charter:** CH-save-resume-application · **Tour:** Back-Button Tour
- **Environment:** laptop, 1280×577, wifi local, pt-BR; standalone PostgreSQL 17 isolado.

1. Entrar, abrir Senior Software Architect da Aurora Sistemas pelo ranking.
2. Selecionar Preparando, digitar uma nota e salvar.
3. Recarregar, abrir Funil, sair e entrar novamente: Preparando permanece.
4. Consultar `jho jobs show 1`: status preparing, sem a nota digitada.
5. Abrir o detalhe novamente, escolher Em entrevista e digitar
   “Entrevista técnica marcada para sexta-feira às 14h.”.
6. Conferir os valores visíveis e salvar. Consultar novamente a CLI.

**Expected:** O status escolhido persiste e a nota tem uma leitura pública confirmável.
**Actual:** Na segunda edição, o formulário limpa a nota e volta a Preparando;
o selo e a CLI também permanecem em preparing, sem nota. Na primeira edição,
houve divergência transitória entre o selo Preparando e o seletor Pré-selecionada.

## Evidence

- `docs/qa/evidence/2026-09-10T011143000000Z-8bd417c2-supabase-production/CH-save-resume-application-baseline-before-save.png`
- `docs/qa/evidence/2026-09-10T011143000000Z-8bd417c2-supabase-production/CH-save-resume-application-baseline-after-save.png`
- `docs/qa/evidence/2026-09-10T011143000000Z-8bd417c2-supabase-production/CH-save-resume-application-baseline-new-session.png`
- CLI pública executada duas vezes: `Pipeline preparing`, sem nota; saída descrita no relatório.

## Fix

- **Root cause:** diagnóstico após encerrar a sessão: `preparing → interviewing`
  é uma transição ilegal, explicitamente rejeitada pelo domínio; o servidor
  registrou IllegalApplicationTransitionError. `MutationFeedbackForm` captura
  o erro e resolve a action com status error, permitindo o reset dos campos
  não controlados. O rascunho digitado é limpo apesar da rejeição.
  `trackAction`, o domínio e esse componente não têm diff contra origin/dev:
  não é uma regressão demonstrada da migração.
- **Nota:** `setApplicationStatusInTransaction` grava o detalhe em
  `application_event.detail`; `jobs show` lê `application.notes`, outro campo.
  Sua ausência na CLI não prova perda da nota de transição. Essa parte da
  expectativa de QA estava errada; a preservação do evento continua coberta
  pela carga com hash por tabela, não por essa CLI.
- **Fix commit:** f16c2b4, com 916c531 preservando o padrão `shortlisted` de uma
  candidatura ainda não registrada. O seletor passa a ser derivado de
  `allowedTransitions()`, que lê o mesmo `LEGAL_TRANSITIONS` da política de
  transição, então a recusa deixa de ser alcançável por clique. Ela continua
  possível quando outra aba move a candidatura primeiro, e por isso
  `trackAction` devolve a recusa como dado tipado: o formulário guarda o estado
  em React, o rascunho sobrevive e a mensagem nomeia os dois estágios.
- **Regression test:** `tests/repo.application.test.ts` afirma que o que
  `allowedTransitions` oferece é exatamente o que `transitionApplication`
  aceita, status a status; `tests/application-status-ui.test.ts` cobre a lista
  traduzida; e `tests/e2e/ui.mjs` reproduz a recusa com duas abas e verifica que
  a nota digitada continua na tela depois dela.

## Verification

- **Retested:** 2026-09-17, Andreus em triagem noturna, J-preserve-application-decision, build standalone com PostgreSQL isolado · **Report:** docs/qa/reports/2026-09-17T222310262016Z-5e419094-application-draft-on-rejected-transition.md
- **Result:** com a candidatura em "Preparando", o seletor oferece apenas
  "Preparando" e "Candidatura enviada" — "Em entrevista" deixou de ser
  escolhível, então a recusa não é mais alcançável por clique. Provocada pela
  via pública (outra aba arquivou a candidatura), a recusa mantém
  "Entrevista técnica marcada para sexta-feira às 14h." no campo e avisa
  "O funil não vai de Arquivada para Candidatura enviada".
- **Observação:** a nota gravada continua sem caminho de leitura em superfície
  pública alguma. Isso não é este defeito — foi registrado em
  BUG-20260917-transition-note-never-readable e aguarda decisão humana.
- **Presente no release candidate:** o Full de 17/09 percorreu `676d5e0`, o
  código que está em `staging` e é o objeto da PR #80, e o defeito reproduz ali
  com a nota descartada e o aviso genérico. `verified` descreve a branch de
  correção, não o RC: enquanto a PR #87 não promover, o corte para produção leva
  este defeito junto. Relatório:
  docs/qa/reports/2026-09-17T232350685065Z-1cb4e9bd-release-candidate-1.7.1-full.md

## Diagnóstico refinado (2026-09-10)

O achado confirmado é descarte do rascunho após rejeição, não falha de persistir
uma transição permitida. O primeiro status salvo permaneceu correto. A opção
inválida oferecida pelo seletor e a leitura pública de detalhes do histórico
exigem revisão do fluxo existente. Não mudar as regras de transição para fazer
o cenário passar. Correção fica separada da conversão de banco; ainda precisa
de teste de regressão e reteste de jornada antes de qualquer veredito Fixed.
