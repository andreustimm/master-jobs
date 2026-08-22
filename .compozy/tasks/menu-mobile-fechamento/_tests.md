# Test Specification: Menu mobile fecha ao navegar

Canonical test contract for the mobile navigation menu closing on navigation.
Companion to `_techspec.md`. Derived from `_user_stories.md` (behavior) and
`_techspec.md` (components).

## Strategy

- Frameworks and harnesses: Vitest (unit, node) para as asserções estruturais e
  de fonte única dos links; Playwright (`tests/e2e/ui.mjs`) para o comportamento
  observável em browser real. Sem fakes — não há I/O além do DOM do navegador.
- Execution: unit via `pnpm vitest run tests/nav-mobile.test.ts`; e2e via
  `pnpm test:e2e` (build isolado, SQLite e porta temporários).
- Conventions: testes de nó leem o arquivo sem comentários (a técnica existente
  de `semComentarios`) para afirmar sobre código, não sobre prosa; e2e usa o
  helper `check(...)` e `#menu-mobile` como seletor.

## Coverage Matrix

| Source       | Behavior                                    | Unit                    | Integration | E2E     |
|--------------|---------------------------------------------|-------------------------|-------------|---------|
| US-001       | fechar ao clicar em item                    | UT-001, UT-002, UT-003  | —           | E2E-001 |
| US-001.EC-1  | duplo toque no mesmo item                   | —                       | —           | E2E-001 |
| US-001.EC-2  | navegação SPA sem flash do menu             | —                       | —           | E2E-001 |
| US-001.EC-3  | toque fora fecha (nativo)                   | UT-004                  | —           | E2E-002 |
| US-001.EC-4  | Escape fecha (nativo)                       | UT-004                  | —           | E2E-002 |
| US-001.EC-5  | item sem href não navega                    | UT-005                  | —           | —       |
| US-001.EC-6  | navegação falha, menu já fechou             | —                       | —           | E2E-003 |
| US-002       | Escape e toque fora continuam funcionando   | UT-004                  | —           | E2E-002 |
| US-002.EC-1  | reabertura imediata após fechar             | —                       | —           | E2E-002 |
| US-002.EC-2  | ativação por teclado (Tab + Enter)          | UT-004                  | —           | E2E-002 |
| US-002.EC-3  | foco não fica preso no menu fechado         | —                       | —           | E2E-002 |
| NavLinks     | fonte única dos links                       | UT-006, UT-007          | —           | —       |
| MobileNav    | client component no endereço certo          | UT-008                  | —           | —       |
| MobileNav    | fechamento usa hidePopover                  | UT-009                  | —           | —       |

## Unit Tests

### NavLinks — fonte única (TechSpec: Component Overview)

- **UT-006** (happy): `app/nav-links.tsx` contém `href` para cada rota
  (`/jobs`, `/compare`, `/pipeline`, `/referrals`, `/candidate`, `/admin/users`).
- **UT-007** (error): `app/layout.tsx` **não** contém `href` para nenhuma dessas
  rotas — a garantia de que os dois menus não podem divergir.

### MobileNav — endereço do client component (TechSpec: Component Overview)

- **UT-008** (happy): `app/mobile-nav.tsx` contém `"use client"` e renderiza
  `<NavLinks`; `app/nav-links.tsx` (sem comentários) **não** contém
  `"use client"` — a fileira desktop permanece server.
- **UT-009** (happy): `app/mobile-nav.tsx` contém `popover="auto"`,
  `popoverTarget=`, e o idioma de fechamento `hidePopover` (ou
  `?.hidePopover?.()`), ligado a um `onClick` no `<nav>`.
- **UT-001** (happy): o `<nav>` do menu tem um `onClick` que fecha — presença do
  handler de event delegation no wrapper dos links (afirmar `onClick` e
  `hidePopover` no mesmo arquivo, sem comentários).
- **UT-002** (boundary): o `onClick` de fechamento **não** chama
  `preventDefault` — o `Link` do Next.js segue a navegação SPA.
- **UT-003** (happy): o botão hambúrguer continua com `popoverTargetAction="show"`
  e `sm:hidden`; o popover e o botão mantêm as classes de escopo a `< sm`.
- **UT-004** (happy): `popover="auto"` (não `manual`) — o light dismiss de
  Escape e clique-fora continua sendo responsabilidade do navegador.
- **UT-005** (error): todos os itens do menu são `Link` com rota literal
  (`typedRoutes`); não há item sem `href` — o fechamento por navegação se aplica
  a itens que navegam.

## Integration Tests

Nenhuma fronteira de I/O externa neste componente (sem banco, sem rede, sem
Server Action). O comportamento de integração entre o client component e o
popover nativo é exercitado no e2e, onde o navegador é o integrador real.

## End-to-End Tests

### Menu mobile fecha ao navegar (US-001)

- **E2E-001**: viewport 375px → login → abrir o menu (`#menu-mobile`) → clicar em
  um item (ex.: "Vagas", link para `/jobs`) → verificar que `#menu-mobile` não
  está mais visível e que a URL mudou para a rota do item. Cobre US-001, EC-1
  (segundo clique não reabre) e EC-2 (sem flash do menu sobre a tela nova).

### Popover nativo continua dono de Escape e clique-fora (US-002)

- **E2E-002**: viewport 375px → abrir o menu → pressionar Escape → verificar
  fechado → reabrir → tocar fora → verificar fechado → reabrir e fechar por
  navegação → reabrir pelo botão imediatamente → verificar que abre (sem estado
  residual). Cobre US-002, EC-1, EC-2 (teclado) e EC-3 (foco não preso).

### Navegação que falha não deixa menu aberto sobre o erro (US-001.EC-6)

- **E2E-003**: viewport 375px → abrir o menu → navegar para uma rota que produz
  erro/404 (forjada via link direto) → verificar que o menu não está visível
  sobre a tela de erro. (Se nenhuma rota pública do menu produz 404 no fluxo
  normal, marcar `(withdrawn)` e cobrir EC-6 pela asserção de fechamento do
  E2E-001.)
