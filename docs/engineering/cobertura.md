# Cobertura de testes: o que o piso garante, e o que ele não mede

Estado em 2026-09-21, medido por `pnpm check`:

| Métrica | Alcançado | Piso no CI |
|---|---:|---:|
| Statements | 97,94% | 97% |
| Branches | 95,01% | 94,5% |
| Functions | 98,04% | 97,5% |
| Lines | 98,40% | 98% |

O piso vive em `vitest.config.ts`, e a margem entre ele e o alcançado é estreita
de propósito.

## Por que o piso acompanha a cobertura

Piso muito abaixo do alcançado deixa a cobertura escorrer sem que nada reprove.
`branches` ficou em 90 enquanto o real andava por 92: dois pontos de folga são
dois pontos que podem ser perdidos em silêncio, um arquivo sem teste por vez.
Subir o piso junto é o que fecha essa porta.

A margem existe porque dois números não são estáveis ao decimal. Um arquivo novo
em `src/` muda o denominador antes de o teste chegar, e um `it.skip` deixado numa
investigação reduz o numerador. Meio ponto absorve isso sem absorver a remoção de
uma suíte.

`perFile` continua desligado. Ligado, um arquivo novo de dez linhas sem teste
reprova a suíte inteira, e o caminho de menor resistência passa a ser baixar o
limite.

## O que resta descoberto, e por quê

278 branches. A composição importa mais que o número:

| Classe | Quantidade | O que é |
|---|---:|---|
| Coalescência defensiva (`??`, `?.`) | ~123 | `row?.total ?? 0` sobre consulta que sempre devolve linha |
| Decisão | ~108 | ramo real, espalhado a 2 por arquivo em ~50 arquivos |
| Curto-circuito | ~30 | o segundo termo de um `&&` que o primeiro já garante |
| Cor de terminal | ~17 | `contagem > 0 ? c.green(…) : c.dim(…)` |

Três grupos merecem nome próprio, porque nenhum teste vai alcançá-los:

**A guarda de entrypoint de `src/cli.ts`.** As duas branches de
`if (process.argv[1] && resolve(…) === fileURLToPath(import.meta.url))` são
inalcançáveis pela bancada — e é exatamente isso que a bancada existe para
conseguir. Cobri-las exigiria subprocesso, e a cobertura V8 do Vitest instrumenta
o worker, não os filhos que ele gera: o teste por subprocesso deixaria `cli.ts` em
0% para sempre.

**O `catch` de 23505 em `createTrack` e `updateTrack`.** Um
`pg_advisory_xact_lock` por candidato serializa as transações, então duas criações
simultâneas não colidem no índice: a segunda vê a primeira na própria validação.
O `catch` é cinto de segunda ordem, para o dia em que o lock sair. `tests/cov-tracks-corridas.test.ts`
documenta a medição.

**Ramos que o schema Zod torna impossíveis.** `annualiseRange` só devolve `null`
para período não anualizável, e `ranges[].period` é `year | month | week | day |
hour` — todos anualizáveis. O `: 0` de `span > 0` em `gradeAgainst` exige
`floor === target` **e** `floor <= value < target`, conjunto vazio. Cobri-los
exigiria construir um perfil que a validação recusa, e um teste sobre entrada
impossível não afirma nada sobre o sistema.

## O que a cobertura não mede, e é o que importa

Cem por cento de linhas executadas com zero asserções úteis é cem por cento.
Duas armadilhas encontradas nesta base valem mais que o número:

**Guarda cuja cobertura é uma lista escrita à mão mede o que alguém lembrou de
escrever.** As quatro verificações transversais de `tests/e2e/` são arrays
literais de caminhos. `/jobs/<id>/paises` subiu na 1.19.0 e ficou duas releases
fora de todas; acrescentá-la achou dois defeitos de `data-user-content` na
primeira execução, um deles num popover presente em toda tela com lista. Detalhe
em `docs/qa/README.md`.

**Teste que não pode falhar é pior que teste ausente**, porque ocupa o lugar. Dois
casos foram consertados na rodada de 2026-09-21:

- `tests/e2e/ui.mjs` esperava o editor de CV mudar comparando o `textContent`
  atual com uma leitura feita por `innerText`. O CodeMirror põe cada linha numa
  div, então `innerText` insere `\n` e `textContent` não: as duas leituras do
  MESMO documento já diferiam, e a espera era satisfeita antes de qualquer tecla.
  E2E-001 media a fila de repontuação de um currículo que ninguém editou.
- `tests/architecture.test.ts` apagava imports de tipo com
  `/\b(?:import|export)\s+type\b[\s\S]*?from\s*["']…["']/`, e `[\s\S]*?` atravessa
  linhas. Um `export type Props = { … }` casava `export type` e corria até o
  próximo `from "…"` abaixo, apagando tudo entre os dois — imports de valor
  incluídos. UT-080 parou de ver o alcance cliente→servidor que existe para
  proibir, e apagava em vez de reportar, então o sintoma era silêncio.

A pergunta a fazer sobre um teste verde não é "quantas linhas ele executa", mas
**o que aconteceria se o comportamento quebrasse**. Vários casos desta base foram
confirmados contra o código quebrado antes de serem aceitos.

## Como medir

```bash
pnpm check                    # gate completo, com o piso
pnpm vitest run --coverage --coverage.reporter=json   # gera coverage-final.json
```

O `json-summary` traz os totais; o `json` traz `branchMap` e `b` por arquivo, que
é o que permite listar QUAL branch falta, e não só quantas. A configuração padrão
gera apenas o resumo — pedir o `json` é passo explícito.
