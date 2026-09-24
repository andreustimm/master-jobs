# Catálogo de evidências e alcance dos gates

Baseline: `463688f3704fdd2187732edba798acd1d81a1070`. **Os testes abaixo foram lidos, não executados nesta auditoria.** “Comportamental” descreve o desenho da prova, não um resultado verde obtido agora. Os resultados efetivamente executados estão em [_validation.md](_validation.md).

## Convenções

- **U**: Vitest incluído por `tests/**/*.test.ts`; roda em `rtk pnpm check` e no job de qualidade do CI, salvo condição explícita.
- **B**: `rtk pnpm test:e2e` executa o runner isolado de interface e axe; execução local solicitada pelo fluxo. A suíte geral não está chamada no CI examinado.
- **P**: navegador da PWA condicionado a `JHO_PWA_BROWSER_TESTS=1`; CI chama `test:pwa-browser`. O `check` local comum não habilita essa condição.
- **H**: hook local, condicionado à instalação/configuração e ao caminho usado para operar Git.
- **W**: workflow do GitHub, condicionado ao evento, `if`, secrets, configuração e identidade do executor.
- **M**: procedimento humano/agente; a instrução não constitui bloqueio automático.
- **R**: configuração remota consultada nesta auditoria.

## E01 — Baseline, fontes e symlinks

`rtk git status --short --branch` encontrou a worktree limpa em HEAD destacado; `rtk pnpm worktrees` confirmou que ela coincidia com `origin/dev` local. Os symlinks observados são `CLAUDE.md → AGENTS.md`, `.codex/skills → ../.claude/skills`, `.opencode/skills → ../.claude/skills`, `.opencode/agents → ../.claude/agents` e `.opencode/commands → ../.claude/commands`. `core.hooksPath` está em `.githooks`. Isso comprova o estado local observado, não a leitura efetiva das instruções por toda sessão nem a instalação de hooks em todo clone.

## E02 — O que realmente executa

[package.json](../../../package.json), [vitest.config.ts](../../../vitest.config.ts), [CI](../../../.github/workflows/ci.yml) e [fixture PostgreSQL](../../../tests/support/postgres-global.ts) foram lidos. `check` encadeia release-ready, tracker de QA, typecheck, Vitest com cobertura e unittest do conversor de QA. O CI executa esses componentes, geração do SW, navegador PWA, build e outro job de consistência de migrations. Não chama `test:e2e`, `tests/e2e/ui.mjs` ou `tests/e2e/a11y.mjs`.

A cobertura inclui `src/**`, exclui schema e declarações, e não cobre integralmente `app/`, scripts ou workflows. Limiares: 97% statements, 94,5% branches, 97,5% functions e 97,9% lines. O global setup usa PostgreSQL 17 descartável via Docker em loopback; não é uma prova do banco implantado. O engine local observado está abaixo do exigido. Gatilhos: **U/B/P/W** distintos; cobertura alta não comprova todas as regras.

## E03 — TypeScript, portas e domínio

[architecture.test.ts:48](../../../tests/architecture.test.ts#L48) verifica sintaxe proibida por regex e configuração `erasableSyntaxOnly`; o typecheck adiciona a verificação do compilador. A regra de extensão relativa usa padrões de `from` com aspas duplas: não é descoberta universal de imports dinâmicos ou outras sintaxes. Em [linha 78](../../../tests/architecture.test.ts#L78), a pureza é exercida especificamente sobre `contexts/skills/domain`, contra alguns imports de infraestrutura. Outros testes cobrem contextos/caminhos determinados, portas e dependências cliente/servidor. Não há prova universal de ausência de rede, relógio ou SQL em todo domínio, nem de que toda variação futura recebeu porta. Gatilho: **U**, parte estrutural; julgamento de necessidade de abstração: **M**.

Há também uma divergência concreta com “sem relógio”: [score.ts:569](../../../src/core/scoring/score.ts#L569) chama `Date.now()` na assinatura legada, e [freshness.ts:71](../../../src/core/scoring/freshness.ts#L71) o usa como default. Os testes de freshness passam `NOW` explicitamente e o caminho atual de persistência fornece `asOf`; isso prova o recorte determinístico, não elimina o relógio implícito dos outros chamadores. T10 deve tornar o tempo entrada explícita do núcleo e tratar compatibilidade na composição.

## E04 — Escrita da ingestão e decisões

[architecture.test.ts:258](../../../tests/architecture.test.ts#L258) procura chamadas diretas `.insert(application)`/`.update(application)` e caminhos conhecidos de observação. Não resolve aliases, SQL bruto, exclusões ou efeitos transitivos. [cov-ingest-run.test.ts](../../../tests/cov-ingest-run.test.ts) usa banco e HTTP de fixture: repete sync, altera vaga e verifica que status e nota da candidatura sobrevivem; também cobre idempotência e fechamento apenas com board não vazio. É evidência comportamental do caminho exercitado, não de todos os futuros importadores. Gatilho: **U**.

## E05 — Fechamento, retenção e exclusão

[db-retention.test.ts](../../../tests/db-retention.test.ts) testa dry-run sem alteração, remoção de payload volumoso sem perder metadados e limpeza que preserva vaga com candidatura, remove a elegível sem candidatura e é idempotente. [job-lifecycle.test.ts](../../../tests/job-lifecycle.test.ts) testa regras puras de arquivo/reabertura. A asserção textual de `pruneClosed` em `architecture.test.ts` verifica o predicado `not in (...)`, não todos os caminhos de delete.

[cov-db-schema.test.ts](../../../tests/cov-db-schema.test.ts) demonstra que apagar uma vaga diretamente pode apagar a candidatura por cascade. Portanto a FK não protege sozinha a decisão; a autorização e o predicado do descarte são essenciais. Não foi localizada nesse teste de retenção prova da corrida entre descarte e criação concorrente de candidatura. Gatilho: **U**. O absoluto “nunca deletada” precisa distinguir ausência na fonte de descarte administrativo autorizado, sem ampliar o segundo.

## E06 — HTTP que fecha vaga

[verify-queue.test.ts](../../../tests/verify-queue.test.ts) testa 404/410 como `gone`, 401/403/429 e 5xx/rede como inconclusivos, e 2xx/3xx como `alive`. O worker não fecha no 403 e reabre uma vaga fechada quando recebe `alive`. [cov-ingest-verify.test.ts](../../../tests/cov-ingest-verify.test.ts) usa DB e respostas HTTP simuladas para 410/200/403/503, dry-run e erro de rede. Esse batch exclui vagas já fechadas; a promessa de reabertura não deve ser atribuída indistintamente a todo comando de verificação. Gatilho: **U**; nenhuma fonte real foi chamada nesta auditoria.

## E07 — Campos vazios e aliases

[import-field-alias.test.ts](../../../tests/import-field-alias.test.ts) chama `parsePayload` com `company.name` vazio, objeto vazio, fallback `employer`, localização em branco, salário inválido e descrição vazia. Confere o valor resultante e a precedência do primeiro valor normalizado válido. A prova cobre o importador exercitado; não todo uso de `??` nem todos os adapters. Gatilho: **U**.

## E08 — Limites concorrentes

[fetcher-limit.test.ts](../../../tests/fetcher-limit.test.ts) usa fila cujo claim cede ao event loop e mede processamentos/claims com concorrência maior que o limite; cobre fila vazia e ausência de limite. [platform-quota.test.ts:86](../../../tests/platform-quota.test.ts#L86) disputa dez reservas reais no PostgreSQL para orçamento quatro e exige exatamente quatro sucessos. Confere devolução da unidade diária quando o minuto está cheio, zero chamadas de rede com cota esgotada, 429 encerrando o dia e orçamento compartilhado por sync/capturas. São provas fortes desses mecanismos, não uma análise universal de cada contador concorrente. Gatilho: **U**.

## E09 — Neutralidade, rubrica e bloqueadores

[freshness.test.ts](../../../tests/freshness.test.ts) verifica 0,5 sem data, idade nula, platô/decaimento e benefícios neutros em descrição curta sem bloqueio por informação ausente. [scoring.test.ts](../../../tests/scoring.test.ts) exercita títulos, léxico, geografia, autorização, senioridade, compensação e faixa do score. O caso de bloqueador mantém fit maior que zero: a palavra “eliminatório” na motivação não significa apagar a vaga ou zerar todo score. O contrato deve preservar sinalização e rebaixamento documentados, sem inventar mudança no algoritmo. Gatilho: **U**; não foi medido serviço externo ou modelo vetorial.

## E10 — Versão e invalidação de score

[architecture.test.ts:389](../../../tests/architecture.test.ts#L389) exige a declaração de uma string SemVer; isso não verifica bump quando um diff toca scorer/perfil. [track-scoring.test.ts](../../../tests/track-scoring.test.ts) referencia a versão atual `1.4.1` e sua persistência; `AGENTS.md` ainda diz `1.3.0`. [job-observation.test.ts:115](../../../tests/job-observation.test.ts#L115) altera conteúdo, exige invalidação de scores de dois candidatos, e distingue mudança apenas na URL de candidatura, que preserva os scores. Contradiz o texto de `docs/data-model.md` que diz que `content_hash` não dispara repontuação. Gatilho: **U**; rescore operacional e disciplina de bump: **M**, sem gate de diff encontrado.

## E11 — Evidência profissional e ausência de envio

[cov-apply-dossier.test.ts:299](../../../tests/cov-apply-dossier.test.ts#L299) monta um perfil sintético com evidências e testa seleção por área, limite de oito, ausência de correspondência e descrição insuficiente. É uma prova do dossiê, não certificação de qualquer texto livre produzido por agente/LLM; a fixture não tenta contaminar `growth` com uma alegação falsa. `application-kit`, `candidate-profile` e comandos repetem a política de não inventar e não enviar candidatura. Não foi encontrado um teste de fronteira que prove ausência de submissão ou envio de documentos/mensagens ao empregador ou ATS em todos os caminhos de preparação. Gatilhos: **U/M**.

## E12 — Política de autorização

[auth-policy.test.ts](../../../tests/auth-policy.test.ts) chama a política pura com sessão ausente/expirada, papéis, escopos próprios/alheios, vínculo de recrutador, ação desconhecida e impersonação. Admin não recebe leitura privada irrestrita, e a sessão emprestada perde ações administrativas inclusive quando o alvo é admin. Isso é evidência forte da decisão; não comprova sozinho que todo endpoint a chama. Gatilho: **U**.

## E13 — Composição de autenticação

[architecture.test.ts:521](../../../tests/architecture.test.ts#L521) coleta arquivos terminados em `actions.ts`, procura exports de funções async e uma chamada de guard. Arquivos como `logout-action.ts`, outras formas de export e caminhos transitivos não entram automaticamente. A presença do guard não prova a ordem dos efeitos; [linha 304](../../../tests/architecture.test.ts#L304) e verificações pontuais de operações têm uma prova de ordem mais restrita. As páginas candidatas são uma lista literal, com tratamento separado de detalhes da vaga. Route handlers têm descoberta mais ampla e exceções específicas.

[ui.mjs](../../../tests/e2e/ui.mjs), blocos de autenticação e `ROLE_SCENARIOS` a partir de aproximadamente 1990, usam login real e navegação para conferir destinos, páginas permitidas e negadas por papel. Também há provas de cookie forjado e `/api/export`. Gatilhos: checagem estrutural **U**; composição de navegador **B**, fora do CI geral. “Todas as páginas/actions” excede o alcance automático atual.

## E14 — Senha e recuperação

[password-truncated-hash.test.ts](../../../tests/password-truncated-hash.test.ts) rejeita hashes vazios, curtos, longos e malformados, preservando sucesso da senha correta. [password-reset.test.ts](../../../tests/password-reset.test.ts) usa DB e mailer de fixture: resposta uniforme, endereço normalizado, conta desabilitada, limite, falha de envio, troca efetiva de senha, revogação das sessões, expiração e segunda tentativa inválida. [ui.mjs](../../../tests/e2e/ui.mjs) compara URL e texto após pedido existente/inexistente. Reuso sequencial não prova disputa simultânea de duas redenções; o catálogo não atribui essa prova a esses casos. Gatilhos: **U/B**.

## E15 — Perfil público e impersonação

[public-profile.test.ts](../../../tests/public-profile.test.ts) compara exatamente as chaves do DTO público, verifica invisibilidade de perfil não público, ausência de e-mail/campos privados e CV nulo sem o segundo consentimento. A fixture contém salário, mas o caso com ambos os consentimentos só exige a presença da frase profissional; não exige ausência daquele salário. A implementação em [candidate-public.ts](../../../src/core/candidate-public.ts) atribui `doc.content` integralmente ao CV público. Não confundir allowlist de campos com remoção automática de PII/salário inseridos no texto autorizado. [impersonation.test.ts](../../../tests/impersonation.test.ts) observa criação/revogação de sessão, trilha de auditoria, duração e recusas para alvo inválido, autoimpersonação e encadeamento. Gatilho: **U**. A expressão “única rota sem sessão” conflita com login, recuperação, callbacks e infraestrutura pública necessários.

## E16 — BYOK e saída de segredo

[architecture.test.ts:477](../../../tests/architecture.test.ts#L477) restringe endpoints de provedores, nomes `apiKey`/`apiKeyEnv`, uma forma de coluna e padrões de `console.log/error`. Um arquivo que contém `apiKeyEnv` escapa da busca mais geral de `apiKey`; alias, SQL bruto e outros loggers não são prova coberta. [llm.test.ts](../../../tests/llm.test.ts) testa mascaramento de segredos e construção de entrada; a fixture de input não contém todos os dados privados que se pretende excluir. Gatilho: **U**. Não foi lido valor de chave ou secret.

## E17 — Cache da PWA

[pwa-chrome.test.ts:536](../../../tests/pwa-chrome.test.ts#L536) roda Chromium contra servidor HTTP sintético e o SW real. Semeia respostas com marcadores privados, comprova que o conteúdo esteve disponível online e inspeciona chaves e corpos reais do Cache Storage após navegação. Inclui login, candidato, jobs, candidaturas, salário, reset, perfil público, API e caminho desconhecido; permite só caches `static-` e `shell-`. Também exercita offline sem credenciais, quota, RSC e atualização. É mais forte que ler strings do template, mas não é a composição inteira do Next autenticado em produção. Gatilho **P**: habilitado explicitamente no CI; skip no Vitest comum sem a condição.

## E18 — Internacionalização

[i18n.test.ts](../../../tests/i18n.test.ts) verifica chaves, traduções, locale e formatação. [ui.mjs:2912](../../../tests/e2e/ui.mjs#L2912) detecta texto igual a valores portugueses exclusivos e texto com acento, excluindo conteúdo marcado como do usuário e outras exceções. Duas listas literais selecionam as rotas. Texto novo sem acento que não seja valor conhecido do dicionário pode passar; rota omitida não é medida. O scan não oferece por si só a mesma confirmação de resposta/path final que o runner de axe. A regra de `data-testid` e de buscar chave existente permanece principalmente procedimental. Gatilhos: **U/B**.

## E19 — Tema, escala, contraste, celular e axe

[design.test.ts](../../../tests/design.test.ts) e [mobile.test.ts](../../../tests/mobile.test.ts) usam buscas textuais por cores, tamanhos, classes colidentes e padrões de layout/viewport. O detector de hex se concentra em seis dígitos e tem exceções globais; não cobre todo `rgb()`, token bruto ou construção equivalente. [ui-spacing.test.ts](../../../tests/ui-spacing.test.ts) confere strings de classes em superfícies específicas.

[ui.mjs](../../../tests/e2e/ui.mjs) mede overflow em larguras de 320 a 1024 e rotas enumeradas, contraste em amostras de telas/temas e spans reais do CodeMirror nos seis ambientes. Isso não significa todos os textos de todas as rotas em todas as combinações. [a11y.mjs](../../../tests/e2e/a11y.mjs) percorre dez rotas, verifica resposta e path final e roda axe com tags WCAG, numa configuração de viewport, sem produto cartesiano de todos os temas. Gatilhos: estático **U**, browser **B**. A regra universal requer inventário e justificativa de amostragem.

## E20 — FKs e permissões PostgreSQL

[cov-db-schema.test.ts](../../../tests/cov-db-schema.test.ts) compara as FKs exportadas pelo schema com `pg_constraint`, incluindo colunas, tabelas, ação de delete e validação. Usa `fk.onDelete ?? "no action"`: igualdade não exige que a intenção seja declarada explicitamente no fonte. Testa delete de usuário preservando auditoria e delete de vaga com cascade. [postgres-permissions.test.ts](../../../tests/postgres-permissions.test.ts) cria login runtime e prova CRUD permitido, DDL/TRUNCATE/migrations/escalada negados, grants de tabelas futuras e bloqueio para roles inadequadas. Prova o provisionador em fixture, não a identidade usada pelo deployment atual. Gatilho: **U**.

## E21 — Configuração e TLS

[db-config-diagnostics.test.ts](../../../tests/db-config-diagnostics.test.ts) verifica precedência de variáveis, branco, URLs com parâmetros reais de provedor, rejeição de valores que afrouxam TLS ou são desconhecidos, aceitação de `require`, `verify-ca`, `verify-full`, remoção controlada dos parâmetros e erros sem segredo. Certificado PEM/arquivo também é exercitado. Não acessa o valor Sensitive implantado. A recomendação atual de deploy que proíbe qualquer `sslmode` e exige URL sem query diverge desse contrato. Gatilho: **U**.

## E22 — Migrations e deploy

[CI:107](../../../.github/workflows/ci.yml#L107) gera migrations e verifica diff em `drizzle/`; detecta desalinhamento de artefatos, não prova transformação segura de banco populado anterior. [postgres-schema.test.ts](../../../tests/postgres-schema.test.ts) compara baseline e exceções revisadas. [postgres-deployment.test.ts](../../../tests/postgres-deployment.test.ts) verifica o workflow manual, confirmação do projeto, branch/ambiente e chama o shell de migração com destinos/configurações inválidos para exigir recusa sem expor segredos. [migrate.yml](../../../.github/workflows/migrate.yml) usa credencial privilegiada específica no passo de migração.

A skill [drizzle-safe-migrations:13](../../../.claude/skills/drizzle-safe-migrations/SKILL.md#L13) afirma SQLite/libSQL, usa `drizzle/meta/_journal.json` e orienta reconstrução/`pragma`, enquanto o projeto usa `drizzle/postgres/`. Gatilhos: **U/W/M**. Ambiente nomeado não implica aprovação: ver E26.

## E23 — Worktrees, branches e hooks

[worktree-workflow.test.ts](../../../tests/worktree-workflow.test.ts) cria repos temporários, executa hooks reais e exige recusa de commit/push/delete nas branches permanentes, valida nomes, aceita rebase detached e preserva WIP inclusive arquivo não rastreado oculto pelo status padrão. Isso é evidência comportamental de **H**, rodada por **U**. Os hooks não provam que uma branch nasceu de `dev`, que toda PR aponta para `dev`, nem impedem alterações via API, UI ou outro clone sem hooks. Limpeza exige verificar merge, WIP e branches local/remota; não foi executada aqui.

## E24 — Changelogs e releases

[release-boundaries.test.ts](../../../tests/release-boundaries.test.ts) usa repositório/índice reais: notas faltantes reprovam, índice prevalece sobre working tree e só o commit de release exato recebe exceção. O cliente GitHub de teste é um executável falso; confere plano/idempotência, não permissões remotas. [release-policy.test.ts](../../../tests/release-policy.test.ts) verifica notas técnicas/bilíngues, histórico anterior documentável, erro em lacuna moderna e preservação de release existente. Gatilhos: **U/H/W**. O mesmo validador é ligado ao commit-msg e ao CI; não constitui aprovação humana de produção.

## E25 — Commit promovido, migração e responsável da PR

[promover-para-staging.yml:92](../../../.github/workflows/promover-para-staging.yml#L92) aceita conclusão de CI bem-sucedida **ou** `workflow_dispatch`. Depois compara/faz checkout de `origin/dev`, calcula versão e promove o SHA de release derivado dessa ref. Não usa `github.event.workflow_run.head_sha` para vincular a entrada ao commit aprovado nem consulta CI do alvo no disparo manual. **Inferência causal:** CI do commit A pode terminar quando `dev` já contém B; a execução passa a trabalhar com B sem provar seu CI. Não foi provocado um deploy para testar essa corrida.

O workflow bloqueia divergência de `staging`, compara `drizzle/`/schema e exige confirmação manual quando há migração; o helper [promover-staging.ts](../../../scripts/release/promover-staging.ts) exige ancestralidade e faz push sem force. Isso protege fast-forward, não a proveniência do CI. A PR nova `staging → main` recebe assignee, mas o reaproveitamento não verifica a atribuição. A criação da PR de retorno em [sincronizar-apos-main.yml:251](../../../.github/workflows/sincronizar-apos-main.yml#L251) não inclui assignee. Gatilho: **W**, verificações locais parciais em **U**.

## E26 — Proteções remotas observadas

GETs autenticados via `gh api` em `repos/andreustimm/master-jobs`, sem alteração:

| Consulta | Resultado observado |
|---|---|
| `/rulesets` | `count: 0`, `rulesets: []` |
| `/branches/main/protection` | HTTP 404, mensagem `Branch not protected` |
| `/branches/dev/protection` | HTTP 404, mensagem `Branch not protected` |
| `/branches/staging/protection` | HTTP 404, mensagem `Branch not protected` |
| `/environments/production` | nome `Production`, `protection_rules: []`, `deployment_branch_policy: null` |

Timestamp: **2026-09-22 13:56:57 UTC**. O 404 veio com mensagem explícita de branch sem proteção; não foi tratado como mero erro de autorização. Não havia ruleset retornado nem proteção tradicional dessas branches. Isso demonstra ausência desses controles configurados naquele instante. Não enumera todos os controles da organização/Vercel ou todo principal com acesso, nem comprova exploração. Gatilho: **R**; hooks e YAML não substituem esta observação.

## E27 — QA vivo e seu validador

[docs/qa/README.md](../../../docs/qa/README.md) define tiers, personas, refresh, leitura independente, autenticação real e bloqueios humanos. O [materialize_state.py](../../../.claude/skills/qa-report/scripts/materialize_state.py) valida campos/ordem, enums, IDs, duplicidades e coerência de estados: pass/fail exigem strings de evidência/relatório; fixed exige commits; retest e notas de skip têm condições. Não verifica existência dos arquivos referenciados, SHA atual, execução real, abrangência de personas ou prioridade das jornadas. [qa-tracker-gate.test.ts](../../../tests/qa-tracker-gate.test.ts) confere ligação ao package/CI e ignore de bytecode. Gatilho: **U/W** para estrutura e **M** para jornada. Não foi materializado `docs/qa/state.csv` nesta tarefa.

## E28 — Docs e revisão

[architecture.test.ts](../../../tests/architecture.test.ts) verifica partes do mapa de contextos, contagem de tabelas, índice de ADRs e fronteira de links para arquivos arquivados. Não é um verificador geral de links de `AGENTS.md`, skills e slugs ativos. [operational-docs-contract.test.ts](../../../tests/operational-docs-contract.test.ts) verifica nomes de variáveis de mailer e docs específicos, não a atualidade do modelo de ameaça/TLS/contagens. Não foi localizado gate de PR que confira razão de `docs/`, assignee em todos os criadores ou revisão do diff atual. Deep-review e auditoria geram evidências próprias quando invocados; presença da skill não prova execução. Gatilhos: **U/M**.

## E29 — Skills, comandos e configurações

As 14 skills locais foram inventariadas e seus `SKILL.md` lidos; detalhes em S01–S14 na matriz. [ship-pr:101](../../../.claude/skills/ship-pr/SKILL.md#L101) só continua com `SHIP`; `AGENTS.md` admite registrar decisão de ignorar `FIX_BEFORE_SHIP`. A skill de migração contradiz o banco atual; [skills-evaluation.md](../../../docs/engineering/skills-evaluation.md) diz que ela foi adaptada a PostgreSQL. [.codex/config.toml](../../../.codex/config.toml) pede editar os dois arquivos de instrução, embora um seja symlink. Comandos e job-triage divergem na formulação da autorização para registrar decisões de triagem.

`.claude/settings.json` tem permissões locais, não um controle igual para todos os harnesses. Os symlinks compartilham conteúdo, não garantem que cada harness carregue todos os documentos referenciados. Gatilho: **M**, sem gate abrangente de consistência identificado. Skills apenas examinadas não foram executadas; `documentation-writer` orientou a autoria deste pacote.

## E30 — Rede, LinkedIn e envios

[remote-url.test.ts](../../../tests/remote-url.test.ts) testa endereços privados/metadata, DNS misto e redirect para rede privada; o fetch falso deve receber só a primeira chamada. Isso protege SSRF no caminho exercitado. [robots.ts](../../../src/core/scrape/robots.ts), [probe.ts](../../../src/core/ingest/probe.ts) e [remote-url.ts](../../../src/core/remote-url.ts) não contêm bloqueio específico universal de LinkedIn. Respeitar robots ou aceitar só IP público não equivale a respeitar a proibição de scraping desse domínio. A política de LinkedIn abrange também scripts pontuais e ferramentas de agente, que um teste de runtime não consegue controlar sozinho.

O plano deve preservar ingestão de alertas por e-mail e referências manuais, e não confundir exibir uma URL com buscá-la no servidor. O mesmo cuidado vale para preparação versus envio de candidatura: não foi demonstrada submissão indevida, mas não foi localizada prova negativa geral dessa fronteira. Gatilhos: **U/M**; nenhuma chamada ao LinkedIn ou ATS de candidatura foi feita.

## E31 — Separação de ambientes

[ingestion-environment.test.ts](../../../tests/ingestion-environment.test.ts) exige opt-in local e allowlist de produção, nega preview/dev/staging e valores desconhecidos. [ingestion-guard-entrypoints.test.ts](../../../tests/ingestion-guard-entrypoints.test.ts) chama entradas reais bloqueadas e confere erro tipado/zero fetch. A prova positiva de produção que apenas rejeita `IngestionBlockedError` não demonstra sucesso completo do fluxo.

[workflow-environment-isolation.test.ts](../../../tests/workflow-environment-isolation.test.ts) verifica workflows de listas literais, declarações de ambiente/secrets e cron. Parte lê `job.env`; credenciais de migração em `step.env` dependem da prova específica de E22. Não lê configurações reais do provedor. `docs/engineering/deploy.md` proíbe `JHO_AUTH_MODE=open` em produção, mas [session.ts:147](../../../src/contexts/auth/app/session.ts#L147) apenas compara a variável com `open`, sem condicionar a ambiente. Gatilhos: **U/W/M**. Não se afirma que produção esteja em modo aberto.

## E32 — Candidatura e evento na mesma transação

[repo.application.test.ts:221](../../../tests/repo.application.test.ts#L221) exige que transição ilegal não altere histórico; injeta trigger que faz o insert de evento falhar e verifica rollback do status; disputa duas transições e aceita somente uma. Outros casos preservam primeiro `appliedAt`, idempotência e escopo por candidato. Essas asserções são comportamentais e importantes. “Append-only” precisa ser entendido no ciclo de vida autorizado: o schema possui cascades, logo não equivale a retenção absoluta contra qualquer exclusão de entidade. Gatilho: **U**.

## E33 — Consultas simultâneas por tela

[db-fan-out.test.ts:49](../../../tests/db-fan-out.test.ts#L49) instrumenta `client.unsafe`, mede pico em chamadas reais de módulos de composição e exige teto `POOL - 1 = 2`. Confere também uma leitura de câmbio/trilhas em `/jobs`. Cobre funções listadas de cockpit, vagas, buscas, skills e matching. Não mede automaticamente toda página nova nem garante ausência de timeout em qualquer carga; `POOL` está declarado no teste. Gatilho: **U**. O texto operacional deve preservar essa limitação sem transformar uma hipótese de diagnóstico em prova geral de deadlock.

## E34 — Identidade da vaga, configuração e adapters

[job-observation.test.ts:185](../../../tests/job-observation.test.ts#L185) disputa duas observações do mesmo fingerprint e exige uma linha/um ID; exercícios adicionais entram por sync, manual, JSON e e-mail. [architecture.test.ts](../../../tests/architecture.test.ts) restringe caminhos diretos de escrita e [scoring.test.ts](../../../tests/scoring.test.ts) valida um perfil por Zod. Não se deduz desses casos que todo dado editável futuro passe por Zod, que todo adapter tenha probe real recente ou que qualquer erro de fonte seja isolado em qualquer orquestração. Essas obrigações continuam exigindo revisão/procedimento além dos casos automatizados. Gatilhos: **U/M**.

## Reavaliação final (task_11, #205)

Em 24/09/2026, no commit `c23f8ba2` (v1.25.1), E01–E34 foram reavaliadas contra
o código e os testes atuais. O `pnpm check` foi executado: 4178 testes
passaram e 8 foram pulados. O CI do mesmo SHA foi observado, e as proteções
remotas foram reconsultadas. O resultado de cada item e a separação entre
[R]/[X]/[L]/[H] estão em [_final-report.md](_final-report.md). As seções
acima continuam como fotografia da baseline `463688f3`; os textos não foram
reescritos.

Continuam **abertas**:

- **E16:** o gate de chave de API tem o escape `apiKeyEnv`, e falta a
  sentinela V03-06. Isso impede certificar G41.
- **E27:** o tracker de QA não confere se os arquivos referenciados existem.

Continuam **sem mudança**: E06–E09, E32 e E34. A E26 foi reobservada e
registrada em [evidencias/task_11-protecoes.json](evidencias/task_11-protecoes.json).

## Como usar o catálogo

Uma evidência pode ser forte para uma propriedade estreita e insuficiente para uma frase universal. Cada tarefa futura deve preservar a propriedade já demonstrada, adicionar o caso negativo que falta e registrar o comando que realmente executou. Configuração remota e comportamento em fixture devem permanecer em linhas distintas; nenhum teste local autoriza afirmar que produção está protegida.
