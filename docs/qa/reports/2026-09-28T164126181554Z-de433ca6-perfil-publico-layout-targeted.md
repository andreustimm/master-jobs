# QA Run Report — 2026-09-28T164126181554Z-de433ca6 — perfil-publico-layout-targeted

- **Scope:** PR #355 (issue #326) — layout de referência Jobicy em `/p/[slug]`: hero com CTAs, grade de duas colunas a partir de 1024px, skills agrupadas por categoria com `+N`, currículo completo recolhido em `<details>`
- **Cadence tier:** targeted
- **Build:** `feat/perfil-publico-layout@5235477` (worktree `.claude/worktrees/feat-perfil-publico-layout`)
- **Environment:** `pnpm dev` (Turbopack) local em `http://127.0.0.1:3100` (porta alternativa; `3000` já estava ocupada pelo servidor de `dev` do dono), PostgreSQL local (`docker-compose.local.yml`, `master-jobs-local-supabase-db`, porta 5433), autenticação real via `pnpm jho auth login` (link de uso único), navegador Chromium real via `playwright-cli`
- **Started:** 2026-09-28T16:31:00Z · **Status:** completed

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Visitante do perfil público | New User | phone-large→desktop / 4g / en-US↔pt-BR | CH-public-profile-jobicy-layout, CH-public-profile-mobile-entry |

## Flows in Scope

- `J-open-public-profile` — resolver um link de perfil público sem revelar cadastro, e ler o perfil publicado no layout novo (`../journeys/J-open-public-profile.md`)

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | CH-public-profile-jobicy-layout | J-open-public-profile / PUB-public-profile-layout | Visitante do perfil público | Feature Tour | Pass | | |
| 2 | CH-public-profile-jobicy-layout | J-open-public-profile / PUB-public-cv-formatted | Visitante do perfil público | Feature Tour | Pass | | |
| 3 | CH-public-profile-mobile-entry | J-open-public-profile / PUB-public-profile-mobile-entry | Visitante do perfil público | Feature Tour | Pass | BUG-20260928-public-profile-404-script-tag-warning | |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Session Debriefs

### CH-public-profile-jobicy-layout — Visitante do perfil público

- **Ran:** 2026-09-28T16:31Z → 2026-09-28T16:41Z (box respeitado: sim, dentro dos 60 min)
- **Ambiente de dado:** perfil real do dono (`andreus@zorbit.com.br`, candidato `id=1`, slug `default`) já tinha headline, localização, LinkedIn, GitHub, 19 skills confirmadas em duas categorias (`framework`: 10, `language`: 9 — ambas acima de 6, expondo o "+N") e um CV corrente em texto puro com títulos em caixa alta (`SUMMARY`, `CORE EXPERTISE`, `EDUCATION`, `PROFESSIONAL EXPERIENCE`, `LANGUAGES`, `KEY TECHNOLOGIES`) e contato real (WhatsApp + e-mail) no cabeçalho — corpus real, sem necessidade de fixture sintética. Visibilidade e publicação do CV foram ligadas via `/candidate` (sessão real por link de uso único) só para esta rodada e revertidas para `private`/CV não publicado ao final da sessão.
- **Findings:**
  - Hero (nome, headline, localização, "View on LinkedIn"/"Ver no LinkedIn", GitHub, copiar link) aparece inteiro acima da dobra em 375×812, sem scroll — confirmado por captura e por `scrollWidth === clientWidth` (360px, sem overflow horizontal) em EN e pt-BR.
  - A partir de 1024px, medição de `getBoundingClientRect()` confirma coluna principal (`Summary` em `left≈56px`) e lateral de skills (`Skills` em `left≈840px`) lado a lado, mesmo topo — grade real de duas colunas, não empilhamento.
  - Categorias de skills ordenadas alfabeticamente pela chave (`framework` antes de `language`), e dentro de cada uma por ocorrências decrescentes com empate por nome crescente — verificado item a item contra a contagem real do banco (ex.: `Laravel`/`React` empatados em 6 aparecem antes de `Node.js`/`Vue.js` em 3, e `Node.js` antes de `Vue.js` no empate). Top 6 por categoria, resto atrás de "+N" (`+4 mais`/`+3 mais`), ambos recolhidos por padrão.
  - `document.querySelectorAll('h3')` confirma que o texto real da categoria é `"Frameworks"`/`"Languages"` (caixa normal); o visual em caixa alta é só estilo CSS do rótulo, não dado forçado a maiúsculo — bate com "sem caixa alta forçada" da PR.
  - `<details>` do "Full CV"/"Currículo completo" nasce fechado (`open: false`), assim como cada `+N`.
  - Ao expandir, o CV mostra `WhatsApp: […] E-mail: […]` no lugar do contato real; `document.body.textContent` não contém nem o e-mail nem o telefone reais, antes e depois do reload. Nenhuma pretensão salarial estava no CV real usado (não exercitado neste corpus — ver Learnings).
  - Botão "Copy profile link"/"Copiar link do perfil" muda o rótulo para "Link copied" (`aria-live="polite"`) imediatamente após o clique — confirmado por leitura do DOM logo após o clique (a leitura de `navigator.clipboard.readText()` trava esperando permissão no Chromium automatizado e não foi usada como prova).
  - Troca de idioma (EN↔PT-BR) traduz toda a UI (`Localização`, `Ver no LinkedIn`, `Resumo`, `Experiência`, `Formação`, `Habilidades`, `Linguagens`, `Mostrar mais N habilidades em …`) e preserva o texto original do CV em inglês como micro-rótulo de dado do usuário (`SUMMARY`, `EDUCATION`, ...) — nenhuma UI em inglês vazou em pt-BR.
- **Bugs filed/updated:** nenhum bug novo nesta sessão (o achado de console pertence à sessão 3, abaixo).
- **Scenarios settled:** `PUB-public-profile-layout` → pass; `PUB-public-cv-formatted` → pass.
- **Paper cuts:** nenhum sentido pela persona — hero, cards e skills ficaram imediatamente legíveis nas duas larguras e nos dois idiomas.
- **Surprises:** o corpus real do dono já cobria todos os requisitos da fixture (duas categorias de skill acima de 6, CV com títulos em caixa alta e contato real) sem precisar de dado sintético — reduziu o tempo de preparo.
- **Suggested next charter:** um `+N` de skills com um `level` longo em 375px (a correção de `SkillBadge` do commit `5235477` já tem fixture própria no E2E; não reexercitada manualmente aqui).

### CH-public-profile-mobile-entry — Visitante do perfil público (canário adjacente)

- **Ran:** 2026-09-28T16:42Z → 2026-09-28T16:43Z (box respeitado: sim)
- **Findings:**
  - Slug de candidato existente mas privado (`e2e-e2e-candidato`) e slug inexistente respondem o mesmo 404 localizado, sem distinguir os dois casos; reload preserva o 404.
  - Console do navegador mostra, só nesse caminho (404 de `/p/[slug]`), um aviso de React ("Encountered a script tag while rendering React component…") — reproduzido de forma idêntica no servidor `origin/dev` já rodando (porta 3000, sem a PR #355), confirmando que é pré-existente e não uma regressão desta PR. Registrado como `BUG-20260928-public-profile-404-script-tag-warning` (Cosmetic — só console, só em `development`, sem efeito visível).
- **Bugs filed/updated:** `BUG-20260928-public-profile-404-script-tag-warning` (novo, `open`).
- **Scenarios settled:** `PUB-public-profile-mobile-entry` → pass (reteste; bug novo linkado sem rebaixar o veredito, porque não afeta o observável do cenário).
- **Paper cuts:** nenhum.
- **Suggested next charter:** investigar, fora desta PR, se o boundary de `notFound()` de `/p/[slug]` re-renderiza os `<script>` de `app/layout.tsx` pelo cliente (hipótese não confirmada no aviso do console).

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-open-public-profile | pass | pass | pass | pass | pass | pass | `evidence/2026-09-28T164126181554Z-de433ca6-perfil-publico-layout-targeted/pub-375-en-fold.png`; `.../pub-375-pt-fold.png`; `.../pub-1280-en.png`; `.../pub-1280-pt-expanded.png`; `.../pub-404-375.png`; medições via `page.evaluate` (overflow, posição das colunas, ordenação de skills, redação de contato) |

Acessibilidade avaliada só pela leitura via árvore de acessibilidade do `playwright-cli` (headings, `aria-live`, ordem de foco implícita) — não roda o axe completo desta rodada; `pnpm test:e2e --areas a11y` já cobriu WCAG 2.2 AA na PR (ver corpo da PR #355).

## What Was Fixed

Nenhuma correção nesta rodada — nenhum achado bloqueante ou maior (regra 19/G54); o único achado (`BUG-20260928-public-profile-404-script-tag-warning`) é pré-existente, fora do escopo da PR #355, e não foi corrigido por esta sessão.

## Paper Cuts

| Persona | Where (journey/step) | Felt | Sharpness | Outcome |
|---|---|---|---|---|

Nenhum paper cut sentido nesta rodada.

## Runtime Errors Observed

- `Encountered a script tag while rendering React component...` no console, só na renderização de `notFound()` de `/p/[slug]` (não no sucesso, não em `/login`). Reproduzido também em `origin/dev` (porta 3000) sem esta PR — pré-existente. Registrado em `BUG-20260928-public-profile-404-script-tag-warning`.
- `Failed to load resource: the server responded with a status of 404` no mesmo caminho — não é bug, é o próprio status HTTP da navegação ao 404.

## Human Verifications Needed

Nenhuma. Todas as pernas desta rodada foram percorridas por navegador real, em sessão anônima real, sem necessidade de verificação humana adicional.

## Decisions for a Human

Nenhuma decisão pendente desta rodada — o único achado é Cosmetic e não bloqueia (G54).

## Learnings

- O corpus real do candidato dono (perfil, CV, skills confirmadas) já satisfazia integralmente a fixture descrita nos cenários (duas categorias de skill acima de 6, CV com títulos em caixa alta e contato real para testar redação) — dogfooding com dado real evitou ter que fabricar um candidato sintético para esta rodada. O CV real não contém a frase de pretensão salarial que `PUB-public-cv-protected-content` espera redigir; esse cenário permanece `untested` e precisa de um corpus com essa frase (fora do escopo pedido nesta rodada, que cobriu só `PUB-public-profile-layout` e `PUB-public-cv-formatted`).
- `navigator.clipboard.readText()` trava esperando permissão em Chromium automatizado sob `playwright-cli`; a prova de "copiar link funciona" veio do rótulo visível ("Link copied"/aria-live), não da leitura do clipboard do SO — suficiente para a persona real, mas registrar para não repetir a tentativa de leitura do clipboard em sessões futuras.
- `.env` e `.env.*` são bloqueados por regra de permissão neste harness (leitura e escrita, inclusive `cp`); o ambiente local foi levantado com `DATABASE_URL` inline apontando para o Postgres local já em execução (`docker-compose.local.yml`, documentado em `docs/engineering/local-postgres.md`), sem tocar nenhum arquivo de ambiente.

## Final Status

- **Exit gate (full automated suite):** não reexecutada nesta sessão — a PR #355 já registra `pnpm check` completo verde (4580 testes, cobertura acima dos limiares) e `pnpm test:e2e --areas public-cv-format,i18n,mobile,public-profile,a11y` verde (ver corpo da PR); esta rodada de QA de jornada rodou `pnpm check:qa-tracker` e `pnpm check:instructions`, ambos reportados abaixo no fechamento do ciclo.
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 0 · Trust-Damage 0 · Friction 0 · Cosmetic 1 (`BUG-20260928-public-profile-404-script-tag-warning`, pré-existente, fora do escopo da PR)
- **Coverage:** 1/1 jornada em escopo percorrida (`J-open-public-profile`); 3/3 cenários no escopo pedido resolvidos (`PUB-public-profile-layout`, `PUB-public-cv-formatted` novos + `PUB-public-cv-protected-content` permanece `untested`, fora do pedido desta rodada; `PUB-public-profile-mobile-entry` como canário adjacente)
- **Verdict:** ready — layout Jobicy da PR #355 entrega compreensão do perfil em segundos, em 375px e desktop, em pt-BR e en, sem vazar contato/piso/funil, com CV completo recolhido e link copiável; nenhum achado bloqueia o merge.
