# Contrato de testes: catálogo de plataformas e busca híbrida (residual)

Contrato canônico do residual de `platform-catalog-hybrid-search`. Deriva de
[`_user_stories.md`](_user_stories.md), do [mapa de escopo](_scope-map.md) e
da [Tech Spec](_techspec.md). Cada ID é atribuído a exatamente uma tarefa em
[`_tasks.md`](_tasks.md).

## Estratégia

- Frameworks: Vitest, PostgreSQL descartável com as migrations reais e o
  harness E2E isolado (`rtk pnpm test:e2e`).
- Falsos só na borda: HTTP de fonte, executor do dispatch e provedor de LLM.
  Repositórios, políticas e composição de auth são os reais. Nenhum teste
  aponta para Supabase, board público ou provedor real.
- Execução: Vitest direcionado, depois `rtk pnpm check`; `rtk pnpm test:e2e`
  quando a tarefa toca navegador; QA de jornada conforme `docs/qa/README.md`.
- Convenções: um comportamento observável por caso; datas fixas injetadas;
  controle achado por `data-testid`; fixture acentuada onde houver dado do
  usuário (`data-user-content`).

## Regressão que já existe e não ganha ID novo

O residual não pode enfraquecer estes testes; cada tarefa os roda como estão.

| Comportamento entregue | Teste existente |
|---|---|
| Só 404/410 fecham; 401/403/429, 5xx e rede são inconclusivos (US-013) | `tests/cov-ingest-verify.test.ts`, `tests/verify-queue.test.ts` |
| Alive reabre e limpa arquivamento (US-015) | `tests/job-lifecycle.test.ts`, `tests/verify-queue.test.ts` |
| Janela parcial não fecha por ausência; candidatura intocada (US-007.EC-2) | `tests/job-lifecycle.test.ts`, `tests/cov-ingest-run.test.ts` |
| Histórico de candidatura após fechar e arquivar (US-016) | `tests/job-archive.test.ts`, `tests/candidate-history.test.ts`, `tests/cov-cli-arquivamento.test.ts` |
| Filtro whole-word, `C#`/`C++` literais, separador `[ -]?` (US-017, US-018 parcial) | `tests/term-kernel.test.ts`, `tests/jobs-board.test.ts` |
| Entrada nova sem política reprova | `tests/entry-denial.test.ts`, `tests/support/entry-inventory.ts`, `tests/architecture.test.ts` |

## Matriz de cobertura

| Fonte | Comportamento / borda | Unit | Integração | E2E |
|---|---|---|---|---|
| US-001 | Lista com kind, handle, estado, saúde, última execução | — | IT-001 | E2E-001 |
| US-001.EC-1 vazio | Sem fonte: explica como cadastrar, sem saúde falsa | — | — | E2E-001 |
| US-001.EC-2 permissão | Candidato/recrutador não vê configuração | UT-009 | — | E2E-002 |
| US-002 | Cadastrar handle suportado, habilitado ou não | UT-002 | IT-001 | E2E-001 |
| US-002.EC-1 inválido | Kind fora do registro ou handle malformado recusado antes de rede e banco | UT-002 | — | — |
| US-002.EC-2 segredo | Valor de chave no lugar do nome recusado, nunca gravado nem ecoado | UT-003 | IT-001 | — |
| US-002.EC-3 limites | Rótulo/handle longo recusado com o máximo | UT-002 | — | — |
| US-002.AC-2 duplicado | Mesmo kind/handle recusado | UT-002 | IT-001 | — |
| US-003 | Desabilitar tira da execução "todas"; aposentar preserva vagas e execuções | UT-004 | IT-001, IT-005 | E2E-003 |
| US-003.EC-1/EC-2 | Edição ou desabilitação durante execução vale para a próxima; a ativa usa o retrato | UT-005 | IT-005 | — |
| US-004 | Sondagem reporta alcançável/vazio/bloqueado/falha e não grava | UT-001 | IT-002 | E2E-001 |
| US-004.EC-1 | 401/403/429 → bloqueado, nunca "vazio" | UT-001 | — | — |
| US-005 | Capacidades por adapter; operação sem suporte desabilitada com motivo | UT-001 | — | E2E-001 |
| US-005.EC-1 | Kind sem metadado → tudo indisponível, conservador | UT-001 | — | — |
| US-006 / US-029 | Não admin e sessão emprestada negados antes de efeito; board segue pesquisável | UT-009 | — | E2E-002 |
| Fonte da verdade | Linha gerida não é sobrescrita pelo YAML; não gerida espelha inclusive `enabled: false`; divergência listada | UT-004 | IT-002 | — |
| US-007 | Buscar agora cria execução enfileirada e volta sem esperar rede | UT-005 | IT-003, IT-004 | E2E-001 |
| US-007.EC-1 | Fonte desabilitada ou aposentada → recusa sem execução | UT-005 | IT-003 | — |
| US-008 | Execução "todas" com filhas; uma falha dá `partial` sem esconder as outras | UT-006 | IT-005 | E2E-003 |
| US-008.EC-2 | Concorrência limitada, reserva antes do `await` | UT-008 | — | — |
| US-009 | Estados e contagens; refresh mostra a mesma execução | UT-006 | IT-004 | E2E-001 |
| US-009.EC-1 / US-027 | Sem batimento além do lease → `interrupted`, com nova tentativa | UT-007 | IT-005 | — |
| US-009.EC-2 | Contagem ausente = desconhecido, não zero | UT-006 | IT-004 | E2E-003 |
| US-010 | Nova tentativa ligada à original, que não muda | UT-006 | IT-005 | E2E-003 |
| US-010.EC-1 / US-011 / US-028 | Pedido equivalente ativo devolve a mesma execução | UT-005 | IT-003 | — |
| US-011.EC-2 | Resultado atrasado não sobrescreve estado terminal | UT-006 | IT-003 | — |
| Dispatch | Sem credencial: fica `queued` com motivo visível | — | IT-006 | — |
| US-031 | Linha terminal imutável; erro limitado e redigido | UT-006 | IT-003, IT-006 | — |
| US-031.EC-1 | URL com query e e-mail redigidos antes de gravar | UT-012 | IT-006 | — |
| US-012 | Atualizar status por fonte ou todas; contagens vivo/fechado/inconclusivo | — | IT-008 | E2E-003 |
| US-012.EC-1 | Nada vencido → execução bem-sucedida com zero | — | IT-008 | — |
| US-013 | Evento registra veredito, código e evidência | UT-011 | IT-007 | — |
| US-013.EC-2 | Interrupção deixa não verificadas como estavam | — | IT-008 | — |
| US-014 | Vaga mostra disponibilidade e última checagem | UT-010 | — | E2E-004 |
| US-014.EC-1/EC-2 | Checagem vencida → "vencida"; nunca verificada → "desconhecida" | UT-010 | — | E2E-004 |
| US-015.EC-1 | Evento fora de ordem não decide o estado | UT-010 | IT-007 | — |
| US-015.AC-1 | Reabertura preserva o evento de fechamento anterior | — | IT-007 | — |
| Caminho único | `jho jobs verify` e a fila passam por `applyVerdict()` e gravam `check_status` e evento | — | IT-008 | — |
| US-017 | Localização entra no filtro; explicação diz o campo | UT-015 | IT-009 | E2E-005 |
| US-017.EC-1/EC-2 | Consulta vazia usa o padrão; aspas desbalanceadas viram texto | UT-013 | — | E2E-005 |
| US-018 | Grupo "termos parecidos" separado, limitado, só com quem passa nos filtros | — | IT-010 | E2E-005 |
| US-018.EC-1 | Similaridade baixa excluída; grupo nunca supera o casamento exato | — | IT-010 | — |
| US-018.EC-2 | Sem `pg_trgm`, o resultado principal segue e nada fala em proximidade | UT-015 | IT-010 | — |
| US-019 | Relevância não muda o conjunto nem a contagem dos filtros exatos | UT-014 | IT-009 | E2E-005 |
| US-019.AC-2 | `sort=relevance` na URL, sobrevive a refresh; sem `q` volta ao fit | UT-014 | — | E2E-005 |
| US-021 | Explicação só com sinal que contribuiu; nunca "semântico" sem vetor | UT-015 | — | E2E-005 |
| US-022 | Pedir análise de vaga legível; pendente | — | IT-011 | E2E-006 |
| US-022.EC-1 | Vaga ilegível responde igual a inexistente | — | IT-012 | — |
| US-022.EC-2 / US-025.EC-2 | Clique duplo ou corrida → uma análise ativa | — | IT-011 | — |
| US-022.AC-2 / US-026 | Nada escreve em candidatura, perfil nem nota | — | IT-012 | — |
| US-023 | Campos, desconhecidos, evidência, modelo e versão | UT-016 | — | E2E-006 |
| US-023.EC-1 | Resultado parcial marca o resto como desconhecido | UT-016, UT-017 | — | — |
| US-023.EC-2 | Texto mudou depois da análise → aviso e nova análise | — | IT-011 | E2E-006 |
| US-024 | Admin vê versões, falhas e custo; candidato não | — | IT-012 | E2E-006 |
| US-024.AC-2 | Chave e corpo do provedor nunca gravados | UT-017 | IT-011 | — |
| US-025 | Nova tentativa ligada; cota esgotada → `paused_quota` | — | IT-011 | — |
| US-026.AC-1/EC-1 | Proveniência por campo; contradição vira `conflict` com as duas evidências | UT-016 | — | — |
| Análise da vaga | Entrada do prompt não carrega CV, perfil nem dossiê | UT-018 | — | — |
| US-020 | Sem vetor, a ordem é a lexical e nada fala em semântica | UT-019 | IT-013 | — |
| US-020.EC-2 | Vetor de outro modelo é ignorado | UT-020 | — | — |
| US-020 + A4 | Sinal semântico nunca adiciona nem remove linha do conjunto filtrado | — | IT-013 | — |
| US-030 | Listas paginadas; execução com trabalho limitado | — | IT-004 | E2E-003 |

## Testes unitários

- **UT-001** (capacidade): `capabilitiesOf` devolve as capacidades de cada kind do registro; kind desconhecido → tudo indisponível; `classifySourceProbe` classifica 401/403/429 como `blocked` e 5xx/rede como `failed`, nunca como `empty`.
- **UT-002** (validação): `validateCatalogWrite` recusa kind fora do registro, handle malformado, rótulo e handle acima do máximo e kind/handle duplicado, sem rede nem banco.
- **UT-003** (segredo): `secretRef` aceita só nome de variável; valor com forma de chave é recusado, e o erro não contém o valor.
- **UT-004** (importação): `planCatalogImport` insere o que falta, não toca linha gerida, espelha `enabled: false` em linha não gerida, marca como órfã a linha não gerida ausente do YAML e lista a divergência; `parseSourcesConfig` passa a devolver a entrada desabilitada com `enabled: false`.
- **UT-005** (idempotência): `runKey` é estável para o mesmo escopo e revisão e muda com a revisão; fonte desabilitada ou aposentada não gera execução.
- **UT-006** (estado): `nextRunStatus` recusa sair de estado terminal, compõe `partial` quando uma filha falha e mantém contagem nula como desconhecida.
- **UT-007** (interrupção): `isStale` marca `running` sem batimento além do lease e nunca marca execução terminal.
- **UT-008** (concorrência): o limitador de execuções reserva o slot antes do `await`; N pedidos simultâneos respeitam o teto e os excedentes ficam enfileirados com motivo.
- **UT-009** (permissão): as políticas novas negam candidato, recrutador e sessão emprestada (inclusive de admin) antes de qualquer efeito.
- **UT-010** (disponibilidade): `currentAvailability` ordena por `checked_at` e `id`, ignora evento mais antigo, devolve `stale` além da janela e `unknown` sem evento.
- **UT-011** (motivo): só 404/410 produzem `gone` com motivo `closed`; 2xx/3xx produzem `alive`; 401/403/429, 5xx, timeout e rede produzem `inconclusive` com motivo `unknown`.
- **UT-012** (redação): evidência e detalhe de erro são limitados em tamanho e perdem query string, e-mail e telefone.
- **UT-013** (consulta): `parseQuery` separa termos e frases entre aspas, trata aspas desbalanceadas como texto, mantém `C#` e `C++` literais e devolve vazio para espaço em branco.
- **UT-014** (ordenação): `compareByRelevance` ordena título > empresa > localização/descrição, com desempate por fit, recência e id, de forma determinística.
- **UT-015** (explicação): a explicação lista só os campos que casaram e a proximidade quando ela contribuiu; nunca menciona semântica sem sinal persistido.
- **UT-016** (evidência): `bindEvidence` rebaixa para `unknown` o campo cujo trecho não é substring do texto normalizado, marca `conflict` com as duas evidências e preserva os campos válidos de um resultado parcial.
- **UT-017** (esquema): saída malformada do provedor vira `failed` ou `partial` sem coerção; o resultado persistível não contém chave nem corpo bruto.
- **UT-018** (privacidade): o construtor da entrada da análise recebe só a vaga; não aceita CV, perfil nem dossiê.
- **UT-019** (fallback): sem vetor atual, a ordem é idêntica à lexical e a explicação não fala em semântica.
- **UT-020** (versão): vetor de modelo ou dimensão diferente do configurado é tratado como ausente.

## Testes de integração

- **IT-001**: migration aplicada; cadastrar, editar, desabilitar e aposentar fonte no PostgreSQL; duplicado e segredo recusados; vagas e execuções de fonte aposentada seguem legíveis.
- **IT-002**: `ensureSources()` nos dois regimes; linha órfã desabilitada; o sync não seleciona `manual:sample` da fixture, kind sem adapter nem fonte `<kind>:~terms`, mesmo habilitada, e vaga trazida por captura por termo não fecha; `jho sources import` em simulação e aplicado, `jho sources diff`; a sondagem pela action não grava vaga nem saúde.
- **IT-003**: dois pedidos equivalentes concorrentes geram uma execução; UPDATE em linha terminal afeta zero linhas; resultado atrasado não sobrescreve.
- **IT-004**: `syncOne()` grava a execução-filha com contagens e completude; janela parcial registra `closed = 0`; nenhuma escrita em `application`; lista de execuções paginada.
- **IT-005**: execução "todas" usa o retrato de fontes do momento do pedido; filha falha → pai `partial`; nova tentativa ligada à original; `running` vencida vira `interrupted`.
- **IT-006**: dispatch sem credencial deixa a execução `queued` com motivo; erro do executor fica limitado e redigido.
- **IT-007**: `applyVerdict()` grava evento e estado na mesma transação; reabertura preserva o evento de fechamento; candidatura intocada; evento fora de ordem não muda o estado.
- **IT-008**: `jho jobs verify` e a fila passam pela mesma `applyVerdict()`; execução de verificação por fonte conta vivo/fechado/inconclusivo; interrupção deixa não verificadas intactas; nada vencido → zero.
- **IT-009**: na fixture de referência, `sort=relevance` e `sort=fit` devolvem o mesmo conjunto e a mesma contagem para os mesmos filtros e termo; para um termo que não aparece em nenhuma localização, o conjunto é idêntico ao do filtro anterior à tarefa 05; uma vaga que só casa na localização aparece e a explicação diz "localização"; a ordem da consulta coincide com `compareByRelevance`.
- **IT-010**: grupo de proximidade só com vagas que passam nos filtros e não casaram o termo, limitado a 20, exemplo abaixo do limiar excluído; o grupo filtra por `<%` e `job_title_trgm_idx` existe e aparece no `EXPLAIN` do grupo com `enable_seqscan = off` dentro da transação do teste (a fixture é pequena demais para o planejador preferi-lo por conta própria); sem a extensão, o resultado principal continua.
- **IT-011**: pedido de análise idempotente sob clique duplo; nova tentativa ligada; cota esgotada → `paused_quota`; `running` sem batimento vira `interrupted` e libera novo pedido; `input_hash` diferente sinaliza vaga alterada; nenhuma coluna guarda chave.
- **IT-012**: vaga ilegível responde como inexistente; candidato não recebe modelo nem custo; análise não escreve em `application`, `job_score` nem `candidate`.
- **IT-013**: com vetores presentes, o sinal semântico só reordena; o conjunto filtrado é idêntico ao da busca sem vetor.

## Testes ponta a ponta

- **E2E-001**: admin entra → Plataformas vazio explica o cadastro → cadastra handle → sonda (HTTP falso) → habilita → Buscar agora → detalhe da execução sobrevive a refresh com contagens.
- **E2E-002**: candidato, recrutador e sessão emprestada abrem por link direto as rotas e ações de Plataformas e Execuções → negação sem vazar configuração; `/jobs` segue pesquisável.
- **E2E-003**: Buscar em todas com uma fonte falhando → `partial` com contagens por fonte e "desconhecido" onde faltou → tentar de novo só a falha → Atualizar status de uma fonte; telas em 375 px e varredura em inglês nas rotas novas.
- **E2E-004**: detalhe de vaga mostra disponibilidade com última checagem; vaga nunca verificada mostra desconhecida; vaga fechada com candidatura é distinguida no histórico.
- **E2E-005**: candidato busca `"tech lead"` com modalidade remota e ordenação por relevância → URL compartilhável, refresh preserva, explicação por campo visível, grupo de termos parecidos rotulado e separado; remover `q` volta à ordenação por fit.
- **E2E-006**: candidato pede análise → pendente sobrevive a refresh → processador pela CLI com provedor falso → campos, desconhecidos e evidências visíveis; admin vê versão e custo; após alterar o texto da vaga, aparece o aviso de análise desatualizada.
