# Regras de interface: texto, tema, acessibilidade e celular

Referência normativa do frontend. Resumo crítico em
[AGENTS.md](../../../AGENTS.md); índice e procedimento de conflito em
[README.md](README.md). A fonte da verdade visual é [DESIGN.md](../../../DESIGN.md)
— leia antes de qualquer trabalho de frontend. Os tokens estão traduzidos em
`app/design-tokens.css`, `app/globals.css` e `app/themes.css`.

---

<a id="g29"></a>
## G29 — Texto de interface vem do dicionário (regra 9)

**Obrigação.** String literal no JSX é tradução que nunca vai existir. Página
obtém o tradutor com `getTranslator()`. `pt-BR` e `en` ficam em
`src/core/i18n/`, com chaves tipadas contra o dicionário português: tradução
faltando é erro de compilação, não espaço em branco descoberto por um usuário.

**Inclui rótulo dentro de constante.** `COMPONENTS` em `app/ui.tsx`,
`FIELD_LABEL` no modal, `CATEGORY_LABEL` nas skills e `THEMES[].description`
guardavam texto pronto. Constante guarda **chave** — texto em constante não
aparece em busca por string no JSX e sobrevive a uma revisão de tradução
inteira.

**Antes de criar chave, procure a existente.** `candidate.edit`,
`vocabulary.title` e `nav.appearance` já estavam no dicionário e sem uso: a
tradução existia e o componente a ignorava.

Origem: regra 9. Prova: `tests/i18n.test.ts` e a varredura de G30.

<a id="g30"></a>
## G30 — Rota nova entra na varredura de idioma; dado do usuário é marcado

**Obrigação.** `pnpm test:e2e` percorre em inglês as rotas das listas
`ENGLISH_*_SWEEP` de `tests/e2e/routes.mjs` (como dono, sem sessão e depois de
criar trilhas) e reprova por dois critérios: texto que **é** valor do
dicionário português, e texto com acento. Rota nova entra nas listas **no mesmo
commit** que a cria. Dado do usuário fica de fora por `data-user-content` (o
currículo tem "São Paulo" e continua tendo em inglês).

**Toda página tem varredura ou exceção.** `tests/e2e-route-coverage.test.ts`
cruza as listas com o inventário de páginas: página sem varredura nem exceção
registrada, com motivo, em `UNMEASURED_PAGES` reprova o `pnpm check`. A
varredura também confere o destino: ser mandada ao `/login` no lugar da tela
pedida é falha, não medição limpa.

**A lista decide o que é medido; os critérios, o que reprova.** Tela em
`UNMEASURED_PAGES` passa sem ser medida — e numa tela listada, literal de JSX só reprova se
tiver acento ou já for valor do dicionário português. A lista é necessária, não
suficiente: G29 continua sendo a defesa, e a varredura é a rede. Foi assim que
`/jobs/<id>` serviu `← vagas`, `Ver vaga na origem` e `visto em` em português
com a interface em inglês. Por isso a fixture varrida é acentuada: sem acento,
tirar a marca `data-user-content` não reprovaria nada.

**Não copie a contagem de rotas** para documentos (resolve C13): a fonte é o
próprio `tests/e2e/routes.mjs`.

Origem: regra 9. Prova: `tests/e2e-route-coverage.test.ts` e a varredura de
`tests/e2e/ui.mjs` (#267). No CI, o job `e2e-navegador` roda a suíte inteira;
o que ele prova e o que só a jornada prova está em
[docs/qa/README.md](../../qa/README.md#o-que-o-ci-prova-e-o-que-só-a-jornada-prova).

<a id="g31"></a>
## G31 — Controle em teste por `data-testid`

**Obrigação.** Teste que busca controle por texto quebra quando alguém traduz.
Use `data-testid` para controle e texto só para conteúdo.

Origem: regra 9. Critério de revisão.

<a id="g32"></a>
## G32 — Componente lê só token semântico (regra 10)

**Obrigação.** Componente usa token semântico: `--background`,
`--foreground`, `--card`, `--primary` (superfície de botão), `--primary-text`
(link e texto de acento — contrasta com o FUNDO, não com o botão), `--border`,
`--muted`, `--hairline`, `--good`, `--warn`, `--bad`, `--accent-2`, e os
utilitários do Tailwind mapeados sobre eles. Um `#hex`, `rgb()` ou token bruto
de paleta (`--color-iris`, `--color-ember`…) num componente é o tema vazando, e
a partir daí um dos temas começa a ficar errado. Um `--color-*` que é apelido de
variável do tema (`--color-brand`, `--color-hairline`) é token semântico, não
paleta. A paleta bruta pertence à
**definição** do tema, não ao componente.

**Resolve C08.** A entrada comum dizia em outro parágrafo "use
`var(--color-*)`", o oposto desta regra. Não vale mais. Um `--color-*` só é
aceito quando `globals.css` o declara como apelido de variável semântica
(`--color-hairline: var(--hairline)`); paleta crua reprova. As poucas exceções
toleradas ficam nomeadas, com motivo, em `STYLE_EXCEPTIONS` de
`tests/design.test.ts`, e exceção órfã também reprova
([#204](https://github.com/andreustimm/master-jobs/issues/204)).

**Token de UI não serve como cor de texto.** `--accent-2`, `--warn` e afins são
feitos para preenchimento, onde o mínimo é 3:1 — `--accent-2` no tema graphy
claro dá 2.53:1 contra o fundo do editor. Texto precisa de 4.5:1. A paleta de
sintaxe do editor mora em `--cm-*`, verificada nos seis ambientes por
`pnpm test:e2e` lendo o estilo computado dos spans reais.

Origem: regra 10 e invariante "Token de UI". Prova: `tests/design.test.ts`
(V10-03: hex de qualquer tamanho, `rgb()`/`oklch()`, paleta crua e do
Tailwind, tamanhos fora da escala, em `.tsx`, `.ts` e `.css` fora dos
arquivos de definição), E2E de contraste.

<a id="g33"></a>
## G33 — Escala fechada; nada de `xs`…`xl` em dimensão

**Obrigação.** Tela nova, componente novo, ajuste visual: derive dos tokens
existentes. Nunca escreva cor, tamanho de fonte ou espaçamento fora da escala —
nem "só desta vez", nem "um valor aproximado". Se algo parece faltar, componha
com o que existe. Use as classes `type-*` e os utilitários de espaçamento já
mapeados; um `text-[13px]` num componente é sinal de regra quebrada.

**Nunca use `max-w-xs`, `max-w-sm`, `max-w-md`, `max-w-lg` nem `max-w-xl`**
(idem `w-`, `h-`, `min-w-`). O Tailwind v4 resolve esses nomes por
`--spacing-<nome>`, e o DESIGN.md nomeia os espaçamentos assim — `max-w-xs`
vale 8px, não 320px. Use valor explícito.

Origem: regra 10. Prova: `tests/design.test.ts`, `tests/ui-spacing.test.ts`.

<a id="g34"></a>
## G34 — Três temas, claro/escuro/sistema; tema novo não toca componente

**Obrigação.** Três temas — **HP**, **Huly**, **Graphy** — cada um com ambiente
claro e escuro, e um terceiro estado que segue o sistema operacional. Definidos
em `app/themes.css`, registrados em `src/core/theme.ts` (que é a fonte do
inventário). Tema novo = um bloco em `themes.css` + uma linha em `theme.ts`;
nada em `components/` muda.

**Fonte.** A especificação usa **Forma DJR Micro**, proprietária; o projeto usa
**Inter** (~85% de similaridade, OFL-1.1), com a substituição documentada no
topo de `app/design-tokens.css`. Com Adobe Fonts, troque só `--font-sans`.

Origem: regra 10. Prova: `tests/cov-core-theme.test.ts`.

<a id="g35"></a>
## G35 — Toda tela funciona no celular (regra 11)

**Obrigação.** Verificado por `pnpm test:e2e`, que mede `scrollWidth` real em
375px — teste estático não pega estouro horizontal. `export const viewport` com
`width: device-width` no layout raiz (sem isso o telefone renderiza a 980px e
todo o CSS responsivo vira código morto). Grid de múltiplas colunas precisa de
fallback de coluna única; nada de largura fixa acima de 360px; nunca limite o
zoom. Layout que só existe no desktop não cumpriu o DESIGN.md.

Origem: regra 11. Prova: `tests/mobile.test.ts`, E2E em 375px.

<a id="g69"></a>
## G69 — Estado de filtro vive na URL; servidor é a autoridade

**Obrigação.** Estado de filtro vive na URL, não em estado React: a visão
filtrada é compartilhável e o botão voltar funciona. O servidor continua sendo
a fronteira de dados e de autorização. UI é shadcn/ui sobre Tailwind v4;
`--primary` é o azul do DESIGN.md.

**Resolve C10.** A frase antiga "as páginas não enviam JS de cliente" é
absoluta demais para o produto atual. Ilhas cliente estreitas são permitidas
(ADR 0015) desde que não dupliquem regra de negócio nem puxem o grafo do
servidor para o bundle.

Origem: AGENTS ("Convenções de código"). Detalhes:
[architecture.md](../../architecture.md),
[ADR 0015](../../adr/0015-modal-nativo-com-ilha-cliente.md),
[docs/product/](../../product/). Prova: `tests/filter-state.test.ts`,
`tests/architecture.test.ts` ("client islands stay out of the server graph").
