## Técnico

### Corrigido

- `--warn` usado como cor de texto (G32: token de preenchimento, não de texto) media 4,06:1 em huly e graphy claros — abaixo do mínimo WCAG 1.4.3 AA de 4,5:1 (#383). Novo token `--warn-text` (`app/themes.css`, definido em todos os temas/modos) substitui os quatro usos como cor: `app/candidate/page.tsx`, `app/layout.tsx` (faixa de sessão emprestada, x2) e `app/admin/operacoes/page.tsx`. `tests/design.test.ts` reprova `text-[var(--warn)]` daqui em diante; `tests/e2e/ui/themes.mjs` mede o contraste do aviso de visibilidade nas seis combinações de tema/modo, lendo o estilo computado num Chromium real.

## pt-BR

### Corrigido

- O aviso "legível por qualquer um" do perfil público (e três outros avisos) ficava difícil de ler nos temas Huly e Graphy claros. Agora o contraste passa no mínimo de acessibilidade em todos os temas.

## en

### Fixed

- The "readable by anyone" public-profile warning (and three other warnings) was hard to read in the light Huly and Graphy themes. Contrast now meets the accessibility minimum in every theme.
