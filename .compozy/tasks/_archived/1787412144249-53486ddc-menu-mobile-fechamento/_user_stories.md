# User Stories: Menu mobile fecha ao navegar

Canonical behavior catalog for the mobile navigation menu closing on navigation.
Companion to `_prd.md`; consumed by `_techspec.md` (component mapping) and
`_tests.md` (coverage matrix).

## Personas

- **Candidato (mobile)** — André, usando o dashboard pelo celular, abre o menu
  hambúrguer para trocar de tela e precisa ver a tela nova sem o menu na frente.

## Story Index

| ID     | Feature Area       | Persona  | Story                                             |
|--------|--------------------|----------|---------------------------------------------------|
| US-001 | Fechamento ao navegar | Candidato | Fechar o menu ao clicar em qualquer item          |
| US-002 | Compatibilidade do popover | Candidato | Manter Escape e clique-fora funcionando           |

## Fechamento ao navegar

### US-001: Fechar o menu ao clicar em qualquer item

**As a** candidato no celular, **I want** que o menu feche ao tocar em qualquer
item de navegação, **so that** eu veja a tela para onde fui sem o menu cobrindo
o conteúdo.

Acceptance criteria:

- AC-1: Given o menu mobile aberto em viewport < `sm`, when o usuário toca em
  um item do menu (ex.: "Vagas"), then o menu fecha e a navegação para a tela
  correspondente acontece.
- AC-2: Given o menu aberto, when o usuário toca no item da própria tela em que
  já está, then o menu fecha mesmo assim.
- AC-3: Given o menu aberto no desktop (viewport ≥ `sm`, onde o botão está
  escondido), when a navegação acontece, then nada muda — o menu não existe
  nessa largura.
- AC-4: Given o menu aberto, when o usuário toca em um item cujo destino exige
  permissão que ele não tem (rota não listada, não há), then a navegação segue o
  comportamento normal de autorização; o fechamento não muda isso.

Edge cases:

- EC-1: Duplo toque rápido no mesmo item → o menu fecha no primeiro toque; o
  segundo não reabre nem navega duas vezes.
- EC-2: Toque no link com navegação interceptada pelo `Link` (SPA) → o popover
  fecha antes da pintura da tela nova, sem flash do menu sobre a página nova.
- EC-3: Usuário abre o menu e toca fora, sem tocar em item → fecha por light
  dismiss (comportamento nativo), sem envolvimento do script de fechamento.
- EC-4: Usuário abre o menu e pressiona Escape → fecha (nativo), idem EC-3.
- EC-5: Item sem `href` (não deve ocorrer, pois todos os itens são `Link` com
  rota) → se um dia existir, o clique não navega e o menu permanece — o
  comportamento de fechamento só se aplica a itens que navegam.
- EC-6: Navegação que falha (rota inexistente) → o menu já fechou no gesto; a
  tela mostra o estado de erro padrão da navegação, sem menu aberto sobre ele.

## Compatibilidade do popover

### US-002: Manter Escape e clique-fora funcionando

**As a** candidato no celular, **I want** que o menu continue fechando com
Escape e com toque fora, **so that** o fechamento por navegação não quebre os
mecanismos nativos que já existem.

Acceptance criteria:

- AC-1: Given o menu aberto, when o usuário pressiona Escape, then o menu fecha.
- AC-2: Given o menu aberto, when o usuário toca fora do menu, then o menu
  fecha.
- AC-3: Given o menu fechado, when o usuário toca no botão hambúrguer, then o
  menu abre — o fechamento por navegação não altera o estado do botão.

Edge cases:

- EC-1: Fechamento por navegação seguido de reabertura imediata pelo botão →
  abre normalmente, sem estado residual.
- EC-2: Teclado: usuário navega por Tab até um item e ativa com Enter → fecha
  ao navegar, igual ao toque.
- EC-3: Leitor de tela: o fechamento não rouba o foco de forma surpresa — o
  foco segue a navegação, e não fica preso num menu que já fechou.
