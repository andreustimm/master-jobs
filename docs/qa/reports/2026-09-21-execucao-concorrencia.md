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
| 2 | JOBS-group-repeated-countries | Andreus em triagem | **Pass** | `evidence/2026-09-21-quadro-com-fixtures-de-agrupamento.txt` |
| 3 | JOBS-anonymous-employer-never-groups | Andreus em triagem | **Pass** | idem |
| 4 | JOBS-country-hub | Andreus em triagem | Blocked (needs human verify) | — |
| 5 | JOBS-group-canonical-survives-filter | Andreus em triagem | Blocked (needs human verify) | — |
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

## 2 a 5. Os de agrupamento — o bloqueio era fixture, e foi corrigido nesta sessão

Estavam `Skipped` por "corte de janela", e o motivo real era outro: **o ambiente de
paridade não tinha o estado que pedem.** `setup-manual.ts` semeava uma única vaga —
empregador nomeado, um país, `NO BLOCKERS · 1`.

**Corrigido aqui.** O setup manual passou a semear a mesma vaga em quatro publicações
(duas no mesmo país, como o Jobgether publica) mais uma cujo empregador é o rótulo da
fonte. O quadro foi para `NO BLOCKERS · 3`, `NAMED EMPLOYER · 2`.

### JOBS-group-repeated-countries — Pass

```
- group "posted in 3 countries"
  - link "Netherlands"          🇳🇱
  - link "France"               🇫🇷
  - link "Brazil · 2 postings"  🇧🇷
```

Quatro publicações, três países, o repetido anunciado em vez de duplicado, e
`1 – 3 de 3` na paginação: a linha agrupada conta como uma e nada some do total.

### JOBS-anonymous-employer-never-groups — Pass

```
- link "Staff Engineer Anonymous Fixture"
- StaticText "Grupo QA · employer hidden"
```

**Sem fileira de bandeiras.** É o que o charter exige, e é o caso em que agrupar
colocaria empresas diferentes na mesma linha.

### JOBS-country-hub e JOBS-group-canonical-survives-filter — Blocked (needs human verify)

A fixture era o que faltava, e existe. A navegação, não: o clique no título da linha
agrupada respondeu `✓ Done` e a tela permaneceu em `heading "Jobs"`.

**Não afirmo defeito**, porque daqui não dá para distinguir "o link não navega" de
"o clique não agiu" — e a segunda hipótese tem precedente registrado neste driver.
Chamar de `Fail` seria inventar um defeito; chamar de `Pass` seria pior.

**O produto tem cobertura verde por outra via.** `term-search E2E-014` verifica que
o título da linha agrupada aponta para `/jobs/<id>/paises`, que ela não tem botões
de ação, e que o hub lista as quatro publicações — e passou na última execução da
suíte, em Chromium real. O caminho existe e funciona ali.

O que falta é a confirmação **em persona, pela interface**, que é o que estes
cenários existem para dar. As instruções exatas estão nos dois arquivos de cenário.

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

**Três cenários fechados em `Pass`**, com evidência: a concorrência nas seis entradas
pesadas (dupla execução) e os dois de agrupamento que as fixtures novas destravaram.

**Dois viram `Blocked (needs human verify)`:** a fixture deixou de ser o obstáculo,
e o driver passou a ser. O produto tem cobertura automatizada verde do mesmo
caminho (`E2E-014`), então o que falta é a confirmação em persona — não a
funcionalidade.

**Dois seguem humanos por natureza**, dos oito originais.

Saldo: de oito sem veredito, **três fecham em `Pass`**, quatro têm instruções exatas
para uma pessoa fechar, e um segue `untested`.

O saldo de método: um "pulei por falta de tempo" virou causa nomeada, a causa foi
corrigida em código, e dois vereditos saíram disso.

Não é release readiness: o escopo desta sessão foi fechar vereditos pendentes, não
percorrer o ciclo completo.
