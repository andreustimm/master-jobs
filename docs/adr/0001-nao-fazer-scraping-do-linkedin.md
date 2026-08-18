# ADR 0001 — Não fazer scraping do LinkedIn

**Status:** Aceita · 2026-08-18
**Decisores:** Andreus Timm

## Contexto

O pedido original mencionava "conexão com a API do LinkedIn ou via MCP" para
que um agente executasse tarefas de posicionamento e buscasse vagas.

A investigação da superfície real disponível em agosto de 2026 mostrou três
camadas distintas, frequentemente confundidas entre si:

1. **Publicação — existe oficialmente.** O produto self-serve
   *Share on LinkedIn* concede o escopo `w_member_social` sem fila de
   aprovação de parceiro, e permite publicar no próprio perfil via API.
   Postagem em página de organização (`w_organization_social`) é que exige
   revisão.
2. **Busca de vagas — não existe para pessoa física.** A API de Jobs vive
   dentro do LinkedIn Talent Solutions, restrita a parceiros enterprise.
   Não há endpoint público de busca de vagas.
3. **Comentários, conexões, perfis — não existem oficialmente.** Todo
   "LinkedIn MCP" da comunidade que retorna esses dados o faz dirigindo o
   cookie de sessão `li_at` do próprio membro ou um Chromium headless
   logado, porque esses endpoints só existem dentro da aplicação web
   autenticada.

A camada 3 é justamente a que entrega os dados mais ricos — e a que viola a
seção 8.2 do LinkedIn User Agreement, que proíbe software que faça scraping
ou automatize atividade na plataforma.

O agravante decisivo: segundo a própria auditoria de posicionamento
(`Relatorio-Posicionamento-Andreus-Timm-2026-07-27.md`), a conta do LinkedIn
é o **principal ativo de posicionamento profissional** do usuário — SSI 59/100,
top 2% do setor, 2.717 seguidores, 97 visualizações de recrutadores/ano.
Perder essa conta não seria um contratempo técnico; inviabilizaria o objetivo
que motivou o projeto.

## Decisão

Adotar o caminho **oficial + assistido**, em três faixas:

| Capacidade | Como é feito | Risco |
|---|---|---|
| Publicar posts | API oficial, escopo `w_member_social` | Nenhum |
| Comentar, conectar, seguir | **Assistido** — o agente redige e enfileira em `engagement`; o humano abre a URL e age | Nenhum |
| Buscar vagas | **Não vem do LinkedIn** — vem de APIs públicas de ATS e agregadores (ADR 0003) | Nenhum |

Nenhum código deste repositório lê `li_at`, dirige sessão autenticada, ou
usa MCP não oficial do LinkedIn.

## Consequências

**Positivas**

- A conta fica fora de risco de banimento permanentemente.
- A busca de vagas ficou melhor, não pior: APIs de ATS entregam JSON
  estruturado, com faixa salarial e descrição completa — dados que o
  scraping do LinkedIn não dá de forma confiável.
- O sistema é auditável e explicável, sem depender de cookie que expira.

**Negativas**

- Comentários e conexões exigem ação humana. A fila `engagement` reduz o
  atrito (rascunho pronto + link), mas não elimina o clique.
- Não há métricas automáticas de SSI ou de impressões. Elas entram à mão
  em `metric_snapshot`.
- Vagas publicadas exclusivamente no LinkedIn e em nenhum ATS não são
  capturadas.

## Alternativas consideradas

**Automação total via `li_at` / MCP não oficial.** Rejeitada. Foi apresentada
explicitamente ao usuário com o risco declarado, e recusada. Dados mais ricos
não compensam a probabilidade de perder o ativo central.

**Leitura via browser automation na sessão do próprio usuário.** Considerada e
não adotada nesta fase. É zona cinzenta — ainda é automação de navegador, mas
em volume humano e sem extrair cookie. Fica disponível como escalonamento
consciente, nunca como padrão.

> **Invariante:** reverter esta decisão exige decisão explícita do usuário,
> registrada numa nova ADR que substitua esta. Nenhum agente deve introduzir
> scraping de LinkedIn por conta própria, nem "só para testar".
