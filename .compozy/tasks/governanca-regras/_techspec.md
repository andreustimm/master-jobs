# Organização proposta e estratégia de implementação

**Proposta, não alteração vigente.** Esta especificação não modifica a precedência atual de `AGENTS.md`. A implementação será feita pelas issues mapeadas em [_tasks.md](_tasks.md), a partir de baseline revalidada. Estado e dependências operacionais pertencem ao GitHub Project 3; este slug conserva especificação e rastreabilidade.

## 1. Separar perguntas, sem multiplicar fontes

| Camada proposta | Responsabilidade | O que não deve acumular |
|---|---|---|
| `AGENTS.md` | Entrada comum: contexto mínimo, invariantes críticas, precedência, roteador obrigatório por área e fluxo resumido. | Relatos longos de incidentes, inventário de comandos, contagens, versões copiadas e receitas operacionais completas. |
| `docs/engineering/rules/README.md` | Índice das seis referências por domínio, IDs e como resolver conflitos. | Segunda cópia integral das regras ou motor novo de workflow. |
| `docs/engineering/rules/*.md` | Detalhes normativos: obrigação, escopo, exceções, origem e evidência aplicável. | Passos de ferramenta ou histórico cronológico. |
| `.claude/skills/<nome>/` | Procedimentos para executar trabalho autorizado, entradas/saídas e validação. | Redefinição da política, autorização implícita para ação externa ou cópias por harness. |
| `docs/architecture.md`, `data-model.md`, `sources.md`, `scoring.md`, `operations.md`, `docs/product/` | Estado atual e contratos do produto, com links para regras quando pertinente. | Mandatos globais duplicados e estado antigo apresentado como vigente. |
| `docs/adr/` | Razão e consequências das decisões duráveis. | Procedimento que envelhece a cada ferramenta. |
| `docs/qa/` | Personas, jornadas, cenários e evidência de execução conforme contrato existente. | Um segundo tracker de QA neste slug. |
| `.compozy/tasks/<slug>/` | Plano, especificação, testes, tarefas e revisão da feature. | Nova política global que só quem conhece o slug conseguiria descobrir. |
| Changelogs | O que mudou em cada release. | Substituir documentação de como o sistema funciona hoje. |

O índice de regras pode ser Markdown com IDs estáveis. Não se propõe banco de regras, daemon, gerador de política, plataforma de recibos ou novo orquestrador. Os checks devem reaproveitar o stack do repositório e verificar propriedades concretas.

## 2. Entrada comum e carregamento dos três harnesses

Preservar `AGENTS.md` como fonte canônica e `CLAUDE.md` como symlink. `.codex/skills` e `.opencode/skills` continuam apontando para `.claude/skills`; comandos/agentes compartilhados mantêm os symlinks existentes. Configurações por ferramenta só orientam a descoberta e o uso específico do harness. Não copiar regras para arquivos equivalentes por ferramenta.

A futura entrada deve conter:

1. Contexto mínimo do produto e os limites de uso do perfil.
2. Invariantes críticas escritas diretamente: LinkedIn, não envio de candidatura, integridade das decisões, autenticação/escopo, privacidade/cache, segredo fora do banco, segurança de migrations e produção humana.
3. Início/retomada com status/worktrees e preservação de WIP.
4. Roteador: antes de alterar uma área, ler sua referência por domínio; ao abrir PR, ler regra de entrega e procedimentos aplicáveis.
5. Fluxo curto de verificação e fontes de QA/revisão, incluindo proporcionalidade documental.
6. Precedência e procedimento de conflito: não enfraquecer proteção para seguir exemplo obsoleto; registrar discrepância com evidência e corrigir a fonte responsável.
7. Bloco gerado pelo Next preservado nos delimitadores existentes.

Links não garantem autoload. A regra de leitura precisa estar explícita na entrada; a tarefa 06 valida como os três harnesses resolvem o mesmo conteúdo. A brevidade é consequência de separar responsabilidades, não meta de linhas que autorize apagar obrigação.

## 3. Destino de cada obrigação

Os destinos abaixo são **novos arquivos propostos**, ainda não criados. “Entrada” indica também resumo crítico em `AGENTS.md`, com ID/link para o detalhamento. O resumo não deve reinventar exceções ou versões.

| Destino canônico proposto | IDs da matriz | Também na entrada |
|---|---|---|
| `docs/engineering/rules/security.md` | G01, G09, G14, G16, G17, G18, G19, G21, G22, G23, G24, G25, G36, G37, G38, G39, G40, G41, G73, G79, G80 | LinkedIn, evidência, não envio, auth/escopo, privacidade, cache e credenciais. |
| `docs/engineering/rules/architecture.md` | G04, G05, G06, G07, G65, G66, G67, G78, G82 | Portas para variação real, domínio puro e runtime suportado. |
| `docs/engineering/rules/data-and-sourcing.md` | G02, G03, G12, G13, G20, G26, G27, G28, G42, G68, G70, G71, G74, G75, G76, G77, G81 | Ingestão não altera decisões, ausência não apaga vaga, migration e descarte protegidos. |
| `docs/engineering/rules/matching-and-evidence.md` | G08, G10, G11 | Score versionado e dados ausentes neutros; evidência profissional referencia G09 no domínio de segurança. |
| `docs/engineering/rules/frontend.md` | G29, G30, G31, G32, G33, G34, G35, G69 | I18n, tokens, acessibilidade e celular como requisitos de toda tela. |
| `docs/engineering/rules/delivery.md` | G15, G43, G44, G45, G46, G47, G48, G49, G50, G51, G52, G53, G54, G55, G56, G57, G58, G59, G60, G61, G62, G63, G64, G72, G83, G84 | Worktree/base, WIP, permanentes, produção humana, gates e fontes canônicas. |

Cada ID tem **um** destino primário. Referências cruzadas são permitidas; uma regra de autorização citada por dados não ganha uma segunda definição. T06 deve preservar origem e motivação e justificar qualquer fusão/renumeração. Nenhuma regra válida está proposta para remoção.

Os números de versão, schema, quantidade de rotas e comandos saem da entrada. Quando houver fonte simples verificável (package, registro de tema, schema), apontar para ela. Onde a informação é operacional/dinâmica, datar a observação e não chamar a cópia de fonte da verdade.

## 4. Conflitos e tratamento proposto

| ID | Divergência observada | Resolução proposta e justificativa | Responsável |
|---|---|---|---|
| C01 | AGENTS/contexto e security.md descrevem produto só local e trechos sem auth; há auth e produção Supabase/Vercel documentadas. | Manter loopback nos scripts locais; atualizar modelo de ameaça hospedado e mover incidentes antigos para seção histórica. Não remover auth nem bind. | T03, T06 |
| C02 | “`/p` é a única rota sem sessão” versus login/reset/callback/manifest/offline e cron autenticado por segredo. | Classificar superfícies: públicas por conteúdo, pré-sessão, assets/shell e serviço com autenticação própria. Exceção nominada com controle substituto; rota desconhecida continua privada. | T03, T06 |
| C03 | “Só passwordLoginAction é exceção” versus reset, logout e encerramento de impersonação. | Registrar motivo e salvaguarda de cada entrada; descobrir exports e impedir efeito privado antes do guard. Não excluir uma pasta inteira da verificação. | T03 |
| C04 | “Nunca deletar vaga” versus retenção/prune permitidos. | Proibição absoluta no desaparecimento/ingestão; exclusão administrativa só com elegibilidade e proteção de decisões, incluindo concorrência. A exceção já existe; explicitá-la não amplia autorização. | T05, T06 |
| C05 | Exigir ação explícita de FK versus teste que aceita default `no action`. | Verificar intenção explícita separadamente da paridade no catálogo PostgreSQL; conservar o teste real de ambas as camadas. | T05 |
| C06 | Skill/playbook SQLite/libSQL e pragma versus runtime PostgreSQL; avaliação da skill afirma adaptação já feita. | Corrigir binding, caminhos do journal, DDL, backfill e verificação PostgreSQL; corrigir afirmação de avaliação. Preservar histórico SQLite como histórico rotulado. | T05, T07 |
| C07 | Deploy recusa todo sslmode/query; regra e implementação aceitam TLS equivalente ou mais forte. | Publicar allowlist do contrato real e exemplos do provedor; negativos para afrouxamento/valor desconhecido; nenhuma extração de valor Sensitive. | T05, T06 |
| C08 | Regra visual proíbe token bruto, outro parágrafo recomenda `var(--color-*)` no componente. | Componente usa token semântico; paleta bruta pertence à definição do tema. Texto usa token com contraste adequado; editor mantém família `--cm-*`. | T06, T10 |
| C09 | SCORER_VERSION copiada como 1.3.0; código 1.4.1. Data-model diz que conteúdo não invalida score, teste prova que invalida. | Remover versão replicada da entrada e atualizar contrato de invalidação. Manter exigência de bump/rescore para alterações semânticas do scorer/perfil; não dispensá-la por existir profile hash. | T06, T10 |
| C10 | “Páginas sem client JS” versus componentes interativos atuais. | Preservar servidor como fronteira de dados/autoridade e URL como estado de filtro; permitir ilhas cliente sem duplicar regra de negócio. | T06, T10 |
| C11 | AGENTS admite decisão registrada sobre FIX_BEFORE_SHIP; ship-pr só aceita SHIP. | Caminho padrão exige SHIP. Exceção só por decisão humana explícita e vinculada aos achados/diff, quando a política permitir; skill não pode concedê-la a si mesma. REWORK não vira aprovação por texto genérico. | T06, T07, T09 |
| C12 | Config Codex manda editar “ambos” AGENTS/CLAUDE, mas CLAUDE é symlink. | Uma fonte autoral; corrigir comentário/ponteiro. Preservar aliases de harness. | T06, T09 |
| C13 | QA docs contam oito rotas axe; runner contém dez. Cobertura documenta piso diferente da configuração. | Fonte executável para números; documentação explica alcance e limitação, sem copiar contagens que não sejam necessárias. | T06, T08 |
| C14 | `application_event` “nunca deletada” versus cascades. | Append-only para operações de histórico; política de ciclo de vida deve definir exclusões autorizadas e proteger decisões de exclusão indireta. Não alterar cascade automaticamente para satisfazer frase. | T05, T06 |
| C15 | “setApplicationStatus exclusivamente pela CLI”/“única mutação da UI” versus actions atuais. | Funil centraliza transição no caso de uso; UI e CLI são chamadores. Há outras mutações legítimas fora do funil. | T06, T10 |
| C16 | “Todo acesso à rede passa getJson” versus HEAD/HTML/mail/LLM. | Portas por finalidade e proteções comuns apropriadas; não forçar corpo JSON para probe/HTML. Mantém limites, SSRF, timeout e proibição LinkedIn. | T04, T06, T10 |
| C17 | Comando fonte-nova presume que zero vagas prova handle errado. | Validar status/formato/contrato e registrar resultado; board vazio pode ser legítimo. Não fechar board inteiro nem insistir em retries indevidos. | T07, T10 |
| C18 | Comando vagas exige confirmação para mover funil; job-triage manda decidir/registrar. | Distinguir pedido de triagem autorizada da ingestão automática. Respeitar autorização já dada pelo usuário; sem autorização para decisão, apresentar sugestão. Nunca conferir essa autoridade ao sync. | T07 |
| C19 | Regra “produção humana” sem proteção de branch/ambiente observada. | Tratar como lacuna operacional, não razão para afrouxar a regra. Implantar proteção remota com exceções mínimas do bot e provar o caminho recusado. | T02 |
| C20 | CI verde de dev descrito como prova do conteúdo promovido, mas workflow lê ref posterior e aceita dispatch. | Vincular evento/CI/alvo por SHA imutável e definir tratamento do commit de versão; falhar em corrida ou comprovação ausente. | T01 |
| C21 | Não fazer commit direto em permanentes versus bots de versão/retorno e hotfix. | Separar trabalho comum de automação nomeada e hotfix autorizado; não conceder bypass genérico a pessoas ou bot. Preservar retorno, ancestralidade e produção humana. | T01, T02, T06 |
| C22 | Domínio “sem relógio”, mas score/freshness têm `Date.now()` implícito na assinatura legada/default. | Tempo explícito no núcleo; composição captura o instante. Preservar compatibilidade onde necessária fora da função pura e provar determinismo com o mesmo `asOf`. | T06, T10 |

Não se resolve conflito escolhendo automaticamente o comportamento atual do código: o código pode estar errado. A proposta acima preserva a finalidade das salvaguardas e exige prova antes da mudança.

## 5. Forma dos controles

### 5.1 Promoção e GitHub

T01 deve modelar o estado mínimo da promoção: SHA de entrada, checks exigidos, SHA de release, comparação de schema, ancestralidade e destino. O caminho automático parte do `head_sha` do CI aceito; o manual escolhe alvo explícito e exige os mesmos checks. Se o versionamento produzir outro commit, provar o resultado conforme o contrato definido, sem reclassificar arbitrariamente alterações como dispensadas de CI. Retentativa não pode mudar de alvo porque `dev` avançou.

T02 faz a proteção no servidor depois dessa modelagem. Separar PR de trabalho, promoção de staging, publicação humana e retorno para dev. Testar permissão de delete/force-push, check ausente/falho e merge/publicação automática. Consultas GET e simulações em repositório/ambiente de teste devem preceder qualquer alteração remota. Não disparar produção para provar a negativa. Confirmar recursos disponíveis e evitar deadlock de aprovação com mantenedor único.

### 5.2 Superfície de segurança

Inventariar páginas, route handlers, Server Actions e outras entradas efetivamente expostas. Descoberta deve se basear na semântica/convenções reais do framework, não somente sufixo `actions.ts`. Cada entrada recebe política, escopo e, se necessário, exceção específica com salvaguarda substituta. Uma entrada nova sem classificação falha.

Teste de presença de guard é complementar; a prova crítica é negar acesso e impedir leitura/efeito antes da autorização. Testar identidade alheia por formatos diferentes, sessão inválida, admin e impersonação. Proibir `open` onde o ambiente não permite. Não usar token/cookie real nem dado de produção em fixtures.

O segundo consentimento do CV é necessário, mas não autoriza implicitamente publicar piso salarial ou contatos protegidos pela regra atual. Definir uma versão apropriada para publicação, prévia e recusa de conteúdo protegido identificado; provar negativos com sentinelas em texto, além do DTO. Qualquer limite de detecção deve ser explícito e não pode ser apresentado como sanitização perfeita. Uma eventual alteração dessa política exigiria decisão separada, fora da reorganização.

### 5.3 Dados, rede e domínio

Preservar testes com PostgreSQL, concorrência e erros induzidos. Adicionar upgrade com fixture do schema anterior, FKs explícitas e disputa retenção/candidatura. Não supor que `drizzle-kit generate` em banco vazio prova upgrade. Verificar role implantada por metadados seguros em tarefa operacional futura, separada da prova local do provisionador.

Criar casos negativos da fronteira LinkedIn e do não envio com transportes de teste. Domínio público, robots e HTTP 200 não autorizam aquisição proibida. Exibir ou importar texto enviado pelo usuário continua permitido no escopo já documentado. Não criar serviço de submissão “desabilitado”: a tarefa protege a ausência dessa capacidade.

Nos testes de arquitetura, expandir descoberta somente onde a regra exige. AST/import graph pode resolver falsos negativos de regex, mas não substitui asserções de efeito. Portas só onde a variação existe; nenhum container ou sintaxe TypeScript não apagável.

### 5.4 Browser, QA e revisão

Inventário de rotas deve exigir perfil de execução (papel, fixture, rota dinâmica, locale, viewport, tema pertinente) ou exceção justificada. Não é necessário um produto cartesiano indiscriminado: a seleção precisa ser explícita e garantir controles críticos. O runner deve confirmar que chegou à tela esperada antes de declarar tradução/acessibilidade aprovadas.

CI passa a chamar o lane de browser aplicável com PostgreSQL isolado, autenticação real e saída não mascarada. Preservar o navegador específico da PWA e explicar seus limites. Testes pesados continuam sequenciais conforme a operação documentada.

QA de jornada permanece independente de E2E. O tracker verifica consistência e links; não concede Pass pelo formato. Deep-review preserva veredito e evidência ligados à revisão atual; skill de auditoria certifica execução de tarefas, sem substituir revisão nem QA.

### 5.5 Governança documental proporcional

Verificar links, IDs, symlinks, registro de exceções e fontes conhecidas com os scripts de teste existentes ou extensão pequena. Não reproduzir o texto normativo em um JSON paralelo. Para PR, metadata deve apontar responsável, impacto em docs/QA e evidência de revisão/validação pertinente. Um campo preenchido comprova declaração, não veracidade; revisão humana/automatizada continua necessária.

Não exigir suite de runtime para somente Markdown/metadados. Não inferir que uma alteração é documental pela extensão se ela modifica um arquivo interpretado para execução. Skills/scripts e workflows requerem verificação do comportamento que mudaram.

## 6. Sequência e migração segura

1. Revalidar baseline e proteções. P0s podem ser entregues separadamente, sem esperar toda a reorganização.
2. Corrigir proveniência da promoção antes de endurecer permissões que possam bloquear automações.
3. Fechar fronteiras de segurança, rede e dados com provas negativas e preservar testes fortes existentes.
4. Migrar conteúdo por ID: copiar para o destino proposto, revisar equivalência e só então reduzir a fonte antiga a resumo/link. Durante a implementação, uma PR não deve deixar duas definições divergentes.
5. Atualizar skills, comandos, referências e docs atuais junto da mudança correspondente, mantendo aliases.
6. Ligar gates e browser ao fluxo; validar deliberadamente falhas em ambiente descartável.
7. Executar a verificação final do escopo efetivamente implementado e declarar pendências com evidência.

Uma mudança revertida deve devolver também seus ponteiros e documentação. Proteções remotas não devem ser desligadas como rollback genérico de código; corrigir o caminho operacional ou usar exceção humana estreita e registrada quando necessária. Nenhuma tarefa autoriza merge/publicação automática em `main`.
