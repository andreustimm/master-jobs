# QA Run Report — 2026-10-01T210000Z-fixer — busca-vazia-com-filtros (jornada completa)

- **Scope:** `JOBS-term-filter-descriptions` percorrido por inteiro, em navegador
  real, sobre a correção final da #402 (PR #419): a frase do vazio sai SEMPRE
  do EXISTS (`termExistsInOpenCorpus`), nunca dos filtros presentes na URL.
- **Cadence tier:** targeted
- **Build:** merge de `origin/dev` (1.32.10) sobre a branch `fix/busca-vazia-com-filtros`
  · **Environment:** `node tests/e2e/run-isolated.mjs --manual` (build de produção,
  PostgreSQL descartável, login real por e-mail e senha), driver
  `agent-browser` (um só, sem troca no meio), sessão com `--session-name`.

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Andreus em triagem (conta `alex@local.test`, admin + candidate) | fixture manual isolada (`setup-manual.ts`, acrescida de seis vagas de termo) | desktop 1280px e 375x812 / rede local / en e pt-BR | 1 sessão contínua |

## Flows in Scope

- `J-save-term-search` — buscar um termo em Vagas, entender por que zero vagas
  aparecem e agir (`../journeys/J-save-term-search.md`).

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | CH-relevance-and-availability-catch-up | J-save-term-search / JOBS-term-filter-descriptions | Andreus em triagem | Landmark Tour | Pass | BUG-20260929-search-term-false-negative-laravel | `7f69ab7`; `04e3560`; `882e4877`; esta rodada |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Session Debriefs

### Cenário completo — Andreus em triagem

- **Ran:** 2026-10-01, sessão única do `agent-browser`; cada leitura abre a URL de
  novo (leitura nova, não estado otimista), e os casos de refresh usam `reload`.
- **Steps (e o que o navegador devolveu; `fit=0` onde a nota não importa):**
  1. Palavra inteira: `q=go` achou só "Go Platform Engineer"; `q=google` achou só
     "Cloud Platform Architect" (empresa "Google Cloud Partners"). "go" não traz
     "Google". Detalhe `/jobs/9` relido após `reload`: título "Go Platform
     Engineer", `\bGo\b` presente, "Google" ausente.
  2. Símbolos: `q=c++` achou só "C++ Systems Architect"; `q=node.js` achou só
     "Node.js Backend Architect".
  3. Só pela descrição: `typescript` achou 9 vagas; `observabilidade` achou 4 (as
     que citam a palavra só no texto).
  4. Pedaço de palavra: `type` e `java` zeraram, com a frase de ausência (o termo
     não existe em nenhuma vaga aberta).
  5. Empresa e título: `Aurora` achou a vaga da Aurora Sistemas; `architect` achou
     6 vagas pelo título.
  6. Acento e frase: `gestão` achou 1; `"serviços distribuídos"` achou 8;
     `"distribuídos serviços"` (ordem trocada) zerou.
  7. Localização: `Lisboa` achou a vaga com localização "Lisboa, Portugal".
  8. Termo inválido: `<script>alert(1)</script>` mostrou o aviso
     `jobs-notice-term_invalid_char`, campo vazio e lista sem filtro (10 vagas),
     sem erro.
  9. Poucas vagas: em toda busca de termo simples (de 0 a 9 resultados) a
     oferta de buscar nas plataformas apareceu (`jobs-offer-search`); na busca por
     frase entre aspas e no termo inválido ela não apareceu, como antes desta PR.
  10. O termo sobrevive ao refresh: o campo de busca voltou preenchido em todas as
      leituras novas e após `reload`.
  11. Vazio com recorte (a #402): `typescript&workMode=onsite` e `typescript&fit=100`
      disseram "Nenhuma vaga corresponde a … com os filtros atuais" (en e pt-BR);
      `zzqxunmatched&workMode=onsite`, `zzqxunmatched` e o link do card "vagas
      abertas" do cockpit (`zzqxunmatched&fit=0&status=any&ungrouped=1`) disseram
      "Nenhuma vaga do acervo tem …" — sem mandar remover filtros que não existem
      (Minor 2 da revisão).
  12. Vaga arquivada (caso do status padrão): "Senior Software Architect Quokkaprobe"
      foi achada por `q=quokkaprobe`; o botão "Não me interessa" a arquivou; a busca
      depois de `reload` e de leitura nova disse "Nenhuma vaga corresponde a
      “quokkaprobe” com os filtros atuais" (en e pt-BR, 375px); `status=archived`
      listou a vaga; "Restaurar" a devolveu e `q=quokkaprobe` voltou a achá-la.
  13. Largura: 375x812 (documento de 360px com a barra), `scrollWidth - clientWidth`
      igual a 0 em todas as leituras; `agent-browser errors` sem erro de página.
- **Evidence** (em disco, fora do git; `docs/qa/evidence/2026-10-01T210000Z-fixer-busca-vazia-com-filtros-jornada/`):
  `arquivada-recorte-pt-375-apos-reload.png`, `acervo-inteiro-ausente-pt-375.png`,
  `filtro-modalidade-recorte-pt-375.png`, `detalhe-go-pt-375.png`.
- **True end state:** confirmed — o vazio por termo distingue recorte e ausência
  pelo acervo, nos três tipos de recorte (filtro escolhido, corte padrão de fit,
  status padrão) e no acervo inteiro, e a distinção sobrevive ao refresh.
- **Scenarios settled:** `JOBS-term-filter-descriptions` → Pass.

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-save-term-search | pass | — | pass | — | pass | pass (build de produção, banco isolado) | sessão acima; sem medição de acessibilidade nesta rodada |

## What Was Fixed

### BUG-20260929-search-term-false-negative-laravel: a frase ainda dependia dos filtros da URL

- **Symptom:** com filtro explícito o EXISTS não rodava, e `status=any` contava
  como filtro: o card "vagas abertas" levava a `fit=0&status=any&ungrouped=1`
  (acervo inteiro) e um termo ausente dizia "Remova filtros".
- **Root cause:** a decisão olhava quais filtros a URL trazia
  (`hasFilterBeyondTerm`), não o acervo.
- **Fix:** `loadJobsView` consulta `termExistsInOpenCorpus` sempre que a lista vem
  vazia com termo; `hasFilterBeyondTerm` saiu (código morto).
- **Regression test:** `tests/jobs-board.test.ts` (filtro explícito com termo
  existente, filtro explícito com termo ausente, `status=any&fit=0`, e fora do
  vazio), `tests/e2e/ui/searches.mjs` E2E-023 (vaga arquivada, com reload) e
  E2E-024 (acervo inteiro).
- **Retested:** nesta sessão de jornada (passos 11 e 12) e pela suíte
  automatizada (ver Final Status).

## Paper Cuts

| Persona | Where (journey/step) | Felt | Sharpness | Outcome |
|---|---|---|---|---|
| Andreus em triagem | passo 6, frase exata sem vaga | "a frase de ausência repete as aspas do termo: “\"distribuídos serviços\"”" | dull | registrado, fora do escopo (a #402 não toca a formatação do termo) |

## Runtime Errors Observed

- Nenhum erro de página no `agent-browser errors`.

## Human Verifications Needed

- Nenhuma que bloqueie a #402. Sem telefone físico e sem leitor de tela nesta rodada.

## Decisions for a Human

- Nenhuma.

## Learnings

- `agent-browser click` diz "Done" sem agir quando o elemento está fora da janela:
  chame `scrollintoview` antes (ou o botão de uma vaga abaixo da dobra não recebe o
  clique). Dentro de `batch`, `eval` falhou com "Invalid left-hand side"; o `eval`
  isolado funciona. A sessão sobrevive entre invocações com `--session` e
  `--session-name` juntos.
- A fixture manual não tinha vagas de termo; sem elas o cenário não tinha o que
  percorrer. `tests/e2e/setup-manual.ts` agora as cria.

## Final Status

- **Exit gate:** `pnpm typecheck` e `pnpm vitest run tests/jobs-board.test.ts
  tests/filter-state.test.ts tests/jobs-empty-term.test.ts` (56 verificações)
  verdes; `node tests/e2e/run-isolated.mjs --areas searches`: exit 0, 98/98
  verificações (inclui E2E-020, 022, 023 e 024), sobre `19282c3f`.
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 0 · Trust-Damage 0
  abertos · Friction 0 · Cosmetic 1 (paper cut dull)
- **Coverage:** o cenário inteiro percorrido em navegador: palavra inteira,
  símbolos, descrição, pedaço de palavra, empresa, título, acento, frase,
  localização, termo inválido, oferta de salvar, refresh, recorte e ausência
  (inclusive vaga arquivada) em en, pt-BR e 375px.
- **Verdict:** ready — `Closes #402` passa a ser verdadeiro.
