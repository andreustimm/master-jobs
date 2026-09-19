# Fixtures de busca por termo

Recortes de respostas reais das APIs públicas, capturadas em 2026-09-19 com o
User-Agent do projeto, uma chamada por endpoint. Servem aos testes dos
adapters e da captura por termo; a rede é trocada só na porta HTTP.

| Arquivo | Pedido | Recorte |
|---|---|---|
| `remotive-laravel.json` | `GET https://remotive.com/api/remote-jobs?search=Laravel&limit=100` | 3 das 16 vagas: duas da Lemon.io que citam Laravel (descrição e tags) e uma da A.Team que a busca devolveu sem citar |
| `remoteok-tech-lead.json` | `GET https://remoteok.com/api?tag=tech-lead` | aviso legal (encurtado) e as 3 vagas; descrição cortada em 1.200 caracteres |
| `himalayas-laravel-page1.json` | `GET https://himalayas.app/jobs/api/search?q=laravel` | 20 vagas; descrição cortada em 600 caracteres |
| `himalayas-laravel-page2.json` | `GET https://himalayas.app/jobs/api/search?q=laravel&page=2` | 20 vagas, nenhuma repetida da página 1 |

O que os probes mostraram e o código segue:

- A busca da Remotive devolve vaga que não cita o termo (6 de 16 citavam
  "Laravel"). A atribuição decide pelo texto e pelas tags, não pela busca.
- O primeiro item do RemoteOK é o aviso legal. O parâmetro `tag` não é
  documentado, e respondeu com vagas da tag.
- A busca da Himalayas respeita `q` (o feed não) e pagina por `page`, a partir
  de 1. `offset=20` foi ignorado e devolveu a página 1 de novo. O aviso de
  paginação por cursor da resposta vale para o feed; a busca não traz
  `nextCursor`. Página pode vir incompleta no meio (19 na página 3 de 296):
  só página vazia ou o total encerram a busca.

Logos e URLs de logo foram removidos. Nenhum arquivo tem telefone ou e-mail
pessoal (`jho security check`).
