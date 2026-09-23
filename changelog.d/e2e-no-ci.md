## Técnico

### Alterado

- CI: o job `e2e-navegador` roda `pnpm test:e2e` inteiro (UI, papéis, 320–1024 px, inglês, temas, WebKit e axe) em todo PR e push, com PostgreSQL descartável do próprio harness, navegadores em cache pela versão do Playwright (restauração e gravação separadas, para gravar também com a suíte vermelha) e nenhum segredo. Ainda fora do agregador `qualidade` (exceção registrada em `NON_BLOCKING_JOBS`, `tests/support/ci-workflow.ts`) e da promoção até a instabilidade estar medida (#202).
- E2E: as listas das varreduras transversais saíram de `ui.mjs`/`a11y.mjs` para `tests/e2e/routes.mjs`; `tests/e2e-route-coverage.test.ts` cruza-as com o inventário de páginas, exige que as varreduras as consumam, e página sem varredura nem exceção em `UNMEASURED_PAGES` reprova. `/jobs/new`, `/admin/operacoes` e as telas sem sessão (`/login`, `/login/forgot`, `/login/reset`) entraram nas varreduras. `gotoMeasured` reprova quando a varredura cai em outra tela (por exemplo, `/login`) em vez de medi-la.
- E2E: o build descartável não recebe mais nenhum `.env*` além de `.env.example` (`copiedToHarness`); um checkout com `.env.production` levava a configuração de produção ao servidor do E2E.

### Corrigido

- E2E: o cenário de termos em Buscas espera o formulário assentar (`aria-busy`) antes de digitar o termo seguinte; o reset do formulário não controlado apagava o campo sob carga e o termo nunca era salvo.
- E2E: duas corridas do teste achadas nas primeiras execuções no CI. E2E-016 aceita que o aviso de demora (`prolonged`, aos 3 s) apareça durante as doze amostras de tema — a prova de "não reiniciou" é a geração. O callback vencido volta à mesma tela (`/login?error=invalid`) e pode não abrir overlay; a observação espera o alerta, não `route-login`, que já estava visível antes do push, e exige no máximo uma camada.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
