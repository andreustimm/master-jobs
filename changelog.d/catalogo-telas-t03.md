## Técnico

### Adicionado

- Telas de administração do catálogo (#223, tarefa 03): `/admin/plataformas`
  (lista, cadastro), `/admin/plataformas/[id]` (capacidades, sondar sem
  gravar, habilitar/desabilitar, aposentar com confirmação, "Buscar agora" e
  "Atualizar status"), `/admin/execucoes` (paginada, "Buscar em todas",
  "Atualizar status de todas") e `/admin/execucoes/[id]` (estado, contagens
  com "desconhecido" em vez de zero, motivo, filhas por fonte, "Tentar de
  novo"). Todas com `requirePage("admin:access")` e as actions com
  `guard("admin:access")` antes de qualquer efeito; sessão emprestada nega.
- `listRuns` aceita `sourceId` para o histórico de uma fonte. A captura por
  termo continua só como agregado em `/admin/captures`.

## pt-BR

### Novidades

- Administradores ganharam as telas Plataformas e Execuções: cadastrar um board, sondá-lo antes de habilitar, pedir a busca de uma fonte ou de todas e acompanhar cada execução, com as contagens por fonte e a opção de tentar de novo só o que falhou.

## en

### New

- Administrators have new Platforms and Runs screens: register a board, probe it before enabling, request a fetch for one source or all of them, and follow each run with per-source counts and the option to retry only what failed.
