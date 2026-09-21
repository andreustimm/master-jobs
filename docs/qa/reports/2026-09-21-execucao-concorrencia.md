# Execução de QA — 2026-09-21 — concorrência nas telas pesadas

Escopo: fechar os cenários que a sessão anterior deixou sem veredito. Um fechou,
quatro têm agora o motivo real do bloqueio, e dois seguem humanos por natureza.

## Ambiente

Paridade de produção pelo `run-isolated.mjs --manual`: build standalone real,
PostgreSQL isolado, `JHO_AUTH_MODE=secure`, autenticação por senha com conta de
fixture (`alex@local.test`, papéis `admin`+`candidate`). Nenhum mock, nenhum
endpoint interno, nenhum devtool substituindo interação ou verificação.

Como subir, porque não estava escrito em lugar nenhum:

```bash
sleep 5400 | node tests/e2e/run-isolated.mjs --manual
```

O modo manual espera Enter em `process.stdin`; o pipe mantém o stdin aberto sem
escrever nada. `nohup … &` é negado pelo harness; o pipe não é.

## Matriz

| # | Cenário | Persona | Status | Evidência |
|---|---|---|---|---|
| 1 | JOBS-concurrent-heavy-screens | Andreus em triagem | **Pass** | `evidence/2026-09-21-concurrent-heavy-screens.txt` |
| 2 | JOBS-group-repeated-countries | Andreus em triagem | **Blocked** — fixture ausente | — |
| 3 | JOBS-country-hub | Andreus em triagem | **Blocked** — fixture ausente | — |
| 4 | JOBS-group-canonical-survives-filter | Andreus em triagem | **Blocked** — fixture ausente | — |
| 5 | JOBS-anonymous-employer-never-groups | Andreus em triagem | **Blocked** — fixture ausente | — |
| 6 | JOBS-filter-fields-follow-url | Andreus em triagem | Blocked (needs human verify) | — |
| 7 | JOBS-source-multi-select | Andreus em triagem | Blocked (needs human verify) | — |

## 1. JOBS-concurrent-heavy-screens — Pass

Duas requisições disparadas juntas em cada uma das **seis** entradas que o cenário
lista, com o cookie de sessão real, pela interface HTTP pública. Depois, uma
terceira sozinha, para ter o tempo de referência.

| Rota | A | B | Pior par | Sozinha |
|---|---|---|---|---|
| `/` | 200 | 200 | 0,10 s | 0,04 s |
| `/jobs` | 200 | 200 | 0,05 s | 0,03 s |
| `/jobs?pay=6000&payMax=30000&cur=USD&per=month` | 200 | 200 | 0,07 s | 0,04 s |
| `/searches` | 200 | 200 | 0,07 s | 0,03 s |
| `/candidate/skills` | 200 | 200 | 0,05 s | 0,02 s |
| `/searches/tracks/new?term=Laravel` | 200 | 200 | 0,13 s | 0,05 s |

Nenhuma esperou a outra: a pior das concorrentes ficou muito abaixo de duas vezes
o tempo de uma sozinha, que é como a serialização por pool apareceria. **Duas
execuções completas**, com o mesmo resultado.

### O que este Pass NÃO afirma

Os tempos absolutos não são comparáveis a produção: o acervo local tem **uma**
vaga e o de produção passa de seis mil. O que se verifica aqui é a **ausência de
serialização**, e essa é legítima — o esgotamento do pool depende do número de
conexões que cada requisição pede, não do volume de dados que elas leem. Uma tela
que pedisse três conexões faria a segunda requisição esperar mesmo com um registro
no banco.

O gate que mede o teto por requisição continua sendo `tests/db-fan-out.test.ts`.
Este cenário é a confirmação pela interface, não o substituto dela.

## 2 a 5. Os quatro de agrupamento — Blocked por ausência de fixture

Antes ficaram `Skipped` por corte de janela. O motivo real é outro, e é mais útil:
**o ambiente de paridade não tem o estado que eles pedem.**

`tests/e2e/setup-manual.ts` semeia uma única vaga — "Senior Software Architect",
Aurora Sistemas, `Remoto · Brasil`, empregador nomeado, um país. O quadro
confirma: `NO BLOCKERS · 1`, `NAMED EMPLOYER · 1`, `RECENT · 1`.

Os quatro cenários precisam de vaga publicada em vários países, e um deles de vaga
cujo empregador seja o nome da fonte. Nenhuma existe ali. Não há o que percorrer:
o veredito não é "passou" nem "falhou" — é que o ambiente não oferece o estado.

O `setup.mjs` do E2E automatizado **tem** essas fixtures (`904000101`, com quatro
publicações, exercitado por `E2E-014`). Desbloquear é levá-las para o
`setup-manual.ts`, e isso é mudança de código, não de execução de QA.

## 6 e 7 — seguem humanos

Campo de filtro depois de navegação suave. Instruções em *Human Verifications
Needed* do relatório de `2026-09-21-docs-qa-jornada-do-quadro-filtrado.md`.

## Paper cuts

| Persona | Onde | Sentiu | Agudez | Desfecho |
|---|---|---|---|---|
| Andreus em triagem | primeiro acesso, antes do login | "a interface abriu em inglês; o seletor está no topo e resolve" | dull | reconfirmado — já registrado na sessão anterior, e o seletor funciona |

## Sobre o driver, que foi o que travou a sessão anterior

O `agent-browser` **clica de verdade**: sanidade em `example.com` navegou para a
IANA, confirmado por `snapshot` e não pelo `✓ Done`. A nota antiga — "responde
Done sem agir" — não se confirmou.

O problema real é **persistência**: o cookie de sessão não sobrevive entre
invocações de processo. Um `open` depois do login devolve `(empty page)` e
`cookies get` vazio.

**A saída que funcionou:** encadear todos os passos numa única invocação de shell
com `&&`. Nessa forma o login se mantém, o quadro renderiza (178 linhas de árvore
de acessibilidade) e o cookie pode ser lido para uso HTTP. Está registrado aqui
porque é o que permite a próxima sessão começar andando.

## Final Status

**Um cenário fechado em `Pass`, com evidência e dupla execução.** Quatro saíram de
`Skipped` para `Blocked` com a causa nomeada e o caminho de desbloqueio escrito —
o que é mais acionável que um "pulei por falta de tempo". Dois seguem humanos.

Não é release readiness: o escopo desta sessão foi fechar vereditos pendentes, não
percorrer o ciclo completo.
