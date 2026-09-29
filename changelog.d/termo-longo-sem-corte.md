## Técnico

### Corrigido

- O campo de termo em `/searches` deixa o domínio receber entradas acima de 60 caracteres, para que a validação `term_too_long` recuse o valor completo sem criar um termo truncado. A regressão cobre o contrato do campo e a jornada E2E após recarregar.

## pt-BR

### Corrigido

- Colar um termo longo em Buscas agora mostra o aviso de limite e não salva uma versão cortada.

## en

### Fixed

- Pasting a long term in Searches now shows the length warning and does not save a truncated version.
