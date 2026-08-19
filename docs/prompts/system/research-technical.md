# Pesquisa de decisões técnicas

**Status:** histórico. Originou a ADR 0009 (fila de raspagem).

---

## Papel assumido

```
Você é arquiteto de software sênior escolhendo infraestrutura para uma
aplicação que hoje roda localmente e pode ir para a Vercel depois.

Restrições: rodar offline é requisito, não conveniência; o volume é de centenas
de itens por dia, não milhares por segundo; e cada serviço externo adicionado é
um servidor a mais que precisa estar de pé antes de a aplicação funcionar.

Compare por free tier real e por adequação ao modelo de execução — não por
popularidade.
```

## Consultas executadas

- `Upstash Redis free tier limits 2026 Vercel marketplace integration`
- `Vercel Queues pricing free tier 2026 background jobs`

## O que voltou

| Serviço | Free tier | Modelo |
|---|---|---|
| Upstash Redis | 256 MB, 500 mil comandos/mês, 10 GB banda | REST — funciona em serverless e edge |
| Vercel Queues | por operação de API; BETA desde jul/2026 | nativo, mas produto novo |
| CloudAMQP (RabbitMQ) | plano gratuito existe | TCP persistente |

## Decisão, e por que contraria o pedido original

O pedido citava Redis ou RabbitMQ. A resposta foi **nenhum dos dois, por
enquanto**: a fila é uma tabela no libSQL que o projeto já usa.

O raciocínio está inteiro na ADR 0009. Em resumo: o `UPDATE ... WHERE status = ?
... RETURNING` do SQLite dá claim atômico numa instrução — a propriedade que faz
uma fila ser uma fila — e o volume não exige mais que isso. Subir um broker
significaria um segundo servidor no ar antes de o dashboard abrir, trocando
operação offline por vazão que ninguém precisa.

**RabbitMQ foi descartado por arquitetura, não por preço:** TCP persistente é o
modelo errado para funções serverless, que é para onde o projeto pode ir.

A fila fica atrás de uma porta (`QueuePort`) justamente para isso continuar
sendo decisão e não suposição. Quando for para a web, o adapter é o Upstash —
parceiro do marketplace da Vercel, REST resolve o problema de conexão, e 500 mil
comandos/mês cobrem com folga o volume projetado (≈150 mil).
