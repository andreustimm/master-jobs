# TechSpec: Menu mobile fecha ao navegar

## Executive Summary

O menu mobile é um popover nativo (`popover="auto"`) cujos itens são `Link` do
Next.js. A navegação SPA não dispara o light dismiss do popover — o clique
acontece dentro dele — então o menu fica aberto sobre a tela nova.

A solução: separar o `MobileNav` em um client component dedicado
(`app/mobile-nav.tsx`) e fechar o popover com `hidePopover()` num único `onClick`
no `<nav>` que embrulha os links (event delegation). `NavLinks` permanece server
e continua a fonte única dos links para os dois menus; a fileira desktop não
muda de bundle. O idioma `hidePopover()` já é usado em `theme-switch` e
`locale-switch` — não há padrão novo a inventar.

Trade-off principal: a árvore `app/` ganha mais um client component, com o
mesmo limite de exceção documentado no ADR-001 (popover com fechamento
programático). O custo é um `onClick`; o ganho é o comportamento universal de
menu mobile coberto por teste e2e em browser real.

## System Architecture

### Component Overview

- **`NavLinks`** (`app/nav-links.tsx`, server) — fonte única dos links de
  navegação, usada pela fileira desktop e pelo menu mobile. Não muda. Sem
  `"use client"`.
- **`MobileNav`** (`app/mobile-nav.tsx`, **client**) — botão hambúrguer + popover
  nativo + `<nav>` com event delegation que fecha o popover no clique. Renderiza
  `NavLinks` por dentro. Escopado a `< sm` (classes `sm:hidden`).
- **`layout.tsx`** (server) — importa e posiciona `MobileNav` no header, no mesmo
  lugar de hoje. Só muda o caminho do import.

Fluxo de dados: clique num item → evento sobe até o `<nav>` → handler chama
`hidePopover()` → popover fecha; o `Link` do Next.js executa a navegação SPA em
paralelo (o handler não chama `preventDefault`).

## Implementation Design

### Core Interfaces

`app/mobile-nav.tsx` — o client component. Interface pública (props) idêntica à
do `MobileNav` atual, para o layout não mudar:

```tsx
"use client";

import Link from "next/link"; // via NavLinks, não direto
import { NavLinks } from "./nav-links";

const id = "menu-mobile";

export function MobileNav({ hasCandidateScope, isAdmin, rotulo, t }: {
  hasCandidateScope: boolean;
  isAdmin: boolean;
  rotulo: string;
  t: Translator["t"];
}) {
  function fechar() {
    document.getElementById(id)?.hidePopover?.();
  }
  // botão (popoverTarget={id}, popoverTargetAction="show") ...
  // <div id={id} popover="auto" ...>
  //   <nav onClick={fechar} className="grid px-4 py-2">
  //     <NavLinks ... />
  //   </nav>
  // </div>
}
```

O handler `fechar` usa o encadeamento opcional `?.hidePopover?.()` — o mesmo
idioma de `theme-switch.tsx` — para degradar sem erro onde a API não existe.

### Data Models

Nenhum dado novo. Não há estado persistido, tabela, rota de API ou mensagem. O
componente é puramente de apresentação; o único "estado" é o próprio popover
nativo, controlado pelo navegador.

### API Endpoints

Nenhum. Não há backend, rota HTTP, Server Action nem alteração de dados. A
navegação usa as rotas já existentes (`/jobs`, `/compare`, `/pipeline`,
`/referrals`, `/candidate`, `/admin/users`) sem mudança.

## Integration Points

- **Popover API nativa** — o navegador é o integrador: `popover="auto"` mantém
  light dismiss (Escape, clique fora); `hidePopover()` é o caminho adicional de
  fechamento programático. Sem autenticação, sem rede, sem retry.
- **Next.js `Link`** — a navegação SPA continua intacta; o handler não a
  intercepta (`preventDefault` não é chamado). `typedRoutes` continua validando
  as rotas em tempo de compilação.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|-----------|-------------|---------------------|-----------------|
| `app/nav-links.tsx` | modified | `MobileNav` sai do arquivo; `NavLinks` permanece. Risco baixo. | Remover `MobileNav`; manter `NavLinks` e seus imports de `Link` |
| `app/mobile-nav.tsx` | new | Client component com o popover e o `onClick` de fechamento. Risco médio (primeira vez que o menu vira client). | Criar; importar `NavLinks` |
| `app/layout.tsx` | modified | Import de `MobileNav` muda de `./nav-links` para `./mobile-nav`. Risco baixo. | Atualizar import |
| `tests/nav-mobile.test.ts` | modified | Casos que afirmam `"use client"` ausente e `MobileNav` em `nav-links.tsx` quebram. Risco baixo. | Apontar para `mobile-nav.tsx`; ajustar a asserção de zero-JS para a fileira |
| `tests/e2e/ui.mjs` | modified | Novo caso: abrir menu, clicar item, verificar fechamento. Risco baixo. | Adicionar bloco em 375px |

## Testing Approach

- **Unit**: `tests/nav-mobile.test.ts` (nó) — fonte única dos links, endereço do
  client component, presença do `onClick`/`hidePopover`, ausência de
  `"use client"` na fileira. Os casos de popover nativo e alvo de toque são
  preservados e re-direcionados.
- **E2E**: `tests/e2e/ui.mjs` (Playwright, browser real) — o único nível que
  prova o comportamento observável (popover some após clique em item). Roda via
  `pnpm test:e2e` (build isolado, SQLite e porta temporários).
- **Fakes**: nenhum necessário — não há I/O além do DOM do navegador no e2e.

## Development Sequencing

### Build Order

1. `app/mobile-nav.tsx` — client component com o popover e o `onClick` (sem
   dependências além de `NavLinks`).
2. `app/nav-links.tsx` — remover `MobileNav`, manter `NavLinks`.
3. `app/layout.tsx` — atualizar import de `MobileNav`.
4. `tests/nav-mobile.test.ts` — re-direcionar os casos de nó.
5. `tests/e2e/ui.mjs` — caso novo de fechamento ao navegar.

### Technical Dependencies

Nenhuma externa. Depende apenas de `NavLinks` (já existente) e da Popover API
nativa (já em uso no projeto).

## Monitoring and Observability

Não aplicável — componente de apresentação, sem rede, sem estado persistido,
sem eventos de negócio. Não há métrica nem log novo.

## Technical Considerations

### Key Decisions

- **Decisão**: client component dedicado (`app/mobile-nav.tsx`) com fechamento
  por event delegation no `<nav>`.
- **Racional**: isola o bundle de cliente no menu; `NavLinks` e a fileira
  desktop permanecem server; um handler cobre todos os itens.
- **Trade-offs**: mais um arquivo; os testes de nó mudam de alvo.
- **Alternativas rejeitadas**: `"use client"` no arquivo inteiro (empurra a
  fileira desktop pro bundle), prop de fechamento em `NavLinks` (toca o
  componente compartilhado, reintroduz defeito silencioso), efeito pós-navegação
  (fecha depois da troca de tela).

### Known Risks

- **Clique em área morta do menu fecha sem navegar**: o menu é composto só de
  links; a área morta é mínima, e fechar nela é inofensivo.
- **`hidePopover` ausente em navegador antigo**: encadeamento opcional
  `?.hidePopover?.()` — sem fechamento, sem erro; degradação aceitável.
- **Teste de nó quebrando por ler prosa**: `nav-mobile.test.ts` remove comentários
  antes de afirmar; manter essa técnica ao re-direcionar as asserções.

## Architecture Decision Records

- [ADR-001: Fechar o menu mobile ao navegar, com o mínimo de JavaScript de cliente](adrs/adr-001.md) — Fechar sempre, exceção documentada à invariante "zero JavaScript".
- [ADR-002: Client component dedicado ao menu mobile, fechamento por event delegation](adrs/adr-002.md) — Componente em arquivo próprio, `onClick` no `<nav>`, `hidePopover()`.
