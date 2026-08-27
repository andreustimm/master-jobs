# Issue: cabeçalho quebrado no mobile/PWA e sem margens na web — análise e plano de correção

**Data:** 2026-08-26 · **Autor da análise:** sessão OpenCode (GLM) · **Executor previsto:** outro agente
**Branch de trabalho:** partir de `dev` (regra 18). **Nenhuma alteração de runtime comprovada como necessária no CSS do repositório — a causa raiz principal está no deploy, não no código.**

---

## 1. Sintomas (evidência visual fornecida pelo usuário)

| Imagem | Contexto | O que se vê |
|---|---|---|
| 1 | iPhone, PWA instalada | Relógio (21:16) e indicadores (sinal, wi-fi, bateria) **por cima** da marca "Master Jobs" e do controle "SAIR". Conteúdo do cabeçalho nasce colado no topo físico da tela. |
| 2 | Web desktop, tema escuro | **Estado correto** — como era e como deve ficar: marca à esquerda, fileira completa de links, container com margens, respiro vertical. |
| 3 | Web, janela estreita | "Master Jobs" **cortado no topo**, sem margem lateral, conteúdo encostado na borda esquerda, sem respiro vertical. |

## 2. Causa raiz — o CSS de produção está velho, o código não está

### 2.1 A prova

O site de produção serve **HTML novo** com **CSS velho** — duas gerações de build diferentes no mesmo deploy.

**HTML servido hoje** (`https://jobs.mastertimm.com.br/login`) contém a marcação da v1.3.7:

- `data-responsive-nav`, `mobile-content-shell`, `#application-shell` — markup dos PRs #50/#58/#61.

**CSS servido hoje** (`/_next/static/css/8a82529f236a8929.css`, 75 KB, `last-modified: 2026-08-26 20:20:56 UTC`, `x-vercel-cache: HIT`) contém:

```css
/* ÚNICA regra de safe-area no CSS de produção: */
html.pwa-standalone body { padding-bottom: env(safe-area-inset-bottom); }
html.pwa-standalone body > header { padding-top: env(safe-area-inset-top); }
html.pwa-standalone body > div, html.pwa-standalone body > header > div { ... }
```

Esse seletor (`body > header`) **só fazia sentido quando o `<header>` era filho direto do `<body>`** — estrutura de ~v1.0.0 (commit `0edb4bc`, 21/08). Desde `c0a5d85` (24/08) o header vive dentro de `<div id="application-shell">`, e o seletor de produção **nunca mais casou com nada**.

Ausências confirmadas no CSS de produção (grep, 0 ocorrências cada):

- `.mobile-content-shell` (regra do media query mobile)
- `--safe-area-top-floor` (piso de 48px)
- `#application-shell > header` (nenhuma regra)
- `data-responsive-nav` / `data-nav-mode` (toda a navegação responsiva)
- `min-h-14`, `max-w-[min(95vw,1760px)]` (utilitários da marcação nova)
- O arquivo tem **1 única ocorrência de `mx-auto`** — o Tailwind compilou utilitários para o markup antigo.

### 2.2 Por que isso explica as três imagens

1. **Imagem 1 (PWA iPhone):** a única regra de safe-area do CSS de produção mira `body > header`, que não existe mais. `padding-top` do cabeçalho = 0. Com `viewport-fit=cover` + `apple-mobile-web-app-status-bar-style: black-translucent` (ambos presentes no HTML de produção), o conteúdo vai **atrás** da barra de status e nada o empurra para baixo. O relógio pinta por cima da marca. Exatamente a imagem 1.
2. **Imagem 3 (web estreita):** a regra `@media (max-width: 639px) { .mobile-content-shell { ... } }` não existe no CSS de produção, e os utilitários da marcação nova (`max-w-[min(95vw,1760px)]`, `min-h-14`, `px-4` etc.) também não foram compilados. O cabeçalho fica sem altura mínima, sem padding lateral e sem container centralizado. Exatamente a imagem 3.
3. **Imagem 2 (correta):** estado de um build em que HTML e CSS eram da mesma geração.

### 2.3 Por que o deploy de hoje (v1.3.7) produziu CSS velho

- O deploy de `a5d0489` (v1.3.7, 20:18 UTC) **completou com sucesso** (verificado via API de deployments do GitHub) e é ele que está no ar.
- O repositório em `origin/main` **contém todas as correções** — `app/globals.css` em `main` tem as regras novas (`mobile-content-shell`, piso 48px, `#application-shell > header`), e `main == dev` para esses arquivos.
- Logo: **o build compilou CSS de uma geração antiga**. Isso é o padrão clássico de **cache de build (`.next/cache` no Vercel) não invalidando a saída do PostCSS/Tailwind** quando a folha de estilo global e o markup mudam juntos. O nome do arquivo é estável entre builds e a saída velha foi reaproveitada.

### 2.4 Por que o Codex "não conseguia consertar"

O código vinha sendo corrigido corretamente (PRs #50, #54, #58, #61 — todos com QA automatizado verde e relatórios em `docs/qa/`). Os testes rodam contra o **build local**, onde HTML e CSS estão sincronizados — então passam. O aparelho fala com a **produção**, que nunca chegou a servir essas correções. Faltou o elo de verificação: **conferir o CSS efetivamente servido em produção depois de cada deploy**. A verificação física no aparelho (cenário `PWA-installed-header-safe-area`) ficou 3 vezes como `Blocked (needs human verify)` — e o bug `BUG-20260825-pwa-header-status-bar-overlap` foi "re-encontrado" duas vezes pelo mesmo motivo.

---

## 3. Plano de execução (para o agente responsável)

### Fase 0 — Remediação do deploy (FAZER PRIMEIRO, sem isso nada mais aparece)

1. **Redeploy de produção com cache de build limpo.** Vercel → Deployments → último deploy de `main` → "Redeploy" com **"Use existing build cache" DESMARCADO**. (Se a infra permitir, invalidar o cache do projeto inteiro.)
2. **Gate de verificação pós-deploy** (novo, permanente). Script (ex.: `scripts/check-deployed-css.mjs`, chamado pelo CI após promoção ou manualmente no runbook de release):
   - `fetch` do HTML de `/login` → extrair a URL do CSS;
   - `fetch` do CSS → **asser que o conteúdo contém os marcadores**: `--safe-area-top-floor`, `.mobile-content-shell`, `#application-shell>header` (ou a forma minificada equivalente), `[data-responsive-nav]`;
   - falhar o job se qualquer marcador faltar. Isso torna impossível um deploy "verde" com CSS velho passar batido de novo.
3. **Descarte de cache no aparelho** (checklist humano, uma vez): fechar e remover a PWA instalada, limpar dados do Safari para o domínio, reinstalar por "Adicionar à Tela de Início". O service worker atual não guarda páginas (`shell-` só tem `/offline.html`), mas um aparelho que passou por 4 versões em 2 dias é o ambiente mais sujo possível — isole a variável antes de re-testar.

**Critério de sucesso da Fase 0:** no iPhone físico, PWA reinstalada, a marca e os controles nascem abaixo da barra de status em retrato e paisagem; em janela estreita de desktop a página tem margens laterais e o cabeçalho tem altura.

### Fase 1 — Ajustes de código pedidos pelo usuário

> Regras do repo que limitam o desenho: nada de `#hex` ou token bruto em componente (regra 10); nada de `max-w-xs/sm/md/lg/xl` (o Tailwind v4 resolve esses nomes pela escala `--spacing-*`; usar valor explícito); derivar espaçamento dos tokens (`--spacing-*` / escala utilitária existente). Toda mudança percebida por usuário dispara `qa-report`/`qa-execution` (regra 20).

#### 1.1 Topo no mobile (PWA) — o código já está certo; endurecer as bordas que restam

O mecanismo correto já existe e não deve ser reescrito:

- `viewportFit: "cover"` + `appleWebApp.statusBarStyle: "black-translucent"` em `app/layout.tsx`;
- classe `pwa-standalone` posta antes da primeira pintura por `src/core/pwa/standalone.ts`;
- em `app/globals.css`: `html.pwa-standalone #application-shell > header { padding-top: var(--safe-area-top) }`, a ponte incondicional (WebView que expõe inset sem `display-mode`), e o piso `max(var(--safe-area-top), var(--safe-area-top-floor))` sob `pointer: coarse`.

Endurecimentos a fazer:

- **[a] Piso também fora da classe, para contexto de toque.** Hoje o piso de 48px exige `html.pwa-standalone` **e** `pointer: coarse`. Um WebView que esconde a barra mas não dispara `standalone` fica só com a ponte incondicional (inset, sem piso). Avaliar (com teste) estender o piso para `@media (pointer: coarse)` incondicional **apenas se** `env(safe-area-inset-top) > 0` não for observable — alternativa segura: manter como está e registrar a decisão. **Não** aplicar piso incondicional em ponteiro fino (criaria faixa vazia no desktop).
- **[b] iPad PWA:** `--safe-area-top-floor: 48px` sob `pointer: coarse` também vale para iPad, cuja barra em PWA é mais baixa. Medir em aparelho; se houver faixa vazia perceptível, introduzir piso por faixa de largura (`@media (pointer: coarse) and (max-width: 1023px)`) ou aceitar e registrar.
- **[c] Teste de contrato novo:** `tests/pwa-chrome.test.ts` já trava os tokens; acrescentar asser de que **nenhuma** regra de safe-area mira `body > header` (o seletor que apodreceu em produção), para o verso dessa regressão nunca voltar.

#### 1.2 Largura 100% em todas as versões

Estado atual: a **faixa** do cabeçalho já é 100% (`<header>` sem `max-width`); o que varia é o **container interno** (`max-w-[min(95vw,1760px)]` no mobile, `min(90vw,1760px)` acima de `sm`, com `mobile-content-shell` zerando o padding no celular para as margens de 2,5% dominarem). Esse tripé (%, breakpoint, classe que anula padding) é o que produziu confusão e é sensível a CSS faltante — como a imagem 3 demonstrou.

Especificação (substitui o tripé por algo determinístico):

- **Faixa do cabeçalho:** continua borda a borda (100%) em web, tablet e mobile. Nada a mudar — só garantir com teste e2e que o `boundingClientRect` do `<header>` ocupa `document.documentElement.clientWidth` nos três viewports.
- **Container interno** (cabeçalho, banner de impersonação, conteúdo, rodapé — os 4 lugares que repetem a classe):
  - substituir `max-w-[min(95vw,1760px)] sm:max-w-[min(90vw,1760px)]` por `max-w-[1760px]`;
  - padding lateral fixo e crescente: `px-4` (16px) no mobile, `sm:px-6` (24px) e `lg:px-8` (32px) nas versões maiores — mesma escala do DESIGN.md;
  - a classe `mobile-content-shell` deixa de precisar zerar padding: **remover o bloco `@media (max-width: 639px)...` em `app/globals.css:402-408`** e a classe da marcação, ou mantê-la apenas se algum outro estilo depender dela (verificar `tests/mobile.test.ts` e `tests/pwa-chrome.test.ts` — ambos leem essas regras e precisam ser atualizados juntos);
  - as regras PWA de inset lateral (`globals.css:745-760`) continuam: `max(var(--spacing-md), var(--safe-area-left/right))` preserva o recorte físico em paisagem; simplificar o segundo bloco (755-760) para não duplicar o que o padding fixo já dá.
- **Resultado observável:** conteúdo a 100% da largura útil em todas as versões, com margem lateral constante (não percentual), e fim da dependência de regras condicionais para existir respiro.

#### 1.3 Mais respiro vertical (topo e bottom "grudados")

Estado atual: a fileira do cabeçalho tem só `min-h-14` (56px) **sem padding vertical**; o conteúdo da página tem `pb-16` e o rodapé fecha a página.

Especificação:

- **Cabeçalho:** na `div` interna em `app/layout.tsx:233`, trocar `min-h-14` por **`min-h-16 py-3`** (64px + 12px de respiro interno em cada face). O alvo de toque dos links (`py-2.5`) e a medição do popover (`getBoundingClientRect().bottom` do header, em `app/mobile-nav.tsx:124`) continuam válidos porque medem o header real — **nenhum valor hardcoded de altura do header em JS**, confirmar.
- **Safe-area continua ganhando:** as regras de `globals.css` usam `padding-top` no `<header>` e somam ao `py-3` da fileira — conferir que o piso `max(var(--safe-area-top), 48px)` continua **acima** do respiro visual (o padding do header empurra a fileira inteira; o `py-3` é interno à fileira). Se o resultado visual ficar com respiro duplo no modo instalado, mover o `py-3` para `padding-block` condicional de `pointer: fine` — decidir por captura nos dois modos.
- **Base da página:** se "bottom" refere-se ao fim da página, subir `pb-16` → `pb-20` no container de conteúdo (`app/layout.tsx:332`) **ou** aumentar o `py-4` do rodapé — escolher **um**, por captura; não fazer os dois (o rodapé já é o respiro final da página, ver comentário em `layout.tsx:335`).
- **Espaço entre cabeçalho e conteúdo:** as páginas têm `header` próprio (`pb-6`, `pb-4`, `mt-4 mb-6`); não mexer nelas nesta issue — o respiro pedido é o do topo global.

### Fase 2 — Provas (ordem da regra 20)

1. `rtk pnpm check` verde (atualizar `tests/pwa-chrome.test.ts`, `tests/mobile.test.ts`, `tests/nav-mobile.test.ts` para o novo contrato de largura/padding).
2. `rtk pnpm test:e2e` — os cenários de safe-area e `scrollWidth` em 375px continuam passando; acrescentar asser de largura integral do `<header>` nos três viewports e do `min-height` do cabeçalho.
3. `qa-report` (tier targeted) → `qa-execution` no charter `CH-installed-header-safe-area` e no `CH-mobile-responsive-regression`.
4. **Verificação física no iPhone (a que sempre ficou pendente):** PWA reinstalada após redeploy limpo, retrato + paisagem, marca abaixo da barra de status, menu abre abaixo do cabeçalho, sem overflow horizontal. Só então mover `BUG-20260825-pwa-header-status-bar-overlap` para `verified`.
5. `deep-review` → PR para `dev`.

### Critérios de aceite finais

| # | Critério | Onde se verifica |
|---|---|---|
| A | PWA iPhone: nenhum controle sob a barra de status, retrato e paisagem | aparelho físico |
| B | `<header>` ocupa 100% da largura do viewport em 375px, 768px e 1280px | `tests/e2e/ui.mjs` |
| C | Container com padding lateral fixo (16/24/32px) e teto de 1760px nas 4 superfícies (header, banner, conteúdo, rodapé) | inspeção + teste de contrato |
| D | Fileira do cabeçalho com ≥64px de altura e respiro vertical visível nos 3 viewports e nos 2 modos (browser e PWA) | e2e + captura |
| E | CSS de produção contém os marcadores da Fase 0 após o deploy | gate de pós-deploy |
| F | Nenhuma regra de safe-area mira `body > header`; nenhuma altura de header hardcoded em JS | testes de contrato |

### Riscos e não-objectivos

- **Não reescrever o mecanismo de safe-area** — ele nunca chegou a rodar em produção; reescrever agora apaga a única variável que ainda não foi testada no aparelho real.
- **Não** criar porta/abstração nova para isso (regra 4): é CSS + script inline existentes.
- **Não** bumpar `SCORER_VERSION` (nada no scorer muda).
- Turbopack/Next 16: antes de fechar, checar `node_modules/next/dist/docs/` por mudanças em cache de build/CSS que expliquem a saída velha; se houver flag de cache controlável, documentar no runbook de deploy (`docs/engineering/deploy.md`).
