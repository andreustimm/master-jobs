## Técnico

### Corrigido

- O E2E isolado não deixa mais cópias `.jho-e2e-*` para trás (#527). Ctrl+C ou `kill` encerravam o runner sem passar pelo `finally`: em 2026-10-12 eram 16 cópias e 11,3 GB, com o disco a 95 %. Cada execução grava o próprio PID em `owner.json`; ao começar, remove as cópias cujo dono morreu e as antigas sem dono (mais de 6 h); SIGINT/SIGTERM param os filhos (build, setup), o servidor, o banco e os contêineres e apagam a cópia, com um `rmSync` no `exit` como última rede. Módulo `tests/e2e/orphans.mjs` e teste `tests/e2e-orphans.test.ts`.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
