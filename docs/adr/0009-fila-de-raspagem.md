# ADR 0009 — A fila de trabalho é uma tabela PostgreSQL, não um broker

**Status:** aceita; revisão do transporte para PostgreSQL/Supabase · 2026-09-16

## Contexto

As descrições de vaga precisam existir offline: para o modal ler sem sair do
app, para o scorer ter texto, e para não avisar o empregador toda vez que a
vaga é aberta. Isso exige um robô que capture e organize milhares de páginas,
com paralelismo e com estado por item — o que é, por definição, uma fila.

O pedido original citava Redis ou RabbitMQ, priorizando *free tier* e
compatibilidade com a Vercel. Desde o corte do runtime para PostgreSQL, as filas
`scrape_task`, `verify_task` e `score_task` vivem no schema `production`.

## O que foi medido

| Opção | Free tier | Adequação ao caso |
|---|---|---|
| **Tabelas PostgreSQL (atual)** | Incluídas no banco já pago/limitado pelo plano | Transacionais, duráveis, inspecionáveis por SQL e compatíveis com `FOR UPDATE SKIP LOCKED`; uma dependência a menos. |
| **Supabase Queues/PGMQ** | Recurso nativo do Postgres/Supabase; confirmar quota no plano antes de ativar | Melhor candidato para fan-out futuro: entrega durável e mesma região/credencial do banco. Exige um adapter e não resolve prioridade sozinho. [`docs`](https://supabase.com/docs/guides/queues) |
| **Upstash Redis** | 256 MB, 500 mil comandos/mês e 10 GB de banda no plano Free | REST funciona em serverless/edge, mas adiciona outro estado, segredo e quota. [`pricing`](https://upstash.com/pricing/redis) |
| **Upstash QStash** | 1.000 mensagens/dia no Free; payload até 1 MB | Bom para disparar callbacks HTTP, não para ser o crawler principal. [`pricing`](https://upstash.com/pricing/qstash) |
| **Vercel Queues** | Beta, retenção documentada de até 24 h | Avaliar quando houver necessidade de integração nativa; não é a base atual. [`docs`](https://vercel.com/docs/queues) |
| **CloudAMQP (RabbitMQ)** | Plano gratuito existe | TCP persistente, operação separada e pouca vantagem para o volume atual. [`plans`](https://www.cloudamqp.com/plans.html) |

## Decisão

**A fila é uma tabela PostgreSQL (`scrape_task`, `verify_task`, `score_task`),
atrás de uma porta (`QueuePort`).**

O sistema roda local e em produção contra um banco que já existe. O volume é de
centenas de páginas por dia, não milhares por segundo. O worker faz *claim*
atômico com `FOR UPDATE SKIP LOCKED` dentro de uma transação; há teste com oito
workers disputando uma tarefa e exatamente um ganha.

Introduzir um broker significaria subir um segundo servidor antes de o
dashboard funcionar, e trocar operação offline por vazão que ninguém precisa.
Isso é custo real pago por benefício hipotético.

**Quando o volume exigir múltiplos hosts, o primeiro candidato é Supabase
Queues/PGMQ**, porque mantém entrega durável e governança no mesmo PostgreSQL.
Upstash Redis/QStash só entra se a necessidade for fan-out serverless ou
callbacks HTTP com teto de execução. RabbitMQ continua fora do plano por
operação e conectividade. A porta existe para que trocar o adapter não toque
nos workers.

## O pipeline tem duas etapas, de propósito

`pending → fetching → fetched → parsing → done`, com `failed` e `blocked`.

Captura e tratamento são separados porque **falham por razões diferentes e
custam valores diferentes**. Capturar é lento, tem limite de taxa e pode ser
recusado pelo site. Tratar é gratuito, offline, e melhora toda vez que o
extrator fica mais esperto.

A consequência é concreta e já foi exercitada: ao apertar o extrator, as 10
páginas foram reprocessadas **sem baixar um byte**, e o campo extraído caiu de
8.005 para 3.044 caracteres. Com uma etapa só, isso teria sido um novo crawl.

## Consequências

**Boas.** Zero dependência nova. Funciona offline. A fila é inspecionável com
SQL. Reprocessar é barato. `retry` e `reparse` são comandos triviais.

**Ruins.** Sem *fan-out* entre máquinas: os workers atuais são do mesmo
processo. Não há prioridade dinâmica além de `fit`. Um `claim` de processo
morto só é recuperado após 15 minutos.

**Aceitas.** Nenhuma dessas importa para o volume atual. A migração para um
adapter gerenciado só deve acontecer com métrica de backlog, taxa de retry e
necessidade real de mais de um worker.

## Invariantes

1. **`robots.txt` é obedecido.** Regra herdada da ADR 0001: ausência de
   proibição não é permissão. Página recusada vira `blocked`, que é um desfecho
   correto e não uma falha a reprocessar.
2. **Uma requisição por vez por host.** A concorrência é entre hosts; dentro de
   um host as requisições são serializadas e respeitam `Crawl-delay`.
3. **O texto raspado não sobrescreve o do adapter.** A fonte oficial veio da API
   do empregador; a página é preenchimento de lacuna, nunca substituição.
4. **Substituído pela ADR 0019.** HTML bruto é temporário: fica retido quando a
   extração falha e é descartado quando texto e metadados úteis são gravados.
