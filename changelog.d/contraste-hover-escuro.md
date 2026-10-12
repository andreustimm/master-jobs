## Técnico

### Corrigido

- Botão primário sob o ponteiro: o fundo deixa de ser `bg-primary/80` (o azul translúcido compunha com o que houvesse atrás e dava 3,50–4,44:1 com o texto em cinco dos seis tema/modo; só o HP claro passava, com 4,71:1) e passa a ser o token opaco `--primary-hover`, declarado em cada tema e modo de `app/themes.css` (inclusive na cópia do escuro herdado do sistema) e exposto como `--color-primary-hover` em `app/globals.css`. O valor é o `--primary` 12% em direção ao preto (claro) ou ao branco (escuro), então o hover nunca contrasta menos que o repouso: de 6,00:1 a 8,39:1 nos seis. `components/ui/button.tsx` e `components/ui/badge.tsx` (variante `default` como link) usam `hover:bg-primary-hover`. `tests/design.test.ts` passa a exigir `--primary-hover` com pelo menos 4,5:1 contra `--primary-foreground` nos três estados de cada tema, não menor que o repouso e diferente de `--primary`, e a barrar `hover:bg-primary/<n>` em qualquer `.tsx` (#501).

## pt-BR

### Corrigido

- O botão principal ("Buscar", "Aplicar" e os demais) deixa de ficar com o texto difícil de ler quando o ponteiro passa por cima, nos três temas e nos modos claro e escuro. No tema claro, o botão agora escurece no hover em vez de clarear.

## en

### Fixed

- The primary button ("Search", "Apply" and the rest) no longer becomes hard to read when the pointer hovers it, in all three themes and in light and dark modes. In the light theme the button now darkens on hover instead of lightening.
