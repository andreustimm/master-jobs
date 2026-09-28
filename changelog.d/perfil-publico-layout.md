## Técnico

### Adicionado

- `src/core/candidate-public.ts`: `PublicSkill` (`name`, `category`, `level`, `occurrences`) substitui `string[]` em `PublicProfile.skills` — `category` e `level` entram na lista de permissão explicitamente (G21), com o mesmo `containsContact()` do nome. `groupPublicSkills()` (pura) agrupa por categoria em ordem alfabética da chave e, dentro do grupo, ocorrências decrescente e nome crescente — determinístico (#326).
- `app/p/[slug]/page.tsx`: layout de referência Jobicy sobre o mesmo dado — hero (nome, headline, faixa de localização, CTA "Ver no LinkedIn", GitHub secundário, copiar link), duas colunas a partir de 1024px (Resumo/Experiência/Formação em card, só quando a seção existe, derivadas na página por `cvSections(profile.cv)` de #325; skills agrupadas na lateral, top 6 por categoria + "+N" em `<details>`, sem caixa alta forçada), currículo completo recolhido em `<details>` nativo. Uma coluna abaixo de 1024px.
- `app/p/[slug]/copy-link-button.tsx` (novo, cliente): copia a URL do perfil, sem servidor envolvido.
- Rótulos "LinkedIn"/"GitHub" (antes fixos no JSX) e os novos textos de UI migram para `src/core/i18n/` (`publicProfile.*`), em pt-BR e en.
- `tests/e2e/public-cv-format.mjs`: `checkPublicProfileLayout()` cobre hero/CTA acima da dobra em 375px, duas colunas em 1024px, agrupamento e expansão de skills, e ausência de caixa alta forçada. `/p/[slug]` sai de `UNMEASURED_PAGES` (`tests/e2e/routes.mjs`) e entra em `AXE_SWEEP`, `OVERFLOW_SWEEP` e `ENGLISH_ANONYMOUS_SWEEP`, sobre o mesmo candidato fixo.

### Fora do escopo

- `--color-cloud` em `app/candidate/markdown-preview.tsx` (linhas 61, 149, 233) é paleta bruta fora de token semântico (G32) — pré-existente, não tocado nesta PR.

## pt-BR

### Adicionado

- O perfil público ganhou um layout novo: nome, cargo e localização em destaque no topo, com botões para ver o LinkedIn, o GitHub e copiar o link do perfil. Resumo, Experiência e Formação aparecem em cartões próprios (só quando existem), e as habilidades confirmadas ficam organizadas por categoria, sem mais aparecer tudo em maiúsculas.

## en

### Added

- The public profile has a new layout: name, headline and location up top, with buttons to view LinkedIn, GitHub and copy the profile link. Summary, Experience and Education show in their own cards (only when present), and confirmed skills are grouped by category instead of all appearing in uppercase.
