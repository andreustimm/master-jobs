# Ciclo de vida das vagas e histórico de candidaturas

**Status:** decisão de produto aceita; implementação pendente  
**Data:** 2026-09-16  
**PRD:** [job-lifecycle-retention](../../.compozy/tasks/job-lifecycle-retention/_prd.md)

## Problema

Uma vaga pode deixar de aparecer na fonte, expirar ou responder `404`, mas a
decisão de se candidatar continua sendo um dado do candidato. Se o sistema
tratar o desaparecimento como exclusão, perde a resposta para duas perguntas
importantes:

- **Candidato:** “Em quais vagas me candidatei e quantas candidaturas tenho em
  cada etapa?”
- **Recrutador autorizado:** “Quais candidaturas dos candidatos sob meu vínculo
  estão abertas, fechadas ou aguardando ação?”

O produto precisa reduzir o acervo ativo sem destruir essa memória.

## Modelo de estados

| Estado | Significado | Pode desaparecer fisicamente? |
|---|---|---|
| Aberta | A fonte ainda observa a vaga, ou ela ainda não foi contradita. | Não por rotina de retenção. |
| Fechada (`closed_at`) | Fato observado: reconciliação completa da fonte, `404`/`410` seguro ou expiração confirmada. | Somente pela poda conservadora e sem candidatura, após retenção. |
| Arquivada (`archived_at`) | Estado operacional: vaga fechada antiga saiu da superfície ativa. | A marca não autoriza apagar histórico. |
| Reaberta | Nova observação/probe `alive` voltou a confirmar a vaga. | Limpa o arquivamento automático e devolve a vaga ao ativo. |

`application.status = archived` é uma decisão sobre a candidatura. Não é um
sinônimo de `job.archived_at` e não deve ser alterado automaticamente quando a
fonte fecha a vaga.

## Política de arquivamento proposta

1. O sync e o probe continuam apenas fechando/reabrindo `job`; não escrevem em
   `application`.
2. Vagas fechadas podem deixar o board ativo imediatamente por `closed_at`.
3. Uma rotina idempotente marca `archived_at` depois de um corte configurável,
   com **90 dias** como padrão inicial. O comando deve oferecer `--dry-run` e
   produzir contagens antes de aplicar.
4. A rotina automática só considera fechamento confirmado. Falha parcial de
   fonte, `401`, `403`, `429`, `5xx` e erro de rede não fecham nem arquivam.
5. Qualquer vaga com linha em `application` permanece no histórico do candidato
   e do recrutador autorizado. A marca de arquivo pode ocultá-la do board ativo,
   mas nunca remove a relação, seus documentos ou seus eventos.
6. A poda física (`prune`) continua separada, exige vaga fechada fora da janela
   de retenção e ausência de qualquer candidatura. Ela nunca é o mecanismo de
   arquivamento.
7. Vagas manuais/recruiter não entram no arquivamento automático sem uma regra
   de autoria explícita; a pessoa que cadastrou a vaga deve poder preservá-la.
8. Se a vaga voltar a `alive`, o sistema remove o `archived_at` automático e
   registra a observação; não cria uma nova candidatura.

## Visão do candidato

A área autenticada deve oferecer um resumo e uma lista:

- total de candidaturas únicas;
- contagem por status (`backlog`, `shortlisted`, `preparing`, `applied`,
  `screening`, `interviewing`, `offer`, `rejected`, `withdrawn`, `archived`);
- datas `created_at`, `applied_at`, última atualização e próxima ação;
- título, empresa e estado da vaga (`aberta`, `fechada`, `arquivada`);
- link de candidatura e notas que o próprio candidato registrou;
- histórico de eventos quando solicitado.

Uma vaga arquivada continua aparecendo quando possui candidatura. A tela não
deve inferir “não me candidatei” da ausência da vaga no board.

## Visão do recrutador

O recrutador vê apenas o conjunto autorizado por sua sessão e seus vínculos.
Nesse escopo, pode consultar:

- número de candidaturas por candidato e por status;
- vagas fechadas/arquivadas que ainda têm candidatura;
- datas de aplicação, estágio e próxima ação;
- métricas agregadas de seu próprio funil.

Não pode consultar candidaturas globais, usar um `candidateId` fornecido pelo
cliente para furar o escopo, nem receber e-mail, telefone, salário ou CV fora
das permissões existentes. A autorização passa por `can()`/`guard()` e pela
checagem de página, como no restante do produto.

## Definição das métricas

| Métrica | Definição |
|---|---|
| Candidaturas únicas | `count(application.id)` no escopo do candidato/recrutador. |
| Enviadas | Candidaturas com `applied_at` preenchido; não contar eventos repetidos. |
| Em andamento | Status não terminal: backlog, shortlisted, preparing, applied, screening, interviewing ou offer. |
| Encerradas | `rejected`, `withdrawn` ou `archived` na candidatura. |
| Etapas | Contagem de `application_event` por `to_status`/`kind`; serve para funil e auditoria, não para duplicar candidaturas. |
| Candidaturas em vaga fechada | Join de `application` com `job.closed_at IS NOT NULL`; nunca excluir do total. |

Contagens começam como consultas/reports sobre as tabelas existentes. Não criar
contadores duplicados até haver evidência de que o volume exige um read model
materializado; se isso acontecer, ele será derivado e reconstruível.

## Rotina operacional

**Produção:** depois do sync/recheck completo, rodar semanalmente a rotina de
arquivamento com dry-run, revisar anomalias e aplicar. A retenção de payloads
brutos permanece separada e segue a [ADR 0019](../adr/0019-retencao-de-payloads-de-ingestao.md).

**Dev/staging:** não executam sync, download, scraping, recheck ou busca de
novas vagas. Usam apenas amostras sintéticas e mocks; a rotina de arquivamento
é validada contra fixtures, nunca contra fonte externa.

**Local:** o runtime atual usa PostgreSQL isolado por `DATABASE_URL`; migrations
usam `DATABASE_MIGRATION_URL`. Um diagnóstico local pode ser executado
explicitamente contra essa instância, com dados descartáveis e sem credenciais
de produção. O SQLite legado não é carregado automaticamente.

## Fora do escopo desta primeira entrega

- envio automático de candidaturas;
- mudança automática de status porque a vaga fechou;
- armazenamento de payload bruto em MongoDB;
- schemas remotos separados de dev/staging no Supabase;
- conversão imediata das consultas em materialized views.

## Critério de sucesso

Será possível arquivar milhares de vagas fechadas sem reduzir a resposta para
“onde e quantas vezes me candidatei”, e o mesmo dado aparecerá para um
recrutador apenas quando sua sessão tiver autorização para vê-lo.
