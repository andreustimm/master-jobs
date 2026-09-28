# BUG-20260928-public-profile-404-script-tag-warning: 404 de `/p/[slug]` acusa aviso de React sobre `<script>` no console

- **Status:** open
- **Impact (user-side):** Cosmetic
- **Severity:** Low · **Priority:** P3
- **Persona Affected:** Visitante do perfil público
- **Journey Step:** J-open-public-profile, passo 1 (abrir link ausente ou revogado)
- **Scenarios:** PUB-public-profile-mobile-entry
- **Found:** 2026-09-28 · **Report:** docs/qa/reports/2026-09-28T164126181554Z-de433ca6-perfil-publico-layout-targeted.md

## Summary

Ninguém vê isto na tela — a tela 404 continua correta, sem identidade nem dado
privado. É um aviso só de console, só em modo `development`: "Encountered a
script tag while rendering React component. Scripts inside React components
are never executed when rendering on the client." Registrado porque apareceu
consistentemente ao percorrer o canário adjacente (404 de `/p/[slug]`) desta
rodada, e o registro global é o lugar certo para não perder o achado.

## Reproduction

- **Charter:** CH-public-profile-mobile-entry · **Tour:** Feature Tour
- **Environment:** Chromium via `playwright-cli`, `pnpm dev` local (Turbopack), sessão anônima

1. Sem sessão, abrir `http://127.0.0.1:3100/p/<slug-ausente-ou-nao-publicado>`
   (qualquer slug inexistente ou de candidato não público).
2. A página responde 404 corretamente ("Página não encontrada" / "Page not
   found"), sem vazar identidade.
3. Ler o console do navegador.

**Expected:** Nenhum erro de console na renderização do 404.
**Actual:** Dois erros aparecem: (a) "Failed to load resource: the server
responded with a status of 404" — esperado, é só o próprio status HTTP da
navegação, não é bug; (b) "Encountered a script tag while rendering React
component..." apontando para o chunk de runtime do Next — esse é o achado.
Reproduzido de forma consistente em `/p/<qualquer-slug-inexistente>` nesta
worktree (`feat/perfil-publico-layout`, build local) **e também** no servidor
local já rodando em `origin/dev` (porta 3000, sem esta PR) com o mesmo slug
inexistente — ou seja, **pré-existente, não introduzido pela PR #355**. Não
reproduz em `/p/<slug-publicado>` (sucesso) nem em `/login`.

## Evidence

- Console coletado via `playwright-cli console error` em três navegações
  distintas a slugs inexistentes (worktree desta PR, porta 3100, e `dev` na
  porta 3000): a mesma mensagem aparece nas três, sempre ausente na renderização
  de sucesso.
- Leitura independente: recarregar o mesmo slug reproduz o mesmo aviso, sempre
  nos dois mesmos erros, nunca mais que isso.

## Fix

<!-- não corrigido nesta rodada: fora do escopo da PR #355, que não toca o
caminho de notFound() de `/p/[slug]`. Hipótese não confirmada: o boundary de
"não encontrado" da rota pode estar re-renderizando os `<script>` de
`app/layout.tsx` (`renderStandaloneScript`/`renderSplashScript`) pelo cliente
em vez de deixá-los apenas no HTML servido, o que também levanta a dúvida
(não verificada) de se esses scripts realmente executam nesse boundary. Vale
uma issue própria para investigar, sem urgência — é aviso de desenvolvimento,
não aparece no build de produção. -->

## Verification

<!-- pendente -->
