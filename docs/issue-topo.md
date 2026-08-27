# Issue resolvida: cabeçalho quebrado no mobile/PWA e CSS antigo em produção

**Encontrada:** 2026-08-26 · **Implementada:** 2026-08-27  
**Status:** corrigida no build; confirmação física final depende do deploy  
**Relatório:** `docs/qa/reports/2026-08-27T162317105000Z-76fc8fc9-pwa-cache-refresh.md`

Este documento preserva a investigação que levou à correção. Ele não é mais
um plano de execução; o contrato vigente está nos testes, cenários de QA e no
runbook de deploy citados abaixo.

## Sintomas observados

- Na PWA instalada no iPhone, relógio e indicadores do sistema cobriam a marca
  e os controles do cabeçalho.
- Em janelas estreitas, o topo perdia altura e margens.
- Em desktop largo, o hambúrguer aparecia apesar de haver espaço para o menu.
- Depois de novos deploys, uma PWA já aberta podia continuar exibindo o CSS da
  geração anterior.

## Causa raiz confirmada

Produção servia HTML novo junto de uma folha CSS antiga. O CSS ainda continha
`html.pwa-standalone body>div` e uma regra de safe-area para `body > header`,
estrutura que já não existia depois que o cabeçalho entrou em
`#application-shell`. O build local permanecia coerente, por isso as suítes
locais não reproduziam a divergência de artefatos do deploy.

Havia ainda uma lacuna no cliente instalado: `skipWaiting()` e
`clients.claim()` atualizavam o worker, mas o documento que já estava aberto
não observava a troca do controlador. Assim, o CSS antigo podia continuar na
tela até uma navegação ou reinício manual.

## Correção implementada

- `src/core/pwa/service-worker-update.ts` verifica atualizações ao retornar ao
  foreground e recarrega exatamente uma vez em `controllerchange`; a primeira
  instalação não recarrega.
- `scripts/check-deployed-css.mjs` valida o CSS realmente servido, exige os
  marcadores da geração atual e rejeita seletores obsoletos.
- O workflow pós-main espera a publicação e falha se produção continuar
  servindo uma geração incompatível.
- A superfície do cabeçalho é full-bleed em todas as larguras.
- No celular, somente o conteúdo útil usa 95% da viewport, com 2,5% por lado.
- Tablet e desktop usam as calhas de 24px e 32px do `DESIGN.md`.
- A navegação completa aparece sempre que a medição real indicar espaço; o
  hambúrguer é apenas o fallback compacto.
- A fileira do cabeçalho mantém `min-h-16 py-3` e respeita a safe area da PWA.
- A modal Novidades não é renderizada nem carrega releases sem sessão válida.

## Provas automatizadas

- `tests/service-worker-update.test.ts`: foreground, recarga única, limpeza de
  listeners e primeira instalação.
- `tests/pwa-chrome.test.ts`: troca real da revisão A para B, gate de CSS e
  contrato da PWA.
- `tests/mobile.test.ts`: superfície full-bleed e largura útil móvel.
- `tests/nav-mobile.test.ts`: menu por espaço medido.
- `tests/changelog.test.ts`: o carregador de releases não é chamado anonimamente.
- `tests/e2e/ui.mjs`: 375×812, 812×375, 768×1024, 1280×900 e 1920×1080,
  incluindo geometria computada, navegação e ausência do changelog no login.

## Contrato visual vigente

| Superfície | Celular | Tablet | Desktop |
|---|---:|---:|---:|
| Fundo do cabeçalho | 100% da viewport | 100% | 100% |
| Conteúdo útil | 95% (2,5% por lado) | calha 24px | calha 32px |
| Navegação | completa se couber; senão compacta | idem | idem |

Não se limpa cache nem se reinstala a PWA para considerar a atualização bem
sucedida. A recuperação automática é parte do comportamento testado. A prova
física final deve partir de uma PWA já aberta na versão antiga, colocá-la em
segundo plano e retomá-la após o deploy, em retrato e paisagem.

## Critérios de fechamento em produção

1. O deploy conclui e `rtk pnpm check:deployed-css` passa contra produção.
2. Uma PWA já instalada adota a geração nova com no máximo uma recarga, sem
   limpeza de cache nem reinstalação.
3. Cabeçalho e controles ficam abaixo da barra do sistema em retrato e
   paisagem.
4. O topo ocupa 100% da largura e o conteúdo móvel preserva 2,5% por lado.
5. Desktop e widescreen exibem o menu completo quando ele cabe.

Os passos operacionais estão em `docs/engineering/deploy.md`; o estado vivo de
QA está em `docs/qa/scenarios/PWA-installed-header-safe-area.md` e
`docs/qa/scenarios/NAV-full-width-shell.md`.
