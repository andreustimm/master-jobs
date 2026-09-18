# BUG-20260917-stale-stages-after-refusal: depois da recusa, a tela só oferece estágios que também serão recusados

- **Status:** verified <!-- open | fixed | verified | wont-fix | invalid -->
- **Impact (user-side):** Trust-Damage
- **Severity:** High · **Priority:** P1
- **Persona Affected:** Andreus em triagem noturna
- **Journey Step:** J-preserve-application-decision, step 2
- **Scenarios:** PIPE-refused-transition-keeps-draft
- **Found:** 2026-09-17 · **Report:** docs/qa/reports/2026-09-17T222310262016Z-5e419094-application-draft-on-rejected-transition.md

## Summary

Quando o servidor recusa a mudança de estágio, o aviso diz "escolha um estágio
alcançável" — e a lista continua sendo a de quando a página foi aberta, que já
não corresponde ao estado gravado. Os dois estágios oferecidos são recusados de
novo, com a mesma mensagem. A escolha da pessoa também volta sozinha para o
estágio antigo; só a nota permanece.

Não há saída pela tela: a pessoa lê uma instrução que a própria tela impede de
cumprir, e o único jeito de sair do laço é recarregar por conta própria.

## Reproduction

- **Charter:** CH-refused-transition-draft · **Tour:** Back-Button Tour
- **Environment:** laptop 1280×900, wifi local, pt-BR; build standalone em http://127.0.0.1:62405 com PostgreSQL isolado

1. Abrir `/jobs/1` com a candidatura em "Preparando" e deixar a aba aberta.
2. Em outra aba, mover a mesma candidatura para "Candidatura enviada" e depois para "Arquivada".
3. Voltar à primeira aba, digitar uma nota, escolher "Candidatura enviada" e salvar.
4. Ler o aviso e tentar cumprir a instrução escolhendo o outro estágio oferecido.

**Expected:** Depois da recusa, a tela mostra o estágio realmente gravado e oferece o que é alcançável a partir dele, preservando a nota.
**Actual:** A lista permanece "Candidatura enviada" e "Preparando" — as duas recusadas a partir de "Arquivada" —, o seletor volta para "Preparando", e a segunda tentativa recebe o mesmo aviso. Só um refresh manual recupera.

## Evidence

- docs/qa/evidence/2026-09-17T222310262016Z-5e419094-application-draft-on-rejected-transition/CH-refused-transition-draft-step3-note-kept.png
- docs/qa/evidence/2026-09-17T222310262016Z-5e419094-application-draft-on-rejected-transition/CH-refused-transition-draft-step4-stale-options-loop.png
- Leitura independente: após recarregar, o detalhe mostra "Arquivada" como único estágio, confirmando que o servidor já estava nesse estado durante todo o laço.

## Fix

- **Root cause:** o sintoma é a lista velha; a causa é que o caminho de recusa
  não revalidava a página — ele retornava antes de qualquer `revalidatePath`,
  porque nada tinha sido escrito. Sem revalidação, a próxima renderização
  reaproveitava o payload de quando a página abriu, com as opções calculadas
  para o estágio antigo. O seletor voltar sozinho era a segunda metade: o valor
  escolhido não existia mais na lista servida.
- **Fix commit:** fa1269d. A recusa passa a revalidar `/jobs/<id>` mesmo sem
  escrita — ela é a prova de que a tela está atrasada — e o formulário aponta o
  seletor para o estágio gravado que o próprio erro carrega. O `key` do
  `TrackForm` saiu junto: remontar a cada mudança de estágio apagaria a nota
  digitada justamente quando a revalidação chega.
- **Regression test:** `tests/e2e/ui.mjs`, no mesmo cenário de duas abas —
  afirma que a lista oferecida é a alcançável a partir do estágio gravado, que
  o seletor aponta para ele e que a nota sobrevive à revalidação. Falhava antes
  da correção com a lista antiga.

## Verification

- **Retested:** 2026-09-17, mesma persona e jornada, build novo com a correção · **Report:** docs/qa/reports/2026-09-17T222310262016Z-5e419094-application-draft-on-rejected-transition.md
- **Result:** depois da recusa, o seletor mostra "Arquivada" como único estágio e a nota continua no campo; a CLI pública confirma `archived` para a mesma identidade após novo login.
