## Técnico

### Corrigido

- O callback de login usa `Location` relativo nos redirects 303, preservando a origem da requisição e evitando a normalização de loopback pelo Next.js.

## pt-BR

### Corrigido

- Corrigido o retorno de links de login inválidos para manter o endereço local e o idioma escolhido.

## en

### Fixed

- Invalid login links now return to the canonical local address while preserving the selected language.
