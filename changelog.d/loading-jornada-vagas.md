## Técnico

### Adicionado

- Fronteira de carregamento em `/jobs`: `app/jobs/(lista)/loading.tsx` mostra
  o título real e um esqueleto com `aria-busy` e aviso `role="status"` do
  dicionário (`jobs.loading`). Com ela o roteador pré-carrega a fronteira da
  rota dinâmica, e a troca de tela para Vagas mostra o esboço na hora; a lista
  chega por streaming. A página foi para o grupo `(lista)` para a fronteira não
  envolver `/jobs/<id>`, `/jobs/<id>/paises` e `/jobs/new`: o fallback
  compromete o status em 200, e a vaga inexistente precisa continuar 404.
  `app/loading.tsx` continua ausente. Filtro, ordem e página na mesma tela não
  mostram o esboço: o Next 16 mantém a fronteira pela chave de estado sem a
  query, e a transição suave da #220 segue mostrando a lista anterior.
- `/jobs/<id>` transmite por `<Suspense>` a nota por trilha e o histórico da
  candidatura, depois de autenticação e `notFound()`; cabeçalho, nota principal
  e formulário do funil não esperam mais por essas leituras
  (`jobDetail.loadingSection`).
- E2E `tests/e2e/jobs-loading.mjs`: retém a navegação RSC de `/jobs` para ver
  o esboço pré-carregado na troca de tela, prova que filtro na mesma tela não o
  mostra, que o documento transmite o esboço antes da lista e que o 404 do
  detalhe se mantém.

## pt-BR

### Melhorado

- A tela de Vagas responde na hora ao clique no menu: enquanto a lista carrega,
  aparece o esboço da página no lugar da tela anterior. Mudar um filtro continua
  mostrando a lista atual até a nova chegar. No detalhe de uma vaga, a nota por
  trilha e o histórico da candidatura chegam logo depois do restante, sem
  atrasar a abertura da página.

## en

### Improved

- The Jobs screen now responds to a menu click right away: while the list
  loads, an outline of the page replaces the previous screen. Changing a filter
  still keeps the current list on screen until the new one arrives. On a job's
  detail page, the per-track fit and the application history arrive just after
  the rest, without delaying the page itself.
