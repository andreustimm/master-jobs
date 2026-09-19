/**
 * A suíte roda como diagnóstico local — e declara isso.
 *
 * A política de ingestão nega por omissão: sem ambiente declarado, o contexto
 * normaliza para `preview` e todo entrypoint de ingestão é bloqueado. Isso é o
 * comportamento desejado em dev, staging e preview, e é também o que a suíte
 * precisa dizer explicitamente sobre si mesma, porque ela exercita esses
 * caminhos de propósito, com fetch espionado e sem rede real.
 *
 * Declarar aqui, uma vez, é melhor que espalhar `process.env` por dezenas de
 * arquivos: o teste que QUER ver o bloqueio sobrescreve o ambiente no próprio
 * `beforeEach` — e é justamente o que `ingestion-guard-entrypoints` faz.
 */
process.env.JHO_ENV ??= "local";
process.env.JHO_INGESTION_OPT_IN ??= "true";
