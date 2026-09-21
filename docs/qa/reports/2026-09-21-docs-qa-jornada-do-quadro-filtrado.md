# QA Run Report — 2026-09-21 — docs/qa-jornada-do-quadro-filtrado

- **Scope:** a jornada nova `J-trust-the-filtered-board`, derivada das mudanças
  visíveis das PRs #159 (14 Major + 13 Minor da revisão profunda) e #161
  (cobertura). Canária adjacente: `J-switch-workspace-screen`, pela concorrência.
- **Cadence tier:** targeted
- **Build:** `88415f7` · **Environment:** `http://127.0.0.1:55424`, build de
  paridade de produção servido por `node tests/e2e/run-isolated.mjs --manual`
  (Next em modo standalone, PostgreSQL temporário próprio, `JHO_AUTH_MODE=secure`).
- **Started:** 2026-09-21T03:40:00Z · **Closed:** 2026-09-21T04:55:00Z · **Status:** closed

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Andreus em triagem | dono do produto, admin+candidate | desktop / wifi-fast / pt-BR | CH-filtered-board-numbers-agree, CH-filtered-board-fields-follow-url, CH-grouped-job-reaches-the-right-country, CH-heavy-screen-asked-twice |
| Recrutadora convidada | conta `recruiter`, sem funil | desktop / wifi-fast / pt-BR | CH-filtered-board-numbers-agree (fronteira de papel) |

Contas semeadas pelo harness manual, senha local-only versionada em
`tests/e2e/setup-manual.ts`. Nenhuma credencial de produção é usada, e o harness
recusa URL de banco do usuário por construção.

## Flows in Scope

- `J-trust-the-filtered-board` — estreitar o quadro e confiar no que ele diz
  (`../journeys/J-trust-the-filtered-board.md`) · P0
- `J-switch-workspace-screen` — canária adjacente, pelo caminho de concorrência
  (`../journeys/J-switch-workspace-screen.md`) · P0

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | CH-filtered-board-numbers-agree | J-trust-the-filtered-board / JOBS-cockpit-count-matches-list | Andreus em triagem | Money Tour | Pass | | |
| 2 | CH-filtered-board-numbers-agree | J-trust-the-filtered-board / JOBS-score-range | Andreus em triagem | Money Tour | Pass | | |
| 3 | CH-filtered-board-numbers-agree | J-trust-the-filtered-board / JOBS-employer-filter | Andreus em triagem | Money Tour | Pass | | |
| 4 | CH-filtered-board-numbers-agree | J-trust-the-filtered-board / JOBS-hide-already-sent | Andreus em triagem | Money Tour | Pass | | |
| 5 | CH-filtered-board-numbers-agree | J-trust-the-filtered-board / JOBS-pay-filter | Andreus em triagem | Money Tour | Pass | | |
| 6 | CH-filtered-board-fields-follow-url | J-trust-the-filtered-board / JOBS-filter-fields-follow-url | Andreus em triagem | Back-Button Tour | Blocked (needs human verify) | | |
| 7 | CH-filtered-board-fields-follow-url | J-trust-the-filtered-board / JOBS-source-multi-select | Andreus em triagem | Back-Button Tour | Blocked (needs human verify) | | |
| 8 | CH-grouped-job-reaches-the-right-country | J-trust-the-filtered-board / JOBS-group-repeated-countries | Andreus em triagem | Feature Tour | Skipped | | |
| 9 | CH-grouped-job-reaches-the-right-country | J-trust-the-filtered-board / JOBS-country-hub | Andreus em triagem | Feature Tour | Skipped | | |
| 10 | CH-grouped-job-reaches-the-right-country | J-trust-the-filtered-board / JOBS-group-canonical-survives-filter | Andreus em triagem | Feature Tour | Skipped | | |
| 11 | CH-grouped-job-reaches-the-right-country | J-trust-the-filtered-board / JOBS-anonymous-employer-never-groups | Andreus em triagem | Feature Tour | Skipped | | |
| 12 | CH-heavy-screen-asked-twice | J-switch-workspace-screen / JOBS-concurrent-heavy-screens | Andreus em triagem | Multi-Tab Tour | Skipped | | |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Session Debriefs

### CH-filtered-board-numbers-agree — Andreus em triagem

- **Ran:** 2026-09-21T03:40Z → 2026-09-21T04:05Z (caixa de 60 min respeitada: sim, fechou em 25)
- **Como entrou:** `/login`, trocando o idioma para português pelo seletor da
  própria tela, e autenticando com senha. O login levou a `/`, que é a rota do
  pós-login — o mesmo caminho da persona.
- **Findings:** nenhum defeito. As cinco asserções do charter passaram pela
  interface pública, e duas delas são exatamente os defeitos que a revisão
  profunda achou:

  | O que foi andado | Observável |
  |---|---|
  | `/` e `/jobs` sem filtro, mesma URL | "1 correspondem" nas duas telas — a mesma pergunta com a mesma resposta |
  | `/?company=Aurora` (empregador que existe) | 1 na lista, 1 no número |
  | `/?company=NaoExisteEssaEmpresa` | **0 artigos e "0 correspondem"** — antes o número ficava no total sem filtro enquanto a lista esvaziava |
  | `/?fit=0&fitMax=50` contra vaga de fit 84 | 0 e 0 |
  | `/?fit=0&fitMax=84` | 1 e 1 — **o teto é inclusivo**, que é o que separa `<=` de `<` |
  | `/?notApplied=1` sobre vaga não enviada | 1 e 1 |
  | `/jobs?pay=1000000&payMax=2000000&cur=USD&per=year` | 1 — vaga sem salário PERMANECE na faixa (regra 8) |
  | O mesmo com `&disclosed=1` | 0 — o outro lado da regra 8 |

- **Fronteira de papel, no mesmo charter:** entrando como `renata@local.test`
  (papel `recruiter`, sessão de navegador separada), `/` redireciona para `/jobs`
  — como a política manda — e a fileira de funil **não existe** ali: zero
  ocorrências de "ainda não enviadas", contra "AINDA NÃO ENVIADAS · 1" na mesma
  tela para o dono. Era o Minor 6 da revisão, e está provado pela interface.
- **Confirmação independente:** o zero de `?company=NaoExisteEssaEmpresa`
  sobreviveu a um refresh (0 artigos e "0 correspondem" de novo), que é o
  requisito de prova — UI otimista não conta.
- **Bugs filed/updated:** nenhum.
- **Scenarios settled:** JOBS-cockpit-count-matches-list → pass ·
  JOBS-score-range → pass · JOBS-employer-filter → pass ·
  JOBS-hide-already-sent → pass · JOBS-pay-filter → pass
- **Paper cuts:** ver a seção Paper Cuts — um dull.
- **Surprises:** a tela abre em inglês para um navegador sem o cookie de idioma,
  inclusive para uma conta cujo dono é brasileiro. Não é defeito (o seletor está
  ali e funciona), mas é o primeiro contato.
- **Suggested next charter:** CH-filtered-board-fields-follow-url, que é o único
  dos quatro que exige navegação suave sem refresh — e por isso o único que a
  suíte de browser não consegue ver.

### CH-filtered-board-fields-follow-url — Andreus em triagem

- **Ran:** 2026-09-21T04:05Z → 2026-09-21T04:40Z (caixa de 60 min respeitada: sim)
- **O que ficou PROVADO pela interface:** aterrissando em
  `?pay=12000&payMax=6000&cur=USD&per=month`, os dois campos numéricos mostram
  **6000 e 12000** e os dois punhos do slider mostram 6000 e 12000 — o servidor
  troca os lados e o campo acompanha. Era a primeira metade do defeito: antes o
  campo guardava 12000/6000 porque `useState` só lê o inicializador na montagem.
- **O que NÃO ficou provado, e por quê:** a segunda metade do cenário exige
  navegação **suave** entre estados de filtro (o "limpar", os atalhos de corte)
  **sem refresh**, e é exatamente aí que o defeito original vivia. Não consegui
  completar: o driver de navegador degradou no meio da sessão — os cliques
  passaram a responder `✓ Done` sem efeito e depois o daemon devolveu
  `Resource temporarily unavailable (os error 35) ... daemon may be busy`.
  Fechei e reabri uma vez, como o contrato manda, e na sessão nova o cookie de
  sessão deixou de sobreviver entre chamadas de `open` (todo destino autenticado
  voltava a `/login`). Não é conclusão sobre o produto: é o instrumento.
- **O que eu quase reportei como defeito, e não é:** apertar APLICAR sem editar
  campo nenhum não muda a URL. Parecia "o botão está inerte", mas o controle
  mostrou o mesmo comportamento numa URL já ordenada, onde não mudar É o
  resultado certo. Um valor digitado (`7000`, e depois o próprio `6000`) submete
  e produz a URL ordenada. Fica como observação, não como achado.
- **Erro meu de medição, registrado de propósito:** a primeira leitura da URL
  depois do clique foi **antes** de a navegação suave assentar, e eu li a URL
  antiga. Só depois de `wait --load networkidle` a leitura passou a valer. É a
  mesma armadilha que já está em memória do projeto ("espere o estado").
- **Bugs filed/updated:** nenhum. Não filo defeito que não consegui estabelecer.
- **Scenarios settled:** nenhum. `JOBS-filter-fields-follow-url` e
  `JOBS-source-multi-select` ficam `blocked-verify`.
- **Paper cuts:** nenhum novo.
- **Suggested next charter:** repetir este mesmo charter com o driver saudável,
  e antes dele conferir a saúde do `agent-browser` — a sessão perdeu metade da
  caixa investigando o instrumento em vez do produto.

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-trust-the-filtered-board | pass | não avaliada | pass | não avaliada | não avaliada | pass | Usabilidade e desempenho percebido avaliados na sessão 1 (resposta imediata em todas as URLs de filtro, números coerentes). Acessibilidade, compatibilidade e recuperação de erro **não foram avaliadas**: exigem a passada de lentes de 45 min, que não aconteceu porque o driver caiu. Paridade de produção: build standalone real com PostgreSQL próprio e `JHO_AUTH_MODE=secure`. |

## What Was Fixed

Nada ainda.

## Paper Cuts

| Persona | Where (journey/step) | Felt | Sharpness | Outcome |
|---|---|---|---|---|
| Andreus em triagem | J-trust-the-filtered-board passo 1 | "abri o sistema e ele estava em inglês; o seletor está no topo e resolve, mas a primeira tela não me reconhece" | dull | watching — é o primeiro contato de um navegador sem o cookie, e o seletor funciona |

## Runtime Errors Observed

Nada registrado ainda.

## Human Verifications Needed

- [ ] **Campo de filtro depois de navegação suave** (linhas 6 e 7). Com o
  ambiente manual de pé (`node tests/e2e/run-isolated.mjs --manual`), logando
  como `alex@local.test`: (1) abrir `/jobs?fit=45&pay=6000&payMax=12000&cur=USD&per=month`;
  (2) clicar em **LIMPAR** na faixa salarial — **sem dar refresh**; (3) conferir
  que os dois campos ficam vazios, mostrando "sem mínimo" e "sem teto"; (4) apertar
  APLICAR e conferir que a faixa **não volta**. Depois: (5) clicar num atalho de
  corte ("Aplicáveis hoje") e conferir que o campo de Score passa a mostrar o corte
  do atalho; (6) marcar duas fontes, aplicar, clicar em limpar fontes, e conferir
  que as marcas somem. O que já está provado: aterrissar numa faixa invertida já
  mostra os campos na ordem certa.
- [ ] **As quatro linhas de agrupamento e a de concorrência** (linhas 8 a 12)
  ficaram `Skipped` por corte de janela, não por estarem sem valor — os charters
  `CH-grouped-job-reaches-the-right-country` e `CH-heavy-screen-asked-twice`
  estão escritos e prontos para serem reexecutados.

## Decisions for a Human

Nada registrado ainda.

## Learnings

- **Confira a saúde do driver antes de abrir a caixa.** Metade da sessão 2 foi
  gasta separando "o produto não reage" de "o instrumento não age". O sintoma é
  traiçoeiro: `agent-browser click` responde `✓ Done` mesmo quando nada acontece.
  Um passo de sanidade no começo — clicar algo cujo efeito é inequívoco e conferir
  — custa um minuto e vale a caixa inteira.
- **Leia a URL só depois de `wait --load networkidle`.** Navegação suave não
  atualiza a URL de imediato, e ler antes devolve a anterior. Foi o que quase me
  fez reportar um defeito que não existe.
- **Controle antes de acusar.** "APLICAR não faz nada" virou observação inofensiva
  quando o mesmo gesto numa URL já ordenada mostrou o mesmo comportamento, onde
  ele é correto. Sem o controle, era um bug filado errado.
- **Candidato a tour:** um "Same-URL Tour" — repetir a ação que produz o estado
  atual e conferir que a tela não regride. Foi o que expôs a diferença entre
  "sem mudança" e "sem submissão".

## Final Status

- **Exit gate (suíte automatizada completa):** `rtk proxy pnpm check` → exit 0.
  `Test Files 211 passed (211)`, `Tests 2761 passed | 7 skipped (2768)`,
  `Statements 96.43%`, `Branches 92.85%`, `test:qa-skills OK`.
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 0 · Trust-Damage 0 ·
  Friction 0 · Cosmetic 0. Nenhum defeito encontrado, e nenhum inventado: das
  doze linhas, cinco foram andadas até o fim verdadeiro, duas ficaram bloqueadas
  pelo instrumento e cinco foram cortadas por janela.
- **Coverage:** 1 de 2 jornadas em escopo andada por persona.
  `J-trust-the-filtered-board` foi andada em duas sessões (uma completa, uma
  parcial); `J-switch-workspace-screen`, a canária, **não foi andada** — a linha
  de concorrência ficou cortada. Isso está declarado, não escondido.
- **Parity disclosed:** build standalone real, PostgreSQL temporário próprio,
  `JHO_AUTH_MODE=secure`, autenticação por senha pelo formulário real. Duas
  personas com contas reais e papéis distintos. Sem mock em nenhum ponto. O
  acervo é fixture (uma vaga pontuada), então os números observados são pequenos —
  o que as asserções mediram foi a CONCORDÂNCIA entre eles, não a magnitude.
- **Fidelity:** nenhuma verificação feita por devtools, banco ou leitura de
  código; toda confirmação veio da interface que a persona usa. O único uso de
  ferramenta fora dela foi diagnosticar o próprio driver.
- **Verdict:** **ready with blocked items** — o que a revisão profunda consertou e
  esta rodada conseguiu andar está provado pela interface, inclusive os dois
  achados que motivaram a leva (o número que contava outro quadro e o chip de
  funil aparecendo sem escopo de candidato); sete cenários seguem sem veredito e
  as instruções exatas para fechá-los estão em Human Verifications Needed.
