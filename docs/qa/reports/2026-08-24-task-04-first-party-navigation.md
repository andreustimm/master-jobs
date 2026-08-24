# QA report: 2026-08-24 — task-04-first-party-navigation

## Scope and Preconditions

- Tier: targeted — `J-switch-workspace-screen` plus adjacent direct-load canary `J-open-dashboard-direct`.
- Browser driver: Playwright Chromium and WebKit in the isolated production-equivalent Next 16.3.2 harness, using public URLs, rendered controls and an isolated SQLite database.
- Viewports: 1280×900 and 375×812, with an additional viewport equivalent to 200% zoom.
- Automated preconditions: targeted transition/navigation/mobile suite passed 110/110 tests; the isolated browser gate passed 174/174 checks on Node 24.19.0.
- Taxonomy: global and contextual navigation, URL-backed GET changes, one-shot redirecting mutations, auth/role boundaries, history, missing/revoked entities, responsiveness, focus, locale and cache isolation.

## Session Matrix

| Charter | Persona | Journey | Tour | Time-box | Verdict |
| --- | --- | --- | --- | ---: | --- |
| CH-first-party-navigation-inventory | Andreus em triagem | J-switch-workspace-screen | Feature Tour | 60 min | Pass |
| CH-keyboard-screen-transition | Candidato por teclado | J-switch-workspace-screen | Accessibility Tour | 30 min | Pass |
| CH-direct-startup-canary | Candidato em trânsito | J-open-dashboard-direct | Feature Tour | 20 min | Pass |

## Session Debriefs

### CH-first-party-navigation-inventory

- Entrada real: login por senha no build isolado, seguido de navegação pelos menus desktop e móvel e por superfícies contextuais.
- Caminho: cockpit, vagas, comparação, funil, referrals, candidato e administração; depois card de vaga, densidade, paginação, filtro GET, login, recovery, comparação, cadastro de vaga e impersonação.
- True end state: cada destino canônico ficou visível com uma única camada, todas as cinco mutações emitiram um POST e o histórico multi-entry terminou no dono final sem foco residual.
- Edge probes: modificadores/target/download, links externos, URL de 16 KiB, URL malformada, vaga ausente, perfil revogado, token inválido/repetido, sessão expirada e papel ausente.
- Resultado: os cenários de inventário e fronteiras canônicas passaram; nenhum finding novo.
- Evidência durável: checks `task-04 E2E-001` a `E2E-005`, `E2E-013` e `E2E-018` a `E2E-020` em `tests/e2e/ui.mjs`.

### CH-keyboard-screen-transition

- Entrada real: menu responsivo, histórico do navegador e transições renderizadas no build de produção.
- Caminho: toque no menu de 375×812, retorno/avanço multi-entry, live region, shell inerte, temas, reduced motion, safe areas e zoom equivalente a 200%.
- True end state: nenhum overflow horizontal, foco preso ou camada órfã; o destino permaneceu utilizável após remoção do status.
- Resultado: acessibilidade automatizada e responsividade passaram. Leitor de tela e aparelho físico permanecem lacunas qualificadas.

### CH-direct-startup-canary

- Entrada real: carga direta sem sessão em `/login`, seguida de navegação suave por recovery e perfil público.
- Caminho: splash inline de startup, hidratação, link de recovery, retorno ao login e perfil público revogável.
- True end state: carga direta exibiu só o splash de startup; cada troca interna exibiu só a camada de transição e nunca incorporou texto do perfil.
- Resultado: canário passou sem regressão de hidratação, privacidade ou singleton.

## Experiential Lens Pass

- Usabilidade: pass; menus e controles contextuais chegam ao destino esperado e preservam semântica nativa fora do lifecycle.
- Acessibilidade: pass automatizado para live region, inércia, foco, teclado, contraste e movimento reduzido; sem leitor de tela físico.
- Performance percebida: pass; a fase curta respeita o mínimo temporal e a prolongada permanece honesta e indeterminada.
- Compatibilidade: pass em Chromium e no canário móvel WebKit; Firefox, Safari real e PWA instalada em aparelho físico não foram executados.
- Recuperação: pass para falha, retry, sessão expirada, token consumido, entidade ausente e revogação.
- Paridade: qualificada por servidor Next de produção e banco local isolado; provedores externos e extensões reais ficaram fora do escopo.

## Findings and Decisions for a Human

- Nenhum finding novo por impacto.
- O bug preexistente `BUG-20260823-pipeline-empty-state-mixed-locale` permanece ligado ao cenário, mas não afeta o lifecycle e não foi reaberto nesta rodada.
- Não foram geradas screenshots duráveis porque o splash é efêmero; as asserções persistentes registram cardinalidade, fase, geometria, foco, URL, número de POSTs, conteúdo e resultado canônico.

## Automated Exit Gate

- `rtk pnpm test:e2e` no Node 24.19.0: exit 0; build otimizado Next 16.3.2 e 174/174 verificações de browser, incluindo zero job-fixture remanescente após o cleanup.
- Suite direcionada: 6/6 arquivos e 110/110 testes de transição, navegação, arquitetura e mobile.
- `rtk pnpm check` no Node 24.19.0: exit 0; typecheck, 148/148 arquivos, 2.081 testes aprovados, 2 pulados e 97,45% de cobertura de linhas.
- Auditoria independente: PASS após fechar AF-001 a AF-004 com evidência pública e determinística.
- Deep-review local: registrado no handoff de conclusão da tarefa.

## Final Status

QA da Task 04 concluído: 3/3 sessões e 5/5 cenários em escopo aprovados, zero finding novo, evidência de browser verde e auditoria independente aprovada.
