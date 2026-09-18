# QA Run Report — 2026-09-17T222310262016Z-5e419094 — reteste do BUG-20260910

- **Scope:** branch `codex/application-draft-on-rejected-transition` — o seletor de estágio do funil passa a oferecer só o alcançável a partir do estágio atual, e uma transição recusada preserva a nota digitada e nomeia os dois estágios.
- **Cadence tier:** targeted
- **Build:** fa1269d (sessões 1–2 rodaram em 9951222; o reteste rodou no build com a correção) · **Environment:** build standalone do harness E2E (`next build` + `server.js`), PostgreSQL isolado e login de runtime sem privilégio administrativo; sem mocks. Portas efêmeras: 62405 (primeira rodada) e 49207 (reteste).
- **Started:** 2026-09-17T22:23:10Z · **Status:** closed <!-- in-progress | closed -->

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Andreus em triagem noturna | Power User | laptop 1280×900 / wifi local / pt-BR | CH-save-resume-application, CH-refused-transition-draft |
| Andreus em triagem | Power User | laptop 1280×900 / wifi local / pt-BR | canária de abertura direta |

## Flows in Scope

- `J-preserve-application-decision` — a pessoa não perde suas decisões e retoma uma candidatura com o status e a nota corretos (`../journeys/J-preserve-application-decision.md`)
- `J-open-dashboard-direct` — canária adjacente: abrir o produto direto e chegar a uma tela operável (`../journeys/J-open-dashboard-direct.md`)

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | CH-refused-transition-draft | J-preserve-application-decision / PIPE-refused-transition-keeps-draft | Andreus em triagem noturna | Back-Button Tour | Fixed | BUG-20260917-stale-stages-after-refusal | fa1269d |
| 2 | CH-save-resume-application | J-preserve-application-decision / PIPE-save-resume-decision | Andreus em triagem noturna | Back-Button Tour | Blocked (human decision) | BUG-20260917-transition-note-never-readable | |
| 3 | canária de abertura direta | J-open-dashboard-direct / — | Andreus em triagem | Landmark Tour | Pass | | |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

A linha 3 não assenta cenário: o cenário durável da jornada
(`PWA-direct-load-startup-singleton`) afirma splash de 900 ms e ausência de
overlay empilhado, com a persona móvel — a canária desta rodada foi desktop e
não mediu tempo. Ele continua `untested`, e essa é a lacuna honesta desta
cobertura, não uma linha verde emprestada.

## Session Debriefs

### CH-save-resume-application — Andreus em triagem noturna

- **Ran:** 2026-09-17T22:25Z → 2026-09-17T22:52Z (box respeitado: sim)
- **Findings:**
  - A metade do status cumpre a promessa inteira: gravado no detalhe, relido após refresh, presente no funil, mantido depois de sair e entrar de novo, e igual em `jho jobs show 1`.
  - A metade da nota não existe como leitura. O campo "nota (opcional)" aceita texto, confirma gravação, esvazia — e o texto não volta em tela nenhuma nem em `jobs show`, `pipeline` ou `prep`. Data-Loss pela régua: dado do usuário tornado inacessível sem consentimento.
  - Com a candidatura em "Preparando", o seletor oferece apenas "Preparando" e "Candidatura enviada". "Em entrevista" — a escolha que originou o BUG-20260910 — não é mais oferecida.
- **Bugs filed/updated:** [BUG-20260917-transition-note-never-readable, BUG-20260910-application-edit-not-retained]
- **Scenarios settled:** PIPE-save-resume-decision → blocked-decision
- **Paper cuts:** o sucesso limpa a nota sem dizer para onde ela foi; some da tela no mesmo instante em que o sistema diz "concluído".
- **Surprises:** a distinção entre `application.notes` e `application_event.detail` é invisível para quem usa, e a UI não oferece nenhuma porta para o segundo.
- **Suggested next charter:** uma sessão sobre histórico da candidatura, se a decisão humana for exibir eventos.

### CH-refused-transition-draft — Andreus em triagem noturna

- **Ran:** 2026-09-17T22:52Z → 2026-09-17T23:20Z (box respeitado: sim)
- **Findings:**
  - A recusa provocada pela via pública (segunda aba arquivando a candidatura) preserva a nota digitada e avisa "O funil não vai de Arquivada para Candidatura enviada". As duas metades do cenário, na mesma tentativa.
  - Achado novo: depois da recusa a tela continuava com a lista de quando abriu. Os dois estágios oferecidos eram recusados de novo, com a mesma mensagem, e a escolha voltava sozinha para o estágio antigo. A instrução "escolha um estágio alcançável" não podia ser cumprida sem um refresh manual.
- **Bugs filed/updated:** [BUG-20260917-stale-stages-after-refusal]
- **Scenarios settled:** PIPE-refused-transition-keeps-draft → pass (após a correção e o reteste)
- **Paper cuts:** nenhum além do achado acima.
- **Surprises:** a correção original tornou a recusa quase inalcançável por clique, e isso escondeu o quanto o caminho de recuperação dela estava pior.
- **Suggested next charter:** concorrência entre abas em outras mutações do funil.

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-preserve-application-decision | friction | pass | pass | pass | pass (após fa1269d; era `fail`) | pass | Usabilidade: a nota aceita e nunca relida (BUG-20260917-transition-note-never-readable). Recuperação de erro: laço de recusa corrigido e retestado; axe 8/8 na suíte automatizada. |
| J-open-dashboard-direct | pass | pass | pass | pass | pass | pass | Abertura direta leva ao cockpit operável, com números e ranking. |

## What Was Fixed

### BUG-20260917-stale-stages-after-refusal: depois da recusa, a tela só oferece estágios que também serão recusados
- **Symptom:** o aviso pedia um estágio alcançável enquanto a lista continuava a de quando a página abriu; toda escolha era recusada de novo e a seleção voltava sozinha.
- **Root cause:** o caminho de recusa retornava sem `revalidatePath` — nada tinha sido escrito —, então a renderização seguinte reusava o payload antigo, com as opções do estágio anterior.
- **Fix:** fa1269d — a recusa revalida `/jobs/<id>` mesmo sem escrita, o formulário aponta o seletor para o estágio que o erro carrega, e o `key` do `TrackForm` saiu para a revalidação não apagar a nota.
- **Regression test:** `tests/e2e/ui.mjs` — lista oferecida, seleção e nota conferidas depois da recusa de duas abas; falhava antes com a lista antiga.
- **Retested:** J-preserve-application-decision re-andada em build novo, mesma persona; canária de abertura direta reexecutada.

## Paper Cuts

| Persona | Where (journey/step) | Felt | Sharpness | Outcome |
|---|---|---|---|---|
| Andreus em triagem noturna | J-preserve-application-decision step 2 | "escrevi uma nota, o sistema disse que salvou, e ela sumiu da tela sem dizer para onde foi" | sharp | virou BUG-20260917-transition-note-never-readable; decisão humana |

## Runtime Errors Observed

- Nenhum. O console ficou limpo durante as sessões, inclusive nas duas recusas.

## Human Verifications Needed

- Nenhuma. Todas as pernas desta rodada são alcançáveis pela interface pública.

## Decisions for a Human

### A nota da candidatura é aceita e nunca mais pode ser lida (BUG-20260917-transition-note-never-readable)
- What's broken: o campo "nota (opcional)" grava em `application_event.detail`, e nenhuma superfície pública lê esse campo — nem a UI, nem `jho jobs show`, `jho pipeline` ou `jho prep`. Evidência no relatório e na reprodução do bug.
- Why not auto-fixed: falha o teste de "sem trade-off de produto" do governor. Existem três respostas defensáveis e elas levam o produto a lugares diferentes.
- Options:
  1. Gravar também em `application.notes` — a CLI passa a mostrar, mas a nota vira estado mutável da candidatura e a última sobrescreve as anteriores.
  2. Exibir o histórico de `application_event` no detalhe e no funil — preserva a natureza append-only e é mais trabalho de UI; é a única opção que mostra a nota junto da transição que ela explica.
  3. Retirar o campo até existir leitura — honesto, e remove uma função que a pessoa usa hoje mesmo sem poder reler.
- Recommendation: opção 2. O evento já é a fonte da verdade do funil, e a nota só significa alguma coisa colada à transição que a motivou; a opção 1 apaga história e a 3 tira função sem devolver nada.

## Learnings

- Restringir o que a tela oferece reduziu o caminho de erro a quase zero — e foi justamente isso que expôs como a recuperação depois do erro estava ruim. Fechar a porta comum torna a porta rara mais importante, não menos.
- Uma suíte verde não viu nenhum dos dois achados desta rodada: um exigia comparar o que a tela oferece com o que o servidor tem, o outro exigia procurar um texto digitado em todas as superfícies públicas. Jornada em persona é o instrumento que enxerga isso.
- Rodar a suíte E2E com o ambiente manual de QA de pé produziu duas falhas por timeout que não se reproduzem isoladas. Ambiente de jornada e suíte automatizada não devem dividir a máquina.

## Final Status

- **Exit gate (full automated suite):** `pnpm check` → `Test Files 163 passed (163)`, `Tests 2207 passed | 7 skipped (2214)`, `Statements 95.95% · Branches 92.32% · Functions 96.2% · Lines 96.85%`, contratos do tracker `Ran 13 tests ... OK`. `pnpm test:e2e` → `231/231 verificações passaram`, `8/8 páginas sem violações axe WCAG 2.2 AA`.
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 1 (aberto, aguardando decisão humana) · Trust-Damage 1 (corrigido e verificado) · Friction 0 · Cosmetic 0
- **Coverage:** 2 jornadas andadas de 2 em escopo; o cenário de splash da canária (`PWA-direct-load-startup-singleton`) continua `untested` e está declarado acima.
- **Verdict:** ready-with-blocked-items — a correção do BUG-20260910 está verificada pela interface pública e o defeito que ela expôs foi corrigido e retestado; o que resta é uma decisão de produto sobre onde a nota da candidatura deve ser lida.
