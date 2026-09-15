# Supabase no Master Jobs: plano de adoção

Revisado em 2026-09-09. Proposta de evolução, não recursos já implantados.
Execução inicial: [plano de migração](../../.compozy/tasks/supabase-production/plan.md).

## Decisão atual

Usar somente o projeto `master-jobs` em São Paulo e o schema `production`.
Concluir primeiro PostgreSQL + Drizzle + dados essenciais. Next.js permanece
na Vercel, com autenticação própria e autorização por `can()`.
Schema por cliente é uma possibilidade futura; não será implementado agora.

## Prioridades para este produto

### Recorte aprovado: MVP no Free

Adotar agora apenas banco + migrations + permissões + métricas + backup próprio.
Cron fica como primeira melhoria operacional após estabilização, restrito a
limpeza leve. Storage entra quando houver PDF original a guardar. Não instalar
pgvector, Pinecone, Queues ou Realtime apenas porque estão disponíveis.

Limites consultados em 2026-09-09 (revalidar antes de implantação):

| Recurso Free | Limite divulgado | Consequência para o MVP |
|---|---|---|
| Banco | 500 MB por projeto; CPU compartilhada e 500 MB RAM | Importação seletiva e índices medidos |
| Egress | 5 GB; cached egress 5 GB | Paginação e evitar exportações repetidas do acervo |
| Storage | 1 GB; upload até 50 MB | PDFs privados com limite menor definido pelo produto |
| Edge Functions | 500 mil invocações; 100 funções por projeto | Não criar serviços extras sem caso concreto |
| Runtime Edge | 256 MB; worker até 150 s no Free; CPU 2 s por request | Webhooks/lotes curtos; inadequado para parsing/scoring pesado |
| Realtime | 200 conexões simultâneas; 2 milhões de mensagens/mês | Adiar até haver demanda de atualização em tempo real |
| Supabase Auth | 50 mil usuários ativos/mês | Disponível, mas migração de identidade fora do escopo |
| Operação | Pausa após 1 semana de inatividade; logs API/DB por 1 dia | Aceitar limitação do MVP e guardar evidência operacional própria |
| Backup/PITR/branching | Não incluídos no Free | Restore local e backup externo; apenas um projeto remoto |

Fonte dos limites de plano: [pricing](https://supabase.com/pricing).
Limites de runtime: [Edge Functions](https://supabase.com/docs/guides/functions/limits).
Quotas de uso não devem ser interpretadas como franquia independente para cada
função ou schema; conferir o agregado da organização no painel Usage.

### pgvector ou Pinecone

**Decisão recomendada para o MVP: nenhum agora; pgvector primeiro se necessário.**
O produto está migrando dados essenciais, portanto ainda não tem justificativa
para operar um índice semântico de todo o corpus de scraping.

| Opção | Vantagem | Custo/limitação | Decisão |
|---|---|---|---|
| Full-text PostgreSQL | Busca lexical no mesmo banco, sem embeddings | Índice ocupa espaço; testar termos técnicos e idiomas | Primeira opção se a busca atual precisar melhorar |
| pgvector | Vetores junto dos dados e filtros SQL; sem sincronização entre serviços | Divide os 500 MB com tabelas e índices; geração de embeddings requer processamento/modelo | Experimento futuro pequeno |
| Pinecone Starter | Armazenamento vetorial separado; Starter anuncia até 2 GB | Outro serviço, sincronização, permissões e orçamento de leitura/escrita; checar região antes de enviar dados | Adiar até gargalo vetorial comprovado |

Não afirmar que Pinecone é necessariamente mais caro em dinheiro: Starter tem
franquia gratuita. O motivo para adiar é a complexidade e a falta de necessidade
medida. Fonte: [Pinecone pricing](https://www.pinecone.io/pricing/).
Fonte pgvector: [vector columns](https://supabase.com/docs/guides/ai/vector-columns).

Um experimento justificável seria buscar experiências/documentos por significado
ou vagas semelhantes dentro do conjunto curado. Não usar o resultado para
substituir bloqueadores geográficos/contratuais ou inventar evidências no CV.
Começar com até 1.000 documentos, um vetor por item e dimensões suportadas pelo
modelo (por exemplo, 384). Payload float32 puro nesse exemplo é ~1,54 MB;
tabelas, metadados e índices acrescentam espaço. Não extrapolar o payload como
tamanho final do banco. Evitar HNSW até demonstrar necessidade por benchmark.

Aceitar somente se um conjunto de consultas reais melhorar a recuperação em
relação a full-text, mantendo filtros de autorização, orçamento medido e
processo de atualização por hash do conteúdo. Embeddings externos podem ter
custo e envolver envio de dados; modelos locais também consomem compute.

### Cron e Edge Functions: uso mínimo

Cron: propor uma rotina diária de limpeza de artefatos operacionais expirados,
com limite de linhas, duração e retenção dos próprios logs. Não apagar vagas ou
histórico de candidaturas para caber na cota. A recomendação do provedor de até
8 jobs concorrentes e 10 minutos por job é teto operacional recomendado,
não orçamento a consumir no Free. Começar com concorrência 1 e poucos segundos.

Edge Functions: considerar apenas webhook ou lote curto predominantemente I/O
quando não houver endpoint adequado na aplicação. Autenticar o disparo e exigir
idempotência. Preservar CLI/worker existente para scraping demorado; não copiar
lógica de domínio para um runtime paralelo. A cota de 500 mil invocações não
elimina os limites de CPU, memória, egress ou processamento do banco.
Cron não será usado para contornar pausa por inatividade.

| Prioridade | Capacidade | Benefício concreto | Entrega e critério de adoção |
|---|---|---|---|
| P0 — migração | PostgreSQL e migrations | Constraints e transações verificáveis para candidaturas, documentos e usuários | Baseline gerada, ensaio local, igualdade dos dados essenciais e migrations reaplicáveis |
| P0 — migração | Permissões e conexões | Runtime sem DDL e conexão adequada ao serverless | Role de aplicação distinta do migrator; testar negação de DDL e acesso público; pooler adequado ao driver |
| P0 — operação | Métricas de consultas e tamanho | Detectar crescimento e queries caras antes de repetir o incidente Turso | Baseline de tamanho/latência; top queries; orçamento de crescimento e retenção |
| P0 — operação | Backup e restauração | Recuperar decisões do usuário que não podem ser reconstruídas por ingestão | Export criptografado fora do banco e ensaio periódico de restore; RPO/RTO medidos |
| P1 — após estabilização | Full-text search | Encontrar vagas por termos e descrições sem varrer textos inteiros | Protótipo com índice e corpus representativo; comparar relevância, latência e espaço |
| P1 — quando houver arquivos | Storage privado | Guardar PDFs originais sem inflar tabelas PostgreSQL | Adapter de documentos, buckets privados, acesso curto autorizado e backup separado |
| P2 — demanda comprovada | RLS | Segunda barreira para dados privados de candidatos/recrutadores | Testes negativos por papel e posse, inclusive sessão emprestada e pool reutilizado |
| P2 — concorrência real | Queues | Processamento durável para recheck e scoring via QueuePort | Adapter experimental, teste de retry/duplicidade/worker morto e limite de backlog |
| P2 — operação estabilizada | Cron | Centralizar limpeza leve e disparo de lotes | Um dono por agendamento, kill switch, retenção de logs e canário de custo |
| P3 — necessidade de UX | Realtime | Mostrar progresso das filas sem polling frequente | Canal privado, escopo por candidato e orçamento de eventos/conexões |
| P3 — decisão independente | Supabase Auth | Possível simplificação de login e provedores externos | ADR e plano específico para migrar identidades, senhas, recuperação e impersonação |

## Limite de espaço e migração seletiva

O Free inclui 500 MB de tamanho de banco por projeto. O limite considera o
banco PostgreSQL, não apenas os registros da aplicação; o espaço do arquivo
SQLite não prevê o tamanho final. O projeto novo já tem tabelas internas.
Ver [preços](https://supabase.com/pricing) e
[database size](https://supabase.com/docs/guides/platform/database-size).

Orçamento operacional proposto, não limite do provedor: carga inicial total
até 300 MB, alerta em 350 MB, ação em 400 MB. Medir tamanho total, índices,
TOAST e tabelas internas após carga e índices. Não depender de compressão
estimada nem consumir os 500 MB na primeira importação.

A decisão do usuário é importar dados necessários à aplicação, sem carregar
todo o acervo de crawlers. A seleção deve ser fechada por dependências:

- Preservar usuários, candidatos, versões de documentos, perfis, skills,
  vínculos autorizados, candidaturas, eventos, contatos/posicionamento,
  configurações de provedores/modelos e correspondência de negócio.
- Preservar as vagas referenciadas por candidaturas, sugestões de e-mail e
  outros registros de negócio, incluindo fontes e empresas necessárias.
  Preservar também vagas inseridas manualmente pelo usuário.
- Preservar texto útil das vagas selecionadas; remover do destino HTML bruto
  e JSON bruto reconstruível conforme a política de retenção, registrando
  a transformação. Não apagar o dump de origem.
- Excluir páginas capturadas (`job_page`) e backlog operacional de scraping/
  recheck; scores podem ser limitados às vagas selecionadas. Criar todas as
  tabelas por migration, mesmo quando a carga inicial delas for vazia.
- Definir antes do corte o tratamento de sessões e links temporários;
  preservar hashes de senha e auditoria de negócio. Nunca copiar credenciais
  de uma cópia sanitizada de desenvolvimento como se fossem produção.

A seleção significa que a lista inicial de vagas será menor. O sourcing pode
ser retomado com retenção e orçamento após a migração, sem restaurar o corpus
inteiro nem reativar automaticamente os consumidores pausados.

## Por que estes recursos, e quando

### Diagnóstico de consultas e conexões

`pg_stat_statements` e as ferramentas de inspeção permitem identificar custo
por consulta e uso de espaço. Aplicar isso às consultas de fila e ranking que
já causaram pressão operacional. Migrar para PostgreSQL não corrige sozinho
uma subconsulta correlacionada ou um worker sem limite.
Fontes: [inspeção](https://supabase.com/docs/guides/observability/inspect),
[estatísticas](https://supabase.com/docs/guides/database/extensions/pg_stat_statements),
[conexões](https://supabase.com/docs/guides/database/connecting-to-postgres).

### Busca textual

Full-text search e índices podem melhorar a busca no catálogo. Fazer testes
em português/inglês e com termos técnicos. A busca serve para recuperar vagas;
o fit score continua a rubrica determinística com bloqueadores de elegibilidade.
Não substituir o scorer por similaridade, embeddings ou LLM.
Fonte: [full-text search](https://supabase.com/docs/guides/database/full-text-search).

### Arquivos privados

Storage é adequado a PDFs originais, caso o produto passe a preservá-los.
Manter referências e metadados em `production`, objetos em bucket privado e
verificar posse no servidor antes de entregar acesso. A autenticação própria
não passa automaticamente a valer nas políticas de Storage. Links assinados
têm validade e não equivalem à revogação imediata de uma URL pública.
O Storage tem cotas próprias; não usá-lo como depósito ilimitado de crawlers.
Fonte: [controle de acesso](https://supabase.com/docs/guides/storage/security/access-control).

### RLS e futuro multi-tenant

RLS pode reforçar o isolamento, mas `auth.uid()` não conhece automaticamente
as sessões próprias do Master Jobs. Uma futura implementação deve definir
identidade de conexão e contexto transacional; com pooler, nunca deixar tenant
em configuração de sessão que possa vazar para outra requisição.
Owner e roles com BYPASSRLS podem ignorar políticas. `can()` permanece a regra
de negócio; RLS não substitui consentimento de perfil/CV público.
Schema por cliente exige credenciais/permissões e orquestração de migrations;
nomes de schema sozinhos não isolam recursos ou acesso.
Fonte: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

### Filas e agendamento

Avaliar Supabase Queues através de `QueuePort` se os workers concorrentes
justificarem. Consumo deve ser idempotente mesmo quando houver retry após
efeito parcial. Não trocar o adapter atual durante a migração de banco.
Cron pode disparar limpeza e lotes, mas não substitui worker de captura longo.
Evitar duplicar os agendamentos de Actions/Vercel e limitar histórico de jobs.
Fontes: [Queues](https://supabase.com/docs/guides/queues),
[Cron](https://supabase.com/docs/guides/cron).

### Recuperação

Backups gerenciados e PITR dependem do plano/configuração; não presumir que
existem no Free. Planejar export próprio e restauração testada. Backup do banco
não inclui o conteúdo dos objetos de Storage: os dois precisam de estratégia.
Fonte: [backups](https://supabase.com/docs/guides/platform/backups).

## Ordem de execução

1. Concluir o plano de migração: migrations, importação seletiva, teste local,
   QA, credenciais e corte. Não ligar outros serviços junto com a troca de banco.
2. Registrar baseline pós-carga e implantar retenção/backup com restauração
   comprovada. Revisar índices pelo custo observado.
3. Abrir tarefa de busca textual se consultas e necessidade do usuário
   justificarem; tarefa de Storage apenas quando houver arquivo a preservar.
4. Avaliar RLS, Queues, Cron e Realtime em tarefas próprias, com métricas e ADRs.
5. Reavaliar multi-tenancy e Auth somente mediante nova decisão de produto.

## Fora do escopo

Não criar Dev/Staging remotos, schemas de clientes, migração para Supabase Auth,
Data API pública, embeddings para scoring ou cópia integral dos crawlers.
Não há compromisso de plano pago nesta proposta.
