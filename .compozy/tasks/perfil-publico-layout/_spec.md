# Perfil público, fase 2/3: layout de referência Jobicy

**Slug:** `perfil-publico-layout` · **Issue:** [#326](https://github.com/andreustimm/master-jobs/issues/326)
· **Depende de:** fase 1, #325 (`src/core/cv-markdown.ts`, mesclada em #339)
· **Issue-mãe:** [#315](https://github.com/andreustimm/master-jobs/issues/315)

## Parte de produto

`/p/[slug]` mostrava nome, headline, localização, uma faixa achatada de
skills em caixa alta sem agrupamento e o CV inteiro num `Card`. A fase 1 já
resolveu a formatação do texto do CV (títulos e listas); esta fase resolve o
LAYOUT, com o dado que já existe — sem capa, foto, disponibilidade nem modelo
de trabalho (fase 3, opt-in).

Referência escolhida pelo dono (#315): Jobicy. Traduzida para os tokens deste
projeto, não copiada visualmente (cor, fonte).

## Parte técnica

### DTO (`src/core/candidate-public.ts`)

`PublicProfile.skills` passa de `string[]` para `PublicSkill[]`:

```ts
type PublicSkill = { name: string; category: string; level: string | null; occurrences: number };
```

`category` e `level` entram na lista de permissão (G21) EXPLICITAMENTE — o
schema já os tinha antes desta função os expor. `level` é escrito só por um
humano (comentário no schema: "deliberately not inferred"), então passa pelo
mesmo `containsContact()` do nome; uma skill com contato em `name`,
`category` ou `level` some inteira (não há "esvaziar só o campo" num item de
array). Nada de e-mail, telefone, piso, funil, `candidateId` ou recrutador —
inalterado da fase anterior.

`groupPublicSkills()`, nova função pura no mesmo módulo: agrupa por
`category`, ordena as categorias por ordem alfabética da CHAVE (não do
rótulo traduzido — rótulo muda de idioma, chave não) e, dentro do grupo,
ocorrências decrescente e nome crescente no empate. Testável sem banco.

### Seções do CV

`cvSections(profile.cv)` (já exportada de `src/core/cv-markdown.ts` pela fase
1) é chamada NA PÁGINA, não em `candidate-public.ts` — o texto que chega já
passou pelos dois filtros de `publicCvMarkdown()`, e derivar seções dele
nunca devolve o que os filtros tiraram, porque `cvSections()` só lê o que
sobrou. Card sem a seção correspondente não aparece (nunca "No data
available").

### Layout (`app/p/[slug]/page.tsx`)

- Hero: nome, headline, faixa de fatos (só localização por ora), CTA "Ver no
  LinkedIn" (só link, regra 1), GitHub secundário, botão copiar link
  (`app/p/[slug]/copy-link-button.tsx`, cliente).
- Grid de duas colunas a partir de `lg:` (1024px, Tailwind): principal
  (Resumo/Experiência/Formação em card + CV completo recolhido) + lateral
  (skills). Uma coluna abaixo disso, na ordem do documento.
- Skills: badge sem caixa alta forçada (`type-micro` força `uppercase`; o
  badge de skill usa `type-meta`, que não força). Top 6 por categoria + o
  resto atrás de um `<details>` com "+N".
- CV completo: mesmo `MarkdownPreview` de antes, agora dentro de um `<details>`
  nativo com borda própria (sem `Card` — é um contêiner de disclosure, não um
  cartão de conteúdo), recolhido por padrão.
- Rótulos "LinkedIn"/"GitHub" (antes fixos no JSX) e os textos novos entram
  em `src/core/i18n/` (`publicProfile.*`), pt-BR e en.

### Fora de escopo (registrado, não corrigido aqui)

- `--color-cloud` em `app/candidate/markdown-preview.tsx` (paleta bruta,
  G32) é pré-existente e não pertence a este layout.
- Dados novos opt-in da fase 3 (modelo de trabalho, nível, disponibilidade,
  idiomas, foto, capa).
- `src/core/public-cv.ts` não muda nesta PR (outra PR, #352).

## Decisão sobre `UNMEASURED_PAGES`

`app/p/[slug]/page.tsx` SAI de `UNMEASURED_PAGES` (`tests/e2e/routes.mjs`):
o candidato fixo de `public-cv-format.mjs` ganhou headline, localização,
links e skills, e o texto que não é dado do usuário (rótulos, categorias)
agora vem do dicionário — a exceção original citava justamente o oposto
("hoje: LinkedIn/GitHub fixos no código"). A rota entra em `AXE_SWEEP`,
`OVERFLOW_SWEEP` e `ENGLISH_ANONYMOUS_SWEEP` sobre esse mesmo candidato.

## Contrato cumprido

Ver `_tests.md`. Unit em `tests/candidate-public-skills.test.ts` (puro) e
`tests/public-profile.test.ts` (com banco); E2E em
`tests/e2e/public-cv-format.mjs` (`checkPublicProfileLayout`), mais as
varreduras transversais (`i18n`, `mobile`, `a11y`) que passaram a visitar a
rota.
