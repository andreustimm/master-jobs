## Técnico

### Adicionado

- `src/core/cv-markdown.ts`: `cvTextToMarkdown()`, normalizador puro e idempotente que lê o CV importado de PDF como Markdown (título em caixa alta ou nome de seção conhecido vira `##`; `●`, `■`, `►`, `✓` viram item, inclusive dois na mesma linha), e `cvSections()`, que expõe resumo, experiência e formação para a fase 2 do perfil público (#326). Aplicado só na leitura; nenhum documento gravado é reescrito.

### Alterado

- `publicProfile()` filtra, normaliza e filtra de novo o CV (`publicCvText` → `cvTextToMarkdown` → `publicCvText`): as garantias sobre o texto gravado seguem intactas e um título de pretensão inferido leva a seção inteira.
- `MarkdownPreview` normaliza a entrada, mantém a quebra de linha simples como `<br>` e só cria âncora para `http(s)` (`javascript:`, `data:` e `mailto:` viram texto).
- A limpeza de PDF na importação passa a converter `●` (U+25CF) e os demais glifos compartilhados em `- `.

## pt-BR

### Melhorado

- O currículo importado de PDF agora aparece com seções e listas no perfil público e na pré-visualização de `/candidate`, em vez de um bloco único de texto.

## en

### Improved

- A CV imported from PDF now shows with sections and lists on the public profile and in the `/candidate` preview, instead of a single block of text.
