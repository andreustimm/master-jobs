# ADR 0009 — A fila de raspagem é uma tabela, não um broker

**Status:** aceita · 2026-08-19

## Contexto

As descrições de vaga precisam existir offline: para o modal ler sem sair do
app, para o scorer ter texto, e para não avisar o empregador toda vez que a
vaga é aberta. Isso exige um robô que capture e organize milhares de páginas,
com paralelismo e com estado por item — o que é, por definição, uma fila.

O pedido original citava Redis ou RabbitMQ, priorizando *free tier* e
compatibilidade com a Vercel.

## O que foi medido

| Opção | Free tier | Adequação ao caso |
|---|---|---|
| **Upstash Redis** | 256 MB, 500 mil comandos/mês, 10 GB banda | Parceiro do Marketplace da Vercel. Fala **REST**, então funciona em serverless e edge, onde conexão TCP não se sustenta. |
| **Vercel Queues** | Cobrado por operação; ainda **BETA** (jul/2026) | Integração nativa, mas produto novo e sem faixa gratuita clara. |
| **CloudAMQP (RabbitMQ)** | Plano gratuito existe | Exige conexão **TCP persistente** — o modelo errado para funções serverless. Descartado por arquitetura, não por preço. |
| **libSQL/SQLite (atual)** | — | Já é a base do projeto. Zero serviço novo, zero latência de rede, transacional. |

## Decisão

**A fila é uma tabela (`scrape_task`), atrás de uma porta (`QueuePort`).**

O sistema roda local contra um banco que já existe. O volume é de centenas de
páginas por dia, não milhares por segundo. E o `UPDATE ... WHERE status = ?
... RETURNING` do SQLite dá *claim* atômico em uma única instrução — a
propriedade que faz uma fila ser uma fila. Há teste com oito workers disputando
uma tarefa: exatamente um ganha.

Introduzir um broker significaria subir um segundo servidor antes de o
dashboard funcionar, e trocar operação offline por vazão que ninguém precisa.
Isso é custo real pago por benefício hipotético.

**Quando for para a web, o adapter é o Upstash Redis.** É o parceiro nativo da
Vercel, o REST resolve o problema de conexão do serverless, e 500 mil comandos
por mês cobrem com folga o volume projetado (≈150 mil, a 10 comandos por
página).

A porta existe justamente para que isso continue sendo uma decisão e não uma
suposição: trocar o adapter não toca nos workers.

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

**Ruins.** Sem *fan-out* entre máquinas: os workers são do mesmo processo. Não
há prioridade dinâmica além de `fit`. Um `claim` de processo morto só é
recuperado após 15 minutos.

**Aceitas.** Nenhuma dessas importa para um usuário rodando local, e todas
desaparecem no dia em que o adapter Upstash entrar.

## Invariantes

1. **`robots.txt` é obedecido.** Regra herdada da ADR 0001: ausência de
   proibição não é permissão. Página recusada vira `blocked`, que é um desfecho
   correto e não uma falha a reprocessar.
2. **Uma requisição por vez por host.** A concorrência é entre hosts; dentro de
   um host as requisições são serializadas e respeitam `Crawl-delay`.
3. **O texto raspado não sobrescreve o do adapter.** A fonte oficial veio da API
   do empregador; a página é preenchimento de lacuna, nunca substituição.
4. **HTML bruto é guardado.** É o que torna a melhoria do extrator um
   reprocessamento em vez de um novo crawl.
