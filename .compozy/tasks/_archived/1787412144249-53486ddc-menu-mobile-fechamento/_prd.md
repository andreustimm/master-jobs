# PRD: Menu mobile fecha ao navegar

## Overview

No celular, o menu hambúrguer do Master Jobs abre um popover nativo com os links
de navegação. Ao tocar num item, a tela troca por trás do menu — mas o menu não
fecha, porque o popover nativo só se fecha por clique fora ou por Escape, e o
clique num item acontece **dentro** do popover. O usuário toca em "Vagas",
chega à tela de vagas, e o menu continua aberto por cima do conteúdo.

O problema atinge quem usa o dashboard pelo celular — o cenário principal de
quem está em movimento, sem desktop. O menu deveria fechar ao navegar, como em
qualquer aplicativo móvel; é comportamento universal, não conveniência.

## Goals

- O usuário toca num item do menu e vê a tela nova **sem** o menu por cima.
- O fechamento por navegação convive com os mecanismos nativos que já existem
  (Escape, toque fora), sem regressão.
- A navegação em si (SPA via `Link`) permanece idêntica — só o popover fecha.
- A invariante "zero JavaScript de cliente" continua valendo para toda a árvore,
  com uma única exceção documentada e mínima.

## User Stories

- US-001–US-002: fechamento ao navegar e compatibilidade do popover nativo.
- [Full user stories](_user_stories.md)

## Core Features

### Fechamento do menu ao navegar

O menu mobile fecha automaticamente quando o usuário toca em qualquer item.
Comportamento observável: tocou, o menu some, a tela nova aparece desobstruída.

- O fechamento se aplica a **todo** clique em link dentro do menu, sem
  distinguir se o destino é a tela atual ou outra.
- O fechamento acontece no mesmo gesto do clique, antes de a tela nova pintar.
- A navegação não é interceptada: o `Link` do Next.js segue fazendo seu trabalho
  de SPA; o script só fecha o popover.
- No desktop (viewport ≥ `sm`) o menu não existe — o componente que fecha é
  escopado ao mobile e não tem efeito ali.

### Compatibilidade com o popover nativo

O popover nativo continua cuidando do que já fazia: abrir pelo botão, fechar por
Escape, dispensar por toque fora. O fechamento por navegação é um caminho
adicional, não um substituto.

## Business Rules

- **Invariante:** após um clique em item de navegação, o menu mobile está
  fechado. Não há estado em que a tela nova aparece com o menu aberto por cima.
- **Escopo da exceção:** a árvore `app/` permanece "zero JavaScript de cliente"
  exceto pelo componente mínimo responsável pelo fechamento do menu mobile.
  Nenhuma outra parte da árvore pode passar a enviar script de cliente sob esta
  regra.
- **Larguras:** o menu mobile só existe abaixo de `sm`. Acima disso, o fechamento
  por navegação não tem efeito (não há menu).
- **Autorização:** o fechamento é independente de permissão. Se a navegação for
  negada por autorização, o menu já fechou no gesto; a negação é mostrada pela
  tela, não pelo menu.

## User Experience

Persona: candidato (e papéis equivalentes — recrutador, admin) usando o
dashboard no celular.

Fluxo primário:

1. Usuário toca no botão hambúrguer; o menu abre em popover, ancorado no topo.
2. Usuário toca em "Vagas" (ou qualquer item).
3. O menu fecha imediatamente; a navegação SPA leva à tela de vagas.
4. Usuário lê a tela nova desobstruída.

Fluxos secundários:

- Usuário abre o menu, desiste, toca fora → fecha (nativo).
- Usuário abre o menu, pressiona Escape → fecha (nativo).
- Usuário toca no item da tela em que já está → menu fecha mesmo assim.

Acessibilidade: o fechamento por navegação não deve roubar o foco para um menu
que já sumiu; o foco segue a navegação. Teclado (Tab + Enter num item) fecha
igual ao toque.

## High-Level Technical Constraints

- O fechamento exige JavaScript de cliente — é a exceção mínima à invariante
  "zero JavaScript" da árvore `app/` (ver ADR-001).
- O mecanismo deve coexistir com o popover nativo (`popover="auto"`), que
  continua dono de abrir/fechar por Escape/toque-fora.
- Os links permanecem `Link` do Next.js; `typedRoutes` continua validando as
  rotas em tempo de compilação.

Implementação específica (client component vs. `onClick` inline, `hidePopover()`
vs. `popoverTargetAction`) pertence ao TechSpec.

## Non-Goals (Out of Scope)

- Não reabrir, não alterar, não reimplementar o menu: o defeito é só o
  fechamento por navegação.
- Não trocar o popover nativo por outra abstração (disclosure, biblioteca de
  menu).
- Não revisar a invariante "zero JavaScript" globalmente — a exceção é pontual e
  documentada (ADR-001).
- Não mexer no changelog do rodapé, que já tem botão de fechar próprio.
- Não criar animação de fechamento nem mudar o layout do menu.

## Architecture Decision Records

- [ADR-001: Fechar o menu mobile ao navegar, com o mínimo de JavaScript de cliente](adrs/adr-001.md) — Fechar sempre, em todo clique de link, com um client component mínimo; exceção documentada à invariante "zero JavaScript".

## Open Questions

- Nenhuma. A decisão de implementação (forma exata do script de cliente) é
  deliberadamente deixada para o TechSpec.
