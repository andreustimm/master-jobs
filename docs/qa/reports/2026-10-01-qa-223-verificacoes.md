# QA Run Report — 2026-10-01 — qa-223-verificacoes

- **Scope:** #223 — as verificações do relatório [2026-09-28-qa-223-catch-up](2026-09-28-qa-223-catch-up.md) que ficaram `Blocked (needs human verify)` e que NÃO exigem a conta real do dono: `JOBS-availability-last-check` (estados `open` e `stale`), `JOBS-structured-analysis` (caminho de sucesso) e `ADMN-source-runs-partial-retry` (execução "todas" genuinamente parcial).
- **Cadence tier:** targeted
- **Build:** f720e9a (origin/dev, v1.32.12) · **Environment:** worktree `docs/qa-223-verificacoes`, `pnpm dev` (Turbopack) em `http://127.0.0.1:3223` com `JHO_ENV=local` e `JHO_AUTH_MODE=secure`; PostgreSQL 17 descartável em Docker (`jho-qa-223-pg`, `127.0.0.1:55423`, banco `jho_test_*`, fixtures de `tests/e2e/setup-manual.ts`, app e CLI com um papel restrito `IN ROLE master_jobs_runtime`). Nunca o `master-jobs-local-supabase-db` compartilhado, nunca produção. Navegador: `agent-browser` 0.26.0 (`--session-name`, login real).
- **Started:** 2026-10-01T22:30Z · **Status:** closed

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Andreus em triagem | Power User | laptop (e 375 px para os estados) / wifi-fast / pt-BR | CH-admin-source-catalog-first-walk (só a perna parcial/retry), CH-relevance-and-availability-catch-up (só a perna de disponibilidade), CH-structured-analysis-first-read |

Contas semeadas pelo fixture (senha local-only versionada em `setup-manual.ts`): `alex@local.test` (admin e candidato, o dono do banco descartável) e `bruno@local.test` (candidato).

## Flows in Scope

- `J-operate-source-catalog` — Cadastrar, sondar e buscar uma fonte sem terminal, e saber o que cada execução capturou. (`../journeys/J-operate-source-catalog.md`)
- `J-trust-the-filtered-board` — Reduzir 6.000 vagas a um punhado decidível, e poder acreditar no recorte. (`../journeys/J-trust-the-filtered-board.md`)
- `J-read-structured-job-analysis` — Decidir sobre uma vaga lendo só o que o anúncio sustenta, com o trecho de cada fato. (`../journeys/J-read-structured-job-analysis.md`)

## Session Matrix & Results

Ordem de execução: a sessão 1 gerou os dados reais (9 vagas da fonte) que a 2 reaproveitou.

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | CH-admin-source-catalog-first-walk | J-operate-source-catalog / ADMN-source-runs-partial-retry | Andreus em triagem | Feature Tour | Pass | [#439](https://github.com/andreustimm/master-jobs/issues/439) (Friction, texto da completude de verificação) | |
| 2 | CH-relevance-and-availability-catch-up | J-trust-the-filtered-board / JOBS-availability-last-check | Andreus em triagem | Feature Tour | Pass | | |
| 3 | CH-structured-analysis-first-read | J-read-structured-job-analysis / JOBS-structured-analysis | Andreus em triagem | Feature Tour | Blocked (needs human verify) | [#438](https://github.com/andreustimm/master-jobs/issues/438) (Trust-Damage, `provider_error` sem causa) | |

Status legend: `Pending | Pass | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Session Debriefs

### CH-admin-source-catalog-first-walk — Andreus em triagem (perna: execução "todas" parcial e retry)

- **Ran:** 2026-10-01T22:40Z → 22:54Z, intercalada com as outras duas (box respeitado: sim, ~15min de 60)
- **Findings:**
  - Cadastro de `lever:epoch-ai` (real, baixo volume, 9 vagas) e `lever:qa-sem-fonte-223` (handle inexistente) pela tela, ambas habilitadas ("Habilitar já"). "Buscar em todas" criou a execução #1 na fila, com o motivo ("sem credencial de disparo… rode-a pela CLI com jho jobs sync --run"); `jho jobs sync --run 1` rodou as duas fontes (2 requisições).
  - `/admin/execucoes/1`: **parcial**, uma linha por fonte; `lever:epoch-ai` concluída (lidas 9, novas 9); `lever:qa-sem-fonte-223` falhou com `GET https://api.lever.co/v0/postings/qa-sem-fonte-223 -> 404` e as cinco contagens "desconhecido", nunca zero; o total do pai, "desconhecido".
  - "Tentar de novo" no detalhe da filha que falhou (#3) criou #4, "Nova tentativa da execução #3"; rodada pela CLI, falhou de novo. #3 e a pai #1 não mudaram (mesmos horários, #1 "parcial") depois do clique e da nova execução.
  - Lista de execuções paginada: com 25 execuções de topo (21 de preenchimento por SQL no banco descartável, ver Parity), "Página 1 de 2" (20 linhas, "Próxima"), "Página 2 de 2" em `?page=2` (5 linhas, "Anterior"), sobrevive a `reload`, as duas páginas e o detalhe cabem em 375 px.
  - Defeito de texto achado ao abrir uma execução de **verificação** (sessão 2): a completude diz "janela parcial: não fecha por ausência", que é o texto da captura.
- **Bugs filed/updated:** BUG-20261001-verify-run-shows-capture-completeness-copy (novo, Friction)
- **Scenarios settled:** ADMN-source-runs-partial-retry → pass
- **Paper cuts:** o formulário "Cadastrar fonte" mantém tipo, handle, rótulo e "Habilitar já" depois de cadastrar (segunda observação do achado de 2026-09-28; dull, em observação — o "Habilitar já" marcado foi aproveitado aqui, mas um segundo clique cadastraria de novo o mesmo par, que a tela recusa com o motivo).
- **Surprises:** "Tentar de novo" na filha vira uma execução de topo (aparece na lista como "uma fonte"), sem o pai; é o comportamento do código para filha de "todas", e a lista não diz de que pedido ela veio além do "Nova tentativa da execução #3" no detalhe.
- **Suggested next charter:** uma execução "todas" com duas ou mais fontes concluindo (a regra desta rodada permitia uma só fonte real) e "Tentar de novo" do pai; a variante "completa" do texto de completude da verificação.

### CH-relevance-and-availability-catch-up — Andreus em triagem (perna: disponibilidade `open` e `stale`)

- **Ran:** 2026-10-01T22:44Z → 22:52Z (box respeitado: sim, ~8min de 60)
- **Findings:**
  - Antes de qualquer checagem, `/jobs/15`: "disponibilidade desconhecida · nunca conferido".
  - "Atualizar status" da plataforma na tela (execução #5 na fila) e `jho jobs verify --run 5 --limit 3` (3 requisições às páginas das vagas): 3 verificadas, 3 vivas, 0 fechadas, 0 inconclusivas. `/jobs/15`, `/jobs/19` e `/jobs/22` passam a "disponível · conferido em 2026-10-01" (`data-availability="open"`), igual depois de `reload`; as outras seis seguem "desconhecida · nunca conferido".
  - Evento de `/jobs/15` envelhecido em 15 dias por SQL no banco descartável: "disponibilidade vencida · conferido em 2026-09-16" (`data-availability="stale"`), igual depois de `reload`, enquanto `/jobs/19` continua "disponível". Leitura independente: o detalhe da execução #5 mostra "vivas 3".
  - Os dois estados, em 375 px: sem rolagem horizontal (`scrollWidth` = `clientWidth`).
  - O estado "encerrada" por 404/410 com histórico de candidatura não foi percorrido (ver Human Verifications).
- **Bugs filed/updated:** BUG-20261001-verify-run-shows-capture-completeness-copy (achado aqui, ligado ao cenário ADMN)
- **Scenarios settled:** JOBS-availability-last-check → pass (open, stale e unknown desta rodada e do relatório anterior; closed pelo sync do relatório anterior; a perna 404/410 com histórico fica com o dono)
- **Paper cuts:** nenhum sentido nesta tela.
- **Surprises:** o detalhe da execução de verificação cortada pelo `--limit` mostra "Completude: janela parcial: não fecha por ausência" — texto de captura numa verificação (bug acima). `jho jobs recheck queue` não aceita restringir a uma fonte e enfileiraria também as vagas de fixture (URLs em `example.com`); por isso a checagem saiu pelo pedido da tela mais `jho jobs verify --run --limit 3`, que passa por `applyVerdict` do mesmo jeito.
- **Suggested next charter:** produzir um 404/410 legítimo numa fonte real não é viável; a perna "encerrada com histórico" fica com `/jobs/42` do dono.

### CH-structured-analysis-first-read — Andreus em triagem

- **Ran:** 2026-10-01T22:48Z → 22:54Z (box respeitado: sim, ~6min de 30)
- **Findings:**
  - Vaga cadastrada em `/compare` (texto próprio em inglês, sem salário, contrato PJ, remoto Brasil). "Pedir análise" deixa "Análise pendente… na fila · prompt v1 · esquema v1" e o estado sobrevive a `reload`.
  - `jho analysis run --max 1 --yes` com a chave NVIDIA do operador (no ambiente, nunca em arquivo): `{"id":1,"status":"failed"}`. Admin lê "modelo nvidia/moonshotai/kimi-k2-instruct · erro: provider_error" e "Tentar de novo"; `bruno@local.test` (candidato) lê só "A última tentativa não terminou (falhou)", sem painel, modelo nem erro.
  - **Causa exata do bloqueio**, por chamadas diretas ao provedor (uma por modelo, 8 a 16 tokens de saída): `moonshotai/kimi-k2-instruct` (o padrão) HTTP 410, fim de vida em 2026-05-12; `qwen/qwen3-coder-480b-a35b-instruct` HTTP 410, em 2026-06-11; `meta/llama-3.1-405b-instruct` HTTP 404. Cinco modelos vivos do catálogo `/v1/models` do provedor (`openai/gpt-oss-20b`, `mistralai/mistral-large-2-instruct`, `nvidia/llama-3.1-nemotron-70b-instruct`, `moonshotai/kimi-k2.6`, `nvidia/nemotron-3-super-120b-a12b`) devolvem HTTP 403 "Authorization failed", e uma chave de controle inválida devolve 401: a chave autentica, mas não está autorizada para nenhum modelo vivo. Não há outra chave configurada (`jho llm list`).
  - Texto da vaga alterado repetindo o cadastro em `/compare` (mesma identidade): a seção mostra "A vaga mudou depois desta análise: os campos abaixo leem o texto anterior", também numa tentativa falha.
  - Não observados (sem análise concluída): campo a campo com valor e trecho, "desconhecido" onde falta evidência, versão para o candidato, modelo e custo só para o admin numa análise concluída, pedir de novo o mesmo texto sem criar outra, aviso de desatualizada sobre análise concluída. Nada foi simulado.
- **Bugs filed/updated:** BUG-20261001-analysis-provider-error-hides-cause (novo, Trust-Damage)
- **Scenarios settled:** JOBS-structured-analysis → blocked-verify
- **Paper cuts:** o aviso "os campos abaixo leem o texto anterior" aparece numa tentativa que falhou e não tem campo nenhum abaixo (dull: lê-se como lapso de texto, sem efeito no resultado).
- **Surprises:** o catálogo de modelos NIM que `jho llm seed` entrega está inteiro fora do ar (bug acima).
- **Suggested next charter:** repetir a mesma charter quando houver uma chave autorizada para ao menos um modelo vivo.

## What Was Fixed

Nenhum. Esta rodada não corrige código, só registra: as duas fichas ficam `open`.

## Paper Cuts

| Persona | Where (journey/step) | Felt | Sharpness | Outcome |
|---|---|---|---|---|
| Andreus em triagem | J-operate-source-catalog, cadastro de fonte | "cadastrei e os campos continuavam preenchidos" (2ª observação) | dull | watching |
| Andreus em triagem | J-read-structured-job-analysis, leitura depois de falha | "diz que os campos abaixo leem o texto anterior, e não há campo nenhum" | dull | watching |

## Runtime Errors Observed

- Aviso de hidratação do React sobre `#app-splash` (`dangerouslySetInnerHTML` do layout) em `/login`, `/admin/plataformas` e `/admin/execucoes`, só em `next dev` (selo "1 Issue" do overlay). Mesmo padrão já registrado nos relatórios `2026-09-28T205309000000Z-62fe85e4-perfil-publico-foto-capa-targeted.md` e `2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md`; sem efeito observável nas telas desta rodada, nenhum bug novo.
- `provider_error` em `jho analysis run` (ver sessão 3): falha do provedor externo, mas a tela esconde a causa (bug acima).

## Human Verifications Needed

- [ ] `JOBS-availability-last-check`: abrir `/jobs/42` autenticado como `andreus@zorbit.com.br` (conta real do dono) e confirmar que o histórico de candidatura permanece visível numa vaga encerrada. Fora desta rodada por regra: não usa a conta real do dono. O caminho roda em E2E-004 com vereditos do próprio `applyVerdict`.
- [ ] `JOBS-structured-analysis`: autorizar a chave NVIDIA para pelo menos um modelo vivo na conta do dono (hoje: 403 em cinco modelos vivos, e 410/404 nos três do cadastro), ou configurar outro provedor, e então `jho analysis run --yes [--model <id>]` sobre uma vaga com análise pendente; ler os campos, o "desconhecido", o custo só para o admin, pedir de novo o mesmo texto e o aviso de desatualizada. (linha #3)
- [ ] `ADMN-source-catalog-denied`: decidir se existe via de produto para sessão emprestada com outro ADMINISTRADOR como alvo (a tela `/admin/users` só oferece "Act as this user" em contas candidato/recrutador). Decisão do dono, não percorrida aqui.

## Decisions for a Human

Nenhuma escalada do governor do fix-loop (nenhum código corrigido). Duas fichas abertas esperam triagem do dono: #438 (Trust-Damage, recomendação: gravar o status HTTP no erro e atualizar ou sinalizar os modelos NIM do cadastro) e #439 (Friction, recomendação: texto próprio para a completude de uma execução de verificação).

## Learnings

- **Receita do ambiente descartável sem o harness** (útil porque o `run-isolated --manual` exige build e FIFO): contêiner `postgres:17` próprio em loopback; criar os papéis `anon`, `authenticated`, `service_role`; criar o banco com o nome `jho_test_<32 hex>`, que é o que `tests/e2e/setup-manual.ts` exige, e rodá-lo com `DATABASE_URL`, `DATABASE_MIGRATION_URL` e `JHO_TEST_DATABASE_URL` iguais (migra e semeia as contas `@local.test`); criar um papel de login `IN ROLE master_jobs_runtime` (sem superusuário nem `BYPASSRLS`) para o servidor e a CLI; `PORT=<n> JHO_ENV=local JHO_AUTH_MODE=secure pnpm dev`. Numa worktree a CLI tem de rodar com `pnpm --dir <worktree> jho …` para o `cwd` certo.
- `agent-browser` 0.26.0: com `--session-name <nome>` o cookie de login **sobrevive** entre invocações (a nota de memória de 2026-09-21 não se confirmou aqui). Referências `@eN` só valem depois de um `snapshot` na mesma chamada de `batch`; `eval` roda fora do `batch`; clicar em link por `a:has-text(...)` falhou, a referência funcionou.
- A guarda de ingestão também recusa `jho jobs verify --run` e `jho jobs sync --run` fora de produção sem `JHO_ENV=local JHO_INGESTION_OPT_IN=true`; passei o opt-in só nos comandos da CLI e não no servidor, que ficou sem permissão de rede de ingestão.
- O aviso de confirmação de `jho analysis run` imprime a chave mascarada com 11 caracteres reais (prefixo e sufixo). É desenho do produto, mas qualquer saída capturada (agente, CI) carrega esses caracteres; vale o dono decidir se a máscara deve mostrar só o nome da variável (regra 16).
- `docs/qa/README.md` ainda não documenta `JHO_INGESTION_OPT_IN` nem a necessidade de migrar o banco local antes da sessão (sugestões do relatório de 2026-09-28 que continuam abertas; fora do escopo desta rodada).

## Final Status

- **Exit gate (docs-only, L0):** `pnpm check:qa-tracker` → `docs/qa/state.csv: 112 scenarios`; `pnpm check:instructions` → "Instruções: symlinks dos harnesses, links, âncoras e inventário de regras conferem."; `pnpm check:release-ready` → `no-release`. O contêiner `jho-qa-223-pg`, o servidor `pnpm dev` e as sessões do navegador foram removidos ao fim. A suíte automatizada completa não faz parte desta rodada (branch só de `docs/qa`, sem mudança de código).
- **Parity disclosed:** (1) `pnpm dev` (Turbopack), não build de produção; (2) servidor sem permissão de ingestão, que só a CLI do operador tem; (3) execução pedida pela tela rodada pela CLI, porque o ambiente não tem credencial de disparo, como o próprio produto orienta; (4) o envelhecimento de 15 dias do evento de `/jobs/15` e as 21 execuções de preenchimento foram feitos por SQL no banco descartável — estado, não caminho do produto; (5) uma única fonte real concluiu; (6) provedor de LLM real, nunca simulado; a perna de sucesso ficou bloqueada.
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 0 · Trust-Damage 1 (#438) · Friction 1 (#439) · Cosmetic 0
- **Coverage:** 3 cenários percorridos em 3 sessões: 2 `Pass` (ADMN-source-runs-partial-retry, JOBS-availability-last-check) e 1 `Blocked (needs human verify)` (JOBS-structured-analysis); nenhum `Fail`. Fora, por regra: `/jobs/42` com a conta real do dono e a decisão sobre sessão emprestada de administrador.
- **Verdict:** ready with blocked items — os dois cenários que dependiam de rede de ingestão fecham; a análise estruturada só fecha quando o dono autorizar uma chave de provedor para um modelo vivo, e o texto da completude da verificação e o erro opaco da análise esperam as issues #439 e #438.
