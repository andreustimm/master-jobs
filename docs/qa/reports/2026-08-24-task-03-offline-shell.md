# QA report: 2026-08-24 — task-03-offline-shell

## Scope and Preconditions

- Tier: targeted — `J-recover-offline-access` plus adjacent canary `J-open-dashboard-direct`.
- Automated precondition: `rtk pnpm check` on Node 24.19.0 passed 147/147 files, 2,074 tests, 2 skipped and 97.39% line coverage.
- Browser driver: Playwright Chromium in the isolated production-equivalent harness through public URLs and controls.
- Taxonomy: the recovery journey covers end-to-end reconnection, honest failure, localization, repeat reload, unavailable storage, responsive standalone UI and privacy across sessions. The direct-load canary covers registration/startup regression. No mutation or external side effect exists in this slice.

## Session Matrix

| Charter | Persona | Journey | Tour | Time-box | Verdict |
| --- | --- | --- | --- | ---: | --- |
| CH-offline-installed-recovery | Candidato após falha | J-recover-offline-access | Interrupt Tour | 30 min | Pass |
| CH-direct-startup-canary | Andreus em triagem | J-open-dashboard-direct | Feature Tour | 30 min | Pass |

## Session Debriefs

### CH-offline-installed-recovery

- Entrada real: login por senha no build isolado, instalação/controle do service worker e navegação para `/jobs` em Chromium.
- Caminho: queda durante troca lenta → mensagem offline localizada → duas ativações rápidas de retry → uma navegação fresca; depois abertura e reload offline de `/jobs`, perfil revogado e Funil com query preservada.
- True end state: reconexão carregou o destino atual da rede; cache auditado por uma segunda leitura continha apenas `static-*`/`shell-*`, allowlist pública e nenhum marcador exclusivo das contas-fixture.
- Edge probes: queda e retorno mid-request, double retry, reload repetido, perfil revogado, URL com histórico/query, primeiro acesso sem worker, cota de um byte e retorno online.
- Resultado: os três cenários passaram; nenhum paper cut ou bug novo.
- Evidência durável: checks `offline E2E-010` a `offline E2E-012` em `tests/e2e/ui.mjs`, executados 163/163 no relatório desta rodada.

### CH-direct-startup-canary

- Entrada real: recursos públicos sem sessão, depois login e recarga sob controle do worker.
- Caminho: manifest, worker, ícones e documento standalone responderam; login permaneceu fora do cache; a aplicação online continuou operável depois de instalação, falha de storage e reconexão.
- True end state: startup normal e páginas autorizadas permaneceram utilizáveis sem overlay residual.
- Edge probes: sessão ausente, recarga, worker recém-instalado, armazenamento recusado e nova navegação online.
- Resultado: canário passou sem regressão.

## Experiential Lens Pass

- `J-recover-offline-access`: usabilidade pass com ação específica; acessibilidade pass no heading/status/retry sem auditoria física; performance percebida pass sem sucesso falso; compatibilidade pass em Chromium e layouts responsivos, com Safari/Firefox qualificados abaixo; recuperação pass por retry explícito e URL preservada; paridade pass no build Next de produção com backend local.
- `J-open-dashboard-direct`: usabilidade e startup pass; acessibilidade sem novo bloqueio; performance e compatibilidade cobertas pela suíte desktop/mobile; recuperação pass após storage recusado; paridade qualificada por banco e servidor locais.

## Findings and Decisions for a Human

- Nenhum finding novo. O bug preexistente `BUG-20260823-pipeline-empty-state-mixed-locale` não foi reencontrado porque o shell offline standalone não renderiza conteúdo do Funil.
- Lacunas de paridade: offline/service worker foi percorrido em Chromium, não em Safari/Firefox nem aparelho físico; não houve leitor de tela físico ou extensões reais. O documento standalone ainda foi verificado em 375 px, dark/light e reduced motion pelos gates automatizados.

## Automated Exit Gate

- `rtk pnpm test:e2e` under Node 24.19.0: exit 0; optimized Next 16.3.2 production build and 163/163 browser checks.
- Gate final `rtk pnpm check` under Node 24.19.0: exit 0; 147/147 files, 2,074 passed, 2 skipped, 97.39% line coverage.
- Gate browser direcionado: 4/4 files and 76/76 tests passed.

## Final Status

Ready para Task 03: 2/2 sessões e 4/4 cenários em escopo aprovados, zero finding por impacto e gates finais verdes.
