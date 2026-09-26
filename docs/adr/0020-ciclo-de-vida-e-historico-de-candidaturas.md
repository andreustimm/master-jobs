# ADR 0020 — Arquivamento de vagas preserva candidaturas

**Status:** aceita · implementação pendente · 2026-09-16

## Contexto

O sistema ingere fatos mutáveis de fontes externas e registra decisões do
usuário em `application`/`application_event`. Uma vaga pode desaparecer da
fonte depois de uma candidatura. Excluir a linha para economizar espaço quebra
o histórico, métricas de funil e documentos associados. Manter tudo no board
ativo também torna a triagem impraticável.

## Decisão

1. `job.closed_at` continua sendo o fato de que a vaga foi fechada; o sync não
   muda decisões de candidatura.
2. Introduzir, em uma migration futura, `job.archived_at` nullable como estado
   operacional separado. Arquivar esconde da superfície ativa e não apaga a
   vaga.
3. O arquivamento automático exige fechamento confirmado e usa 90 dias como
   default configurável. Deve ser idempotente e ter dry-run.
4. Qualquer `application` impede poda física da vaga. A vaga pode estar
   arquivada no acervo, mas continua no histórico do candidato e do recrutador
   autorizado.
5. `application.status` permanece sob decisão humana. Fechar/arquivar a vaga
   não marca a candidatura como rejeitada, retirada ou arquivada.
6. Métricas começam por consultas sobre `application` e `application_event`:
   contagem de candidaturas é distinta da contagem de transições/eventos.
   Emenda (#316): candidatura `untracked` — desfeita até o primeiro registro —
   não conta como candidatura, mas continua sendo `application` para o item 4:
   a vaga segue protegida da poda. Leitura por evento ignora os revertidos
   (`reverts_event_id`).
7. Reabertura por observação `alive` limpa o arquivamento automático e preserva
   a mesma identidade/fingerprint.

## Consequências

**Positivas:** histórico de candidaturas não é destruído; o board ativo fica
menor; o candidato e o recrutador autorizado obtêm métricas auditáveis; a
retenção física continua conservadora.

**Custos:** uma coluna/migration e índices adicionais; duas noções de estado
precisam aparecer claramente na UI; queries de relatório devem aplicar o
escopo de autorização antes de agregar.

## Alternativas rejeitadas

- **Apagar toda vaga fechada:** perde candidatura e documentos.
- **Usar `application.status = archived` para arquivar a vaga:** mistura o
  ciclo de vida da fonte com a decisão do candidato.
- **Manter contadores incrementais em `candidate`:** podem divergir de
  `application_event` e são desnecessários no volume atual.
- **Mover dados brutos para Mongo como primeira resposta:** adiciona um banco,
  segredo e retenção sem resolver a separação entre fato e decisão; ver o
  registro da sessão e a ADR 0019.
