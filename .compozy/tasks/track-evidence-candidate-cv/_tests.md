# Contrato de testes — evidência da trilha e CV (#393)

## Regressão obrigatória

| ID | Cenário | Prova |
|---|---|---|
| IT-393-01 | Candidata não dona salva um CV com um termo que não está no `profile.evidence` padrão; o perfil de matching persistido ainda contém a evidência padrão (herdada). | `trackSupport()` lista o termo em `supported`, não em `gaps`, e devolve `inherited: false`. |
| IT-393-02 | O dono (evidência própria, nunca herdada) salva um CV com um termo que não está em `evidence:` do `profile.yaml`. | `trackSupport()` sustenta os dois: o termo só no `evidence:` e o termo só no CV — o CV soma, não substitui. |
| UT-038b | Perfil próprio (não herdado) com um termo só em `growth:`; a candidata salva um CV cujo texto bruto menciona esse termo. | O termo continua em `gaps`, nunca em `supported`: `growth` não sustenta mesmo quando a fonte é o CV (regra 7). |
| IT-393-03 | Perfil herdado (evidência igual à do padrão) com `growth:` contendo um termo; a candidata salva um CV que cita esse mesmo termo. | `trackSupport()` lista o termo em `supported`: o perfil herdado usa `growth: []`, nunca o `growth` do dono do padrão (#423, achado da revisão). |
| UT-038c | `evidenceSupport()` direto: termo presente em `ownLines` (evidence) **e** em `growth`. | O termo continua em `supported`: `growth` nunca bloqueia `ownLines`, só `cvLines` (#423, achado da revisão). |
| UT-038d | `evidenceSupport()` direto: termo presente só em `cvLines` e em `growth`. | O termo vai para `gaps`: o filtro de `growth` continua valendo para o CV (preserva UT-038/UT-038b no nível de domínio). |

Os testes precisam reprovar em `origin/dev`/na versão com o bug (IT-393-01
contra o perfil padrão ignorando o CV; IT-393-02 e UT-038b contra o CV
substituindo evidência própria e emprestando apoio a termo de `growth`;
IT-393-03/UT-038c contra o `isGrowthOnly` bloqueando `ownLines` e contra o
`growth` do padrão sendo repassado a um perfil herdado — achados da
re-revisão da PR #423).
Depois da correção, passam sem alterar o scorer ou o perfil persistido.

## Regressões preservadas

- `UT-038` continua tratando termo presente apenas em `growth` como lacuna.
- `UT-040` continua ignorando evidência explicitamente marcada como herdada.
- O leitor sem CV continua usando o fallback de `profile.evidence` e o
  marcador de herança existente.

## Validação de entrega

- `pnpm typecheck`.
- `pnpm vitest related --run src/contexts/matching/app/tracks.ts tests/target-tracks.test.ts`.
- `node tests/e2e/run-isolated.mjs` por tocar a tela de trilha.
- `term-search E2E-002` preserva a edição/recusa e confirma que `php`, que só
  está no `evidence:` do dono (não no CV fixture), continua em apoio — a
  evidência própria soma com o CV, não cede lugar a ele.
- QA vivo do cenário `SRCH-track-primary-archive`, com refresh e leitura
  independente; se o ambiente não permitir o rewalk, registrar a limitação na
  PR e no cenário.
