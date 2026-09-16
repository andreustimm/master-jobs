# ADR 0021 — Dev e staging usam fixtures, não ingestão real

**Status:** aceita · implementação pendente · 2026-09-16

## Contexto

Dev e staging existem para validar código, migrations, autorização e UI. Não
precisam reproduzir o acervo de produção: o objetivo é ter poucos casos que
cubram os estados relevantes. Rodar sync, download de descrições e scraping
nesses ambientes consome quota, cria dados duplicados e pode publicar conteúdo
externo em um ambiente que deveria ser previsível.

## Decisão

1. Dev e staging remotos recebem apenas uma amostra sintética/versionada e
   mocks/fixtures gerados localmente. Nunca recebem dump bruto de produção.
2. `jobs sync`, `scrape queue/run`, `jobs recheck queue/run`, probes agendados e
   a busca automática de novas vagas ficam bloqueados nesses ambientes.
3. O bloqueio deve existir no scheduler **e** no caso de uso/CLI, por uma
   allowlist explícita de ambiente. Ausência da autorização é fail-closed.
4. Testes de UI, scoring, arquivamento e autorização usam fixtures que cobrem
   vagas abertas, fechadas, arquivadas, reabertas e candidaturas em todos os
   estágios.
5. Local continua usando SQLite/libSQL e pode executar sync somente por ação
   explícita de diagnóstico. Credenciais de produção nunca entram nesse modo.
6. O primeiro projeto Supabase continua com um único schema `production`.
   Dev/staging não serão schemas adicionais no mesmo projeto sem ADR específica
   sobre quota, roles, `search_path` e migrations.

## Consequências

- Menos custo, ruído e risco de dados reais em ambientes de teste.
- Runs de staging deixam de validar conectividade com fontes reais; isso passa a
  ser uma verificação exclusiva de produção/canária controlada.
- Fixtures precisam ser atualizadas quando um estado novo entra no domínio.
- Um guard mal configurado pode bloquear um sync local; por isso o modo local
  explícito precisa emitir diagnóstico claro e não falhar silenciosamente.

## Alternativas rejeitadas

- **Copiar produção inteira para dev/staging:** caro, contém PII e payload bruto,
  e não melhora os testes proporcionalmente.
- **Manter sync remoto com limite informal:** depende de disciplina humana e
  ainda pode consumir quota em uma Action esquecida.
- **Criar três schemas no Supabase Free:** os schemas compartilham compute,
  conexões, egress e limite de banco; não são três projetos independentes.
