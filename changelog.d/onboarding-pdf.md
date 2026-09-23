## Técnico

### Adicionado

- "Criar meu perfil" aceita o currículo em PDF (#278). `createProfileAction`
  lê o campo `cvFile` e extrai pelo novo `readCvPdf` (`src/core/pdf.ts`), o
  mesmo caminho que `importPdfAction` passou a usar: teto de 10 MB
  (`CV_PDF_MAX_MB`), tipo decidido pelos bytes (`%PDF-` no primeiro KB) e
  mínimo de texto igual a `CV_MIN`. A extração roda depois da guarda e da
  validação dos campos baratos; PDF junto com texto colado é recusado
  (`cvBoth`); recusas voltam como código traduzível (`pdfNotPdf`,
  `pdfNoText`, `pdfTooLarge`), e o sucesso por PDF devolve `run: "fromPdf"`
  para o aviso pedir a revisão no editor.

### Alterado

- `importPdfAction` recusa arquivo que não começa como PDF antes de chamar o
  extrator, em vez de deixar o `unpdf` estourar.

## pt-BR

### Novidade

- Ao criar o perfil, dá para enviar o currículo em PDF em vez de colar o texto. O texto extraído vira a primeira versão do currículo, e o perfil abre direto no editor para você revisar.

## en

### New

- When you create your profile, you can upload your CV as a PDF instead of pasting the text. The extracted text becomes the first version of your CV, and the profile opens right in the editor for you to review.
