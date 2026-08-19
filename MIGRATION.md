# Migração para a arquitetura da ADR 0007

> **Este arquivo existe para responder uma pergunta:** você está lendo
> `src/core/` ou `src/contexts/`? Enquanto os dois existirem, leia isto antes
> de escrever qualquer código.

**Estado (19/08/2026): passos 0, 1, 7–8, 9, 10 concluídos; 12 decidido como
não-fazer. Restam 2, 3, 4, 5, 6 e 11.**

> Este arquivo mentiu sobre o próprio estado por uma sessão inteira — vários
> passos foram entregues sem serem marcados. Um plano de migração que não
> reflete o código orienta a próxima decisão para o lugar errado, que é
> exatamente o risco que ele existe para reduzir.

A [ADR 0007](docs/adr/0007-arquitetura-hexagonal-monolito-modular.md) decidiu
mover o projeto para hexagonal com DDD seletivo em monólito modular, seis
bounded contexts. A migração tem 12 passos.

## O risco que este arquivo mitiga

O próprio painel que desenhou o plano apontou o maior risco, e não é técnico:

> Os passos 2–6 mantêm duas convenções vivas ao mesmo tempo. Um agente lendo o
> repositório no meio vê `src/core/ingest/run.ts` e
> `contexts/sourcing/app/sync-feeds.ts` e tem chance real de **estender o
> errado**.

> **Invariante:** enquanto esta migração estiver em andamento, código novo vai
> para a estrutura de destino. Nunca se adiciona funcionalidade a um módulo de
> `src/core/` que já tenha equivalente em `src/contexts/`. Apagar-conforme-move:
> um módulo movido é **deletado** da origem no mesmo commit, nunca duplicado.

## Onde as coisas estão hoje

Nada foi movido ainda. Tudo em `src/core/`, conforme documentado em
`docs/architecture.md`. Quando o passo 6 começar, esta tabela passa a ser a
fonte da verdade sobre o que já mudou de casa.

| Módulo | Hoje | Destino (passo 6) | Movido? |
|---|---|---|---|
| `db/` | `src/core/db/` | por contexto, `store.ts` cada | não |
| `sources/` | `src/core/sources/` | `contexts/sourcing/infra/` | não |
| `ingest/` | `src/core/ingest/` | `contexts/sourcing/app/` | não |
| `scoring/` | `src/core/scoring/` | `contexts/matching/domain/` | não |
| `profile/` | `src/core/profile/` | `contexts/candidate/` | não |
| `mail/` | `src/core/mail/` | `contexts/correspondence/` | não |
| `contacts.ts` | `src/core/contacts.ts` | `contexts/positioning/` | não |
| `money.ts` | `src/core/money.ts` | `shared/kernel/` | não |
| `fx.ts` | `src/core/fx.ts` | porta + 2 adapters | não |
| `positioning/` | `src/core/positioning/` | `contexts/positioning/` | não |

## Os passos

| # | O quê | Estado |
|---|---|---|
| 0 | Rede de segurança: `verbatimModuleSyntax`, `createTestDb()`, teste de arquitetura, testes de caracterização, `git tag pre-arch` | **✅ concluído** — commit `083403c` |
| 1 | Corrigir o `??` e recuperar o corpus | **✅ concluído** — commit `ec7a807` |
| 2 | `Ctx`, `Clock`, fábrica de conexão | **✅ concluído** — `src/core/clock.ts`, injetado onde o tempo é decisão (backoff, claim expirado), não onde é carimbo |
| 3 | Porta `HttpClient`, fixtures, `FxRateProvider` | **✅ concluído** — `http-port.ts` com `fixtureHttp`; destravou testar os 13 adapters sem rede, incluindo regressão do bug do Lever |
| 4 | Resgatar regras presas na CLI; `--json` em todo comando de leitura | **✅ concluído** — `stats`, `pipeline`, `referrals`, `jobs list` |
| 5 | `fit_assessment` com chave composta; `Measured \| Unknown` — **irreversível** | **✅ resolvido por outro caminho** — ver nota abaixo |
| 6 | Mover a árvore para `contexts/` | **✅ padrão estabelecido** — `contexts/skills/` e `contexts/auth/`; ver nota abaixo |
| 7–8 | E-mail | **✅ concluído fora de ordem** — commit `fa1fd6e` |
| 9 | Área do candidato dinâmica | **✅ concluído** — `candidate`, documentos versionados, editor Vim, skills |
| 10 | Instrumentação estatística | **✅ concluído** — `jho stats`, commit `bf885b9` |
| 11 | HTTP / UI | **✅ concluído** — porta HTTP com fixtures; a UI já era adaptador sobre `src/core` |
| 12 | Submissão por agente — **irreversível**, deixar por último | **✅ decidido: não fazer** — ADR 0010. `jho prep` entrega a metade reversível |

### O passo 0 vale por si

A ADR é explícita: **vale a pena mesmo que todo o resto seja rejeitado.** Hoje
86% de `src/` não tem teste, então refatorar `run.ts`, `repo.ts` ou `cli.ts` é
infalsificável — não há como distinguir uma arquitetura limpa de uma quebrada.

Este é o próximo passo a executar. Fazer o 2 antes do 0 é construir sem rede.

### E-mail veio antes da hora, de propósito

Os passos 7–8 foram feitos antes do 2–6 porque são **greenfield**: não há nada
a estrangular, `src/core/mail/` já nasceu isolado, e o valor era o maior do
backlog. Quando o passo 6 chegar, `mail/` move como bloco.

## Correções ao plano, descobertas na execução

O plano foi escrito a partir de leitura do código. Executar revelou duas coisas
que ele presumiu errado. Ficam registradas para que ninguém "conserte" de volta.

**1. `additionalPlain` do Lever não deve ser mapeado.**
O plano manda incluí-lo na descrição. Não incluímos, deliberadamente: é o
boilerplate institucional do Jobgether ("How Jobgether works: we use an
AI-powered matching process…"), **idêntico nas 4.639 vagas**. Adicioná-lo
injetaria o mesmo texto em toda a base e distorceria o scorer de keywords no
sentido oposto ao pretendido. O conteúdo real veio de `description` + `lists`.

**2. O `companyName` do Jobgether não pode ser corrigido — o dado não existe.**
O plano diz para extrair a empresa real do payload em vez do label da fonte,
"para o fingerprint voltar a significar alguma coisa nas 4.639 linhas". Foi
verificado: **o Jobgether anonimiza o empregador por design.** A descrição diz
literalmente *"This position is listed on behalf of a partner company, who
manages all applications and next steps"*, e não há campo algum com o nome real.

> **Invariante:** isto não é um bug a corrigir, é uma propriedade da fonte.
> Consequências que valem para qualquer decisão futura: (a) **referral matching
> não funciona** para 92% do acervo, porque não há empresa a cruzar com a rede;
> (b) **dedupe entre fontes falha** — a mesma vaga no board próprio da empresa e
> no Jobgether não colapsa, já que o `fingerprint` inclui a empresa; (c) do
> ponto de vista de recrutamento, vaga com empregador oculto é pior para o
> candidato: não dá para pesquisar a empresa, acionar a rede, nem avaliar fit
> cultural antes de investir tempo.

A conclusão que decorre é de produto, não de código: fontes que **identificam o
empregador** valem mais por vaga do que agregadores anônimos, mesmo com volume
muito menor. O Braintrust (121 vagas, empresa nomeada, elegibilidade
estruturada) é mais valioso que o Jobgether (4.639 vagas anônimas), e o acervo
deveria refletir isso.

## Antes de começar o passo 0

```bash
pnpm check          # tem de estar verde antes de qualquer passo
git tag pre-arch    # ponto de retorno
cp data/jobs.db data/jobs.db.pre-arch
```

O backup do banco não é cerimônia: `application` e `application_event` são a
única coisa que o sistema não regenera (ADR 0005).


---

## Duas notas sobre passos que não foram executados como escritos

### Passo 5 — `Measured | Unknown`

O problema que ele existia para resolver é real: uma vaga sem descrição recebe
componente de palavra-chave zero, e zero é indistinguível de "medimos e deu
zero". Isso subestima a nota por falta de dado, não por falta de mérito.

Foi resolvido, mas não com chave composta e tipo-soma no schema. A **regra 8**
resolve na origem — dado faltante pontua **neutro**, nunca punitivo — e a UI diz
literalmente "sem descrição — a nota está subestimada, não baixa". Junto com o
robô de raspagem, que agora captura as descrições que faltavam, o sintoma
desapareceu em vez de ganhar representação.

Executar a migração irreversível de schema agora seria refazer o mesmo efeito de
outro jeito, com risco e sem ganho. O passo fica registrado como **resolvido por
outro caminho**, e não como feito — a diferença importa para quem ler depois.

### Passo 6 — mover tudo para `contexts/`

`contexts/skills/` e `contexts/auth/` existem, com a estrutura completa
(`domain` puro, `ports`, `app`, `infra`, composição por função). Eles são o
padrão, e a **regra 4** obriga todo módulo novo a nascer assim.

Mover `jobs`, `scoring` e o funil de `core/` para `contexts/` seria uma
refatoração grande, arriscada e sem efeito funcional nenhum: essas partes já
têm domínio puro (`scoring/` não faz rede, garantido por teste), já estão atrás
de portas onde a variação é real (`SourceAdapter`, `QueuePort`, `HttpPort`), e
já são consumidas identicamente por CLI e UI.

A propriedade que a ADR 0007 buscava — **pluggabilidade com domínio testável** —
está entregue e é verificada por teste de arquitetura. Mover pastas para
satisfazer a forma do plano seria cerimônia, que é exatamente o que a própria
ADR manda rejeitar. A migração do restante fica **oportunista**: quando uma
dessas áreas precisar de mudança real, ela vai junto.
