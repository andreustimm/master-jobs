## Técnico

### Corrigido

- Runner self-hosted (#367, ADR 0030): `scripts/runner/entrypoint.sh`, PID 1 do contêiner, passa a repassar SIGTERM/SIGINT ao `run.sh` (que roda em segundo plano, direto no usuário `runner` por `setpriv`, sem a camada do `su`), espera o runner sair, para o dockerd interno e termina com 143/130 — nunca com 75. Antes o `docker stop` esperava o timeout e acabava em SIGKILL. O contrato anterior se mantém: status do `run.sh` ≠ 0 propaga, status 0 sem `_diag/Worker_*.log` sai com 75, com o log sai com 0.
- `tests/ci-runner-selection.test.ts` cobre o trap (estático) e o comportamento com um runner de mentira em bash puro, sem root nem docker.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
