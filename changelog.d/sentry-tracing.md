## Técnico

### Adicionado

- Tracing do servidor no Sentry (#219), amostrado por `SENTRY_TRACES_SAMPLE_RATE`
  (padrão 10%; `0` ou valor ilegível desliga). Cada estágio já medido das telas
  (`auth`, `prelude`, `board`, `facets`, `tail`, `cockpit`…) vira um span
  `jho.etapa` dentro de um `jho.leitura` por rota (`criarCronometro`,
  `rastrearEtapa`). A peneira é pura e testada em `src/core/observability.ts`:
  `scrubTransaction`/`scrubSpan` (`beforeSendTransaction`/`beforeSendSpan`)
  tiram query string do nome e dos spans, reduzem SQL ao verbo e só deixam sair
  atributos de uma lista de permissão (`ALLOWED_SPAN_DATA`) — `http.target`,
  `url.full`, `url.query`, `client.address`, `db.query.text` e
  `server.address` não saem. `tracePropagationTargets: []` impede o
  `baggage` de ir para os boards, e um `tracesSampler` fixo impede o cabeçalho
  `sentry-trace` de um cliente forçar a amostragem acima da taxa (ou furar o
  `0`). Falha do SDK ao abrir ou encerrar o span nunca derruba a tela. As
  migalhas de erro também perdem a query.
- Mapas de origem do servidor publicados no Sentry no build (#212), pelo gancho
  `compiler.runAfterProductionCompile` e `@sentry/cli` (`sourcemaps inject` +
  `upload` em `.next/server`, release = SHA). Sem `SENTRY_AUTH_TOKEN` nada
  muda — nem `.map` é gerado — e o log de build diz por quê; falha de envio
  não derruba o build. Sem `withSentryConfig`, sem mapa de cliente.

## pt-BR

### Melhorado

- O sistema passa a medir quanto tempo cada tela leva, numa amostra das visitas, para achar lentidão antes que ela vire problema. O que você procura, seus filtros, seu currículo e seus dados de contato não fazem parte dessa medida.

## en

### Improved

- The system now measures how long each screen takes on a sample of visits, to catch slowness before it becomes a problem. What you search for, your filters, your résumé and your contact details are not part of that measurement.
