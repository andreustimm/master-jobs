# BUG-20260917-transition-note-never-readable: a nota da candidatura é aceita e nunca mais pode ser lida

- **Status:** verified <!-- open | fixed | verified | wont-fix | invalid -->
- **Impact (user-side):** Data-Loss
- **Severity:** High · **Priority:** P1
- **Persona Affected:** Andreus em triagem noturna
- **Journey Step:** J-preserve-application-decision, step 4
- **Scenarios:** PIPE-save-resume-decision
- **Found:** 2026-09-17 · **Report:** docs/qa/reports/2026-09-17T222310262016Z-5e419094-application-draft-on-rejected-transition.md

## Summary

O detalhe da vaga oferece um campo "nota (opcional)" ao lado do estágio. A
pessoa digita, salva, o sistema confirma — e o texto não volta em superfície
pública nenhuma. O campo esvazia depois de salvar, o funil não o mostra, e a
CLI pública não o exibe em `jobs show`, `pipeline` nem `prep`.

Do ponto de vista de quem digitou, é indistinguível de perda: o produto pediu
o texto, disse que gravou, e não existe caminho para relê-lo. A nota está
gravada em `application_event.detail` e o que a CLI imprime é
`application.notes`, outro campo — mas essa distinção é interna, e nenhuma
tela oferece o histórico de eventos.

Este é o outro sintoma de BUG-20260910, separado aqui porque o defeito é
outro e a correção também: aquele era o rascunho apagado por uma transição
recusada, já corrigido; este é a nota gravada que nenhuma leitura alcança.

## Reproduction

- **Charter:** CH-save-resume-application · **Tour:** Back-Button Tour
- **Environment:** laptop 1280×900, wifi local, pt-BR; build standalone em http://127.0.0.1:62405 com PostgreSQL isolado

1. Entrar como candidato e abrir a vaga pelo ranking em `/jobs`.
2. Escolher "Preparando", digitar "Revisar arquitetura de eventos antes de aplicar." e salvar.
3. Recarregar o detalhe: o estágio está salvo e o campo de nota está vazio.
4. Abrir o Funil: a linha mostra estágio, empresa e cargo, sem a nota.
5. Rodar `jho jobs show 1`, `jho pipeline` e `jho prep 1` com a mesma identidade.

**Expected:** Status e nota correspondem à decisão tomada, como a jornada promete no step 4.
**Actual:** O estágio aparece em todas as superfícies; a nota não aparece em nenhuma.

## Evidence

- docs/qa/evidence/2026-09-17T222310262016Z-5e419094-application-draft-on-rejected-transition/CH-save-resume-application-step3-reachable-stages.png
- Leitura independente: `jho jobs show 1` imprime `Pipeline preparing` e nenhuma nota; `jho pipeline` lista id, status, empresa e cargo; `jho prep 1` monta o dossiê sem citar a nota.

## Fix

- **Root cause:** o sintoma é a nota irrecuperável; a causa é que
  `application_event` era escrito e lido por ninguém. `jobs show` lê
  `application.notes`, outra coluna, e nenhuma tela alcançava o evento.
- **Fix commit:** `cb00cbb` (PR #89) — `applicationTimeline()`, escopada pelo
  candidato da sessão, e a seção de histórico no detalhe da vaga. Antes dela,
  `03ac0f6` fechou a outra metade: a nota escrita sobre um estágio que não muda
  deixou de ser descartada no caminho de no-op.
- **Regression test:** `tests/repo.application.test.ts` — conteúdo e ordem do
  histórico, mais a fronteira contra outro candidato e contra sessão sem escopo.

## Verification

- **Retested:** 2026-09-18, sobre o release candidate promovido (`db5b993`, v1.8.0 em `dev` e `staging`) · **Report:** docs/qa/reports/2026-09-18T022259704434Z-6535cca7-release-candidate-1.8.0-promovido.md
- **Result:** a nota escrita ao mover a candidatura aparece no histórico
  (`2026-09-18 · registered at Shortlisted`, seguida do texto), sobrevive a
  refresh e a um novo login. A nota escrita sem mudar de estágio aparece como
  `2026-09-18 · note`. Uma segunda conta de candidato e a sessão de recrutadora
  não veem histórico nenhum.
