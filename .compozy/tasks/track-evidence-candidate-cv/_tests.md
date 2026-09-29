# Contrato de testes — evidência da trilha e CV (#393)

## Regressão obrigatória

| ID | Cenário | Prova |
|---|---|---|
| IT-393-01 | Candidata não dona salva um CV com um termo que não está no `profile.evidence` padrão; o perfil de matching persistido ainda contém a evidência padrão. | `trackSupport()` lista o termo em `supported`, não em `gaps`, e devolve `inherited: false`. |

O teste precisa reprovar em `origin/dev`: isso demonstra que o painel lia o
perfil padrão e não o CV corrente. Depois da correção, ele passa sem alterar o
scorer ou o perfil persistido.

## Regressões preservadas

- `UT-038` continua tratando termo presente apenas em `growth` como lacuna.
- `UT-040` continua ignorando evidência explicitamente marcada como herdada.
- O leitor sem CV continua usando o fallback de `profile.evidence` e o
  marcador de herança existente.

## Validação de entrega

- `pnpm typecheck`.
- `pnpm vitest related --run src/contexts/matching/app/tracks.ts tests/target-tracks.test.ts`.
- `node tests/e2e/run-isolated.mjs` por tocar a tela de trilha.
- QA vivo do cenário `SRCH-track-primary-archive`, com refresh e leitura
  independente; se o ambiente não permitir o rewalk, registrar a limitação na
  PR e no cenário.
