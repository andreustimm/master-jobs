## Técnico

### Adicionado

- Diretório de perfis para recrutadores (#465, ADR-013): `/recruiter/directory` (busca por nome, headline e skill confirmada, sem caixa nem acento, com filtros de localização, modelo de trabalho e nível só onde o "mostrar" está ligado, 20 por página, ordem por nome e id), `/recruiter/directory/[id]` (perfil) e `/recruiter/directory/[id]/image/[kind]`, todos com `requirePage("candidate:discover")` antes de qualquer leitura. As visibilidades (`recruiters`, `public`) são constante do servidor em `src/core/candidate-directory.ts`; parâmetro da requisição não amplia visibilidade nem campo, e nada conta perfil Privado. Link no menu do recrutador.
- Limite de 60 buscas por recrutador em 10 minutos, por "grava e depois conta" em `recruiter_directory_query` (ADR-017); abrir um perfil do diretório conta no mesmo limite. A 61ª mostra "Tente de novo em instantes" e nenhum cartão.
- Área de E2E `recruiter-directory` com perfis Público, Recrutadores e Privado de fixture, e a lista `RECRUITER_SWEEP` em `tests/e2e/routes.mjs` (inglês, 375 px e axe com sessão de recrutador).

### Alterado

- `publicProfile()` vira invólucro de `allowlistedProfile(key, visibilities)`, com o mapeamento linha → perfil puro em `toAllowlistedProfile()`; `/p/[slug]` e o diretório leem a mesma lista de permissão, e o corpo da página foi para `app/p/[slug]/profile-view.tsx`. Só perfil Público sai com endereço `/p/`. Os e-mails de TODAS as contas ligadas ao candidato passam a ser retirados do texto, não só o de uma.
- `setVisibilityAction` exige também `access:manage` (sessão emprestada não muda visibilidade nem consentimento), devolve `invalidVisibility` em vez de lançar, e mantém o consentimento do currículo em Recrutadores e Público, apagando-o só em Privado (ADR-014).
- `vitest.config.ts` resolve o `@/*` do `tsconfig.json`, para teste renderizar tela real.

## pt-BR

### Adicionado

- Recrutadores ganham um diretório de perfis: buscam por nome, headline ou skill entre os candidatos que escolheram Recrutadores ou Público, filtram por localização, modelo de trabalho e nível, e leem só o que o perfil público mostra.

### Alterado

- Em "Quem vê este perfil", cada opção explica quem encontra e lê o perfil; Recrutadores alcança também quem se cadastrou sozinho como recrutador.
- O consentimento do texto do currículo vale para Recrutadores e Público. E-mail, telefone e pretensão salarial escritos no currículo continuam fora.

## en

### Added

- Recruiters get a profile directory: they search by name, headline or skill among candidates who chose Recruiters or Public, filter by location, work model and level, and read only what the public profile shows.

### Changed

- Under "Who sees this profile", each option explains who finds and reads the profile; Recruiters also reaches people who signed up as recruiters on their own.
- Consent to the CV text now applies to Recruiters and Public. Email, phone and salary expectations written in the CV still stay out.
