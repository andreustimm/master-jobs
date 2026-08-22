---
status: completed
title: "Menu mobile: client component com fechamento ao navegar"
type: bugfix
complexity: low
---

# Task 1: Menu mobile: client component com fechamento ao navegar

## Overview
O menu mobile abre um popover nativo, mas ao tocar num item a navegação SPA
troca a tela por trás e o popover fica aberto cobrindo o conteúdo. Esta tarefa
move o `MobileNav` para um client component dedicado e fecha o popover ao
navegar — a única exceção à invariante "zero JavaScript de cliente" da árvore
`app/`, já decidida no ADR-001.

<critical>
- ALWAYS READ the PRD, the TechSpec, and their catalogs (`_user_stories.md`, `_tests.md`) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
- O `MobileNav` DEVE mover-se para `app/mobile-nav.tsx` marcado com `"use client"`, importando `NavLinks` de `app/nav-links.tsx`.
- `app/nav-links.tsx` DEVE permanecer server (sem `"use client"`) e DEVE manter `NavLinks` como a fonte única dos links — a fileira desktop não pode entrar no bundle de cliente.
- O fechamento DEVE acontecer por event delegation: um único `onClick` no `<nav>` que embrulha os links, chamando `document.getElementById(id)?.hidePopover?.()` — o mesmo idioma de `app/theme-switch.tsx` e `app/locale-switch.tsx`.
- O handler NÃO DEVE chamar `preventDefault`: o `Link` do Next.js segue a navegação SPA normalmente.
- O popover DEVE continuar `popover="auto"` (light dismiss de Escape e clique-fora são do navegador, não do script).
- O botão hambúrguer e o popover DEVE manter as classes de escopo a `< sm` (`sm:hidden`) e o id `menu-mobile`.
- O id `menu-mobile` NÃO DEVE mudar — o e2e e o CSS dependem dele.
- `app/layout.tsx` DEVE importar `MobileNav` do novo caminho.

<requirements>

## Subtasks
- [x] 1.1 Criar `app/mobile-nav.tsx` como client component com o botão, o popover e o `onClick` de fechamento no `<nav>`
- [x] 1.2 Remover `MobileNav` de `app/nav-links.tsx`, mantendo `NavLinks` e seus imports de `Link`
- [x] 1.3 Atualizar o import de `MobileNav` em `app/layout.tsx`
- [x] 1.4 Re-apontar os casos de nó de `tests/nav-mobile.test.ts` para `mobile-nav.tsx` e ajustar a asserção de zero-JS para a fileira desktop
- [x] 1.5 Adicionar o caso e2e de fechamento ao navegar em `tests/e2e/ui.mjs`

## Follow-up (fora do escopo)

- O e2e "interface em inglês não vaza português" falha por causa do
  `USER_CHANGELOG.md` 1.1.0 escrito em português com acentos, renderizado no
  rodapé sem `data-user-content`. Pré-existente (HEAD limpo também falha), não
  introduzido por esta task. Resolver exige decidir como o changelog bilingue é
  marcado/servido — tarefa própria.
- Decisão de conflito resolvida: `t` (função) não serializa na fronteira
  server→client; o `MobileNav` passou a receber `locale` (string) e construir o
  tradutor com `translator(locale)` dentro do client. Isso diverge do texto da
  ADR-002 (que mostrava `t` como prop) — a ADR descrevia o quê, e a precedência
  do contrato (funcionar no Next) venceu a prosa.

## Implementation Details
Componente de apresentação, sem backend, dado, rota ou Server Action novo. A
mudança é mover `MobileNav` de `app/nav-links.tsx` (server) para
`app/mobile-nav.tsx` (`"use client"`), e fechar o popover num `onClick` no
`<nav>`. Referência de padrão: `app/theme-switch.tsx` e `app/locale-switch.tsx`
já fecham popover com `document.getElementById(id)?.hidePopover?.()`. Ver
TechSpec "Implementation Design > Core Interfaces" para a forma do componente.

### Relevant Files
- `app/nav-links.tsx` — hoje contém `MobileNav` e `NavLinks`; `MobileNav` sai daqui.
- `app/mobile-nav.tsx` — novo client component.
- `app/layout.tsx` — importa `MobileNav`; atualizar caminho.
- `app/theme-switch.tsx`, `app/locale-switch.tsx` — precedente do idioma `hidePopover`.
- `tests/nav-mobile.test.ts` — casos de nó a re-apontar.
- `tests/e2e/ui.mjs` — novo caso e2e (Playwright).

### Dependent Files
- `tests/nav-mobile.test.ts` — afirma endereço do componente e ausência de `"use client"`.
- `tests/e2e/ui.mjs` — valida fechamento em browser real.

### Related ADRs
- [ADR-001: Fechar o menu mobile ao navegar, com o mínimo de JavaScript de cliente](../adrs/adr-001.md) — Por que fechar e a exceção à invariante.
- [ADR-002: Client component dedicado ao menu mobile, fechamento por event delegation](../adrs/adr-002.md) — Onde o componente mora e o mecanismo.

## Deliverables
- `app/mobile-nav.tsx` — client component com fechamento ao navegar.
- `app/nav-links.tsx` — `NavLinks` server, sem `MobileNav`.
- `app/layout.tsx` — import atualizado.
- `tests/nav-mobile.test.ts` — casos de nó re-apontados.
- `tests/e2e/ui.mjs` — caso e2e de fechamento.
- Every test case assigned in `## Tests` implemented and passing **(REQUIRED)**

## Tests

Cases assigned from `_tests.md`, the test contract — read each ID's full definition there before writing tests.

- [x] UT-001, UT-002, UT-003, UT-004, UT-005 — MobileNav: fechamento por event delegation, sem `preventDefault`, escopo `< sm`, `popover="auto"`, itens com `href`
- [x] UT-006, UT-007 — NavLinks: fonte única dos links nos dois menus
- [x] UT-008, UT-009 — MobileNav: `"use client"` no endereço certo, fileira server, `hidePopover` presente
- [x] E2E-001 — menu fecha ao clicar em item, navegação SPA completa
- [x] E2E-002 — Escape e clique-fora continuam, reabertura sem estado residual
- [x] E2E-003 — navegação que falha não deixa menu aberto sobre o erro

## Success Criteria
- Every assigned test case implemented and passing
- Ao tocar num item do menu mobile, o popover fecha e a tela nova aparece desobstruída
- A fileira desktop permanece server (sem `"use client"` em `nav-links.tsx`)
- Escape e clique-fora continuam fechando o menu (sem regressão)
- `pnpm check` verde (typecheck + testes), e o caso e2e novo verde via `pnpm test:e2e`
