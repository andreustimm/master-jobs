## Técnico

### Corrigido

- `@media (pointer: coarse)` em `app/globals.css` fixava `min-height: 40px`, fora de `@layer` — vencia `min-h-11` (44px) do Tailwind v4 e derrubava para 40px todo botão, `summary` e link `inline-flex` num aparelho de toque real, inclusive botões `size="sm"` sem altura explícita (`save-public-facts`, `save-visibility`). DESIGN.md pede 44×44px ("Touch Targets"); a regra agora bate com o número (#403). `tests/e2e/ui/mobile.mjs` ganhou um bloco com contexto `hasTouch: true, isMobile: true` (o resto da suíte não emula toque real, então `pointer: coarse` nunca casava) medindo `save-public-facts`, `save-visibility`, `public-profile-linkedin`, `public-profile-github`, `public-profile-copy-link` e `public-skill-more`.

## pt-BR

### Corrigido

- Botões e links em aparelhos de toque (celular, tablet) agora têm pelo menos 44px de altura, o mínimo recomendado para acertar com o dedo — antes alguns caíam para 40px mesmo parecendo maiores na tela.

## en

### Fixed

- Buttons and links on touch devices (phone, tablet) now measure at least 44px tall, the recommended minimum for a reliable tap — some previously shrank to 40px even though they looked taller on screen.
