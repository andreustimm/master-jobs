---
name: linkedin-positioning
description: Executa o plano de posicionamento no LinkedIn derivado da auditoria de julho/2026 — rascunhos de post por pilar de conteúdo, fila assistida de comentários e conexões, contas-alvo e métricas do funil. Use para trabalhar autoridade, conteúdo ou rede no LinkedIn. NÃO use para buscar vagas (use job-triage) — e leia docs/linkedin-policy.md antes de qualquer automação.
---

# Posicionamento no LinkedIn

> **Invariante:** este projeto **não faz scraping do LinkedIn**. Publicação
> usa a API oficial (`w_member_social`). Comentários, conexões e busca são
> **assistidos**: o agente redige e enfileira, o humano abre e age. Dirigir
> o cookie `li_at` viola a seção 8.2 do User Agreement e arrisca a conta que
> é o principal ativo de posicionamento do usuário. Ver `docs/linkedin-policy.md`
> e `docs/adr/0001-nao-fazer-scraping-do-linkedin.md`.

## Diagnóstico de partida

Baseline da auditoria de 2026-07-27 (`../Relatorio-Posicionamento-Andreus-Timm-2026-07-27.md`):

| Pilar do SSI | Nota | Leitura |
|---|---:|---|
| Marca profissional | 15,28/25 | Acima da média, headline diluída |
| Localizar pessoas certas | 10,24/25 | Descoberta vem da rede, não de busca intencional |
| **Interagir com insights** | **8,10/25** | **Pilar mais fraco — a alavanca** |
| Criar relacionamentos | 25/25 | Máximo; não há ganho em aumentar volume |

SSI total 59/100. O gargalo é **autoridade visível**, não rede.

## Pilares de conteúdo

Cada post deve mapear para um pilar (`post.pillar`) e ter evidência real:

| Pilar | Tese | Evidência |
|---|---|---|
| `production-ai` | O trabalho começa depois do protótipo | Zorbit, Contas Casal, Hackett |
| `agentic` | Agentes precisam de isolamento e auditabilidade antes de mais agentes | Zorbit, SDD |
| `saas-arch` | Multi-tenancy exige decisão explícita | Mahout, MPC |
| `modernization` | Legado evolui sem big-bang rewrite | Regal, Quilt |
| `data-rag` | Qualidade de retrieval é pipeline, não modelo | Hackett |
| `leadership` | Staff+ entrega qualidade de decisão | 10+ times, 11 países |

## Cadência sustentável

- 1 post original por semana, terça a quinta, em inglês.
- 2 comentários substantivos por dia útil, nas 30 contas-alvo.
- 1 documento/carrossel por mês.
- 1 case study por mês nos primeiros três meses.
- 1 post curto em português a cada duas semanas.

Comentário substantivo acrescenta arquitetura, trade-off, risco ou exemplo.
"Great post" não conta e dilui.

## Fila assistida

A tabela `engagement` guarda o trabalho preparado:

| Campo | Uso |
|---|---|
| `kind` | `comment` · `connect` · `follow` · `message` |
| `targetUrl` | O que abrir |
| `rationale` | Por que este alvo importa — evita spray-and-pray |
| `draft` | O texto redigido pelo agente |
| `status` | `queued` → `done` / `skipped` |

O agente preenche. O humano abre a URL, adapta se quiser, publica, e marca
como feito. **Nada nessa tabela é executado automaticamente.**

## Contas-alvo

`target_account` guarda as 30 contas da auditoria §2.2: 10 recrutadores,
10 líderes de AI/platform, 10 pares Staff/Principal. Categorias: `recruiter`,
`ai-leader`, `peer`, `company`.

## Métricas

Entram à mão em `metric_snapshot`, porque não há API para elas. Baseline de
julho/2026 a registrar: SSI 59, 72 ocorrências em busca, 1.362 exibições,
5,3% das exibições vindas de pesquisa, 97 visualizações por recrutadores/ano.

O que acompanhar: ocorrências em busca por semana · proporção de exibições
vindas de pesquisa · contatos de recrutadores relevantes · taxa de resposta
por cluster · conversas qualificadas por post.

## Plano de ação

A auditoria §14 traz o plano completo em cinco horizontes (24h, semana, 30d,
60d, 90d), com prioridade e esforço por item. A tabela `positioning_task`
existe para materializá-lo como linhas executáveis.

As cinco mudanças de maior impacto (§16) começam por corrigir o **Open to
Work** — hoje configurado para JavaScript/Python/Backend/Full Stack Developer,
o que direciona o algoritmo para vagas abaixo do alvo. É o maior vazamento
identificado e leva 15 minutos.

## Publicação via API oficial

Requer app no LinkedIn Developer Portal com os produtos *Sign In with LinkedIn
using OpenID Connect* e *Share on LinkedIn* habilitados — ambos self-serve.
Variáveis em `.env.example`: `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`,
`LINKEDIN_REDIRECT_URI`.

Estado: **não implementado ainda**. Ver `docs/roadmap.md`, fase 3.
