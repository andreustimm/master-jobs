# ADR 0025 — Repontuação de candidato em fatias na web, sem cron da Vercel

**Status:** aceita · 2026-09-23 · issue #280 (agendador: #281)

## Contexto

Salvar o currículo enfileira a repontuação do candidato em `score_task`
(ADR 0009). Até aqui o único consumidor era `jho jobs rescore run`, na
varredura diária do GitHub Actions: quem criava o perfil esperava até 24 h pela
trilha principal e pelas notas — ou para sempre, quando a varredura falhava
(23/09/2026, segredo desatualizado). E a derivação que recusa
(`curriculo-fraco`, `sem-curriculo`, `catalogo-vazio`) encerrava a tarefa sem
que a tela dissesse nada além de "falha".

Os limites do lugar onde o produto roda:

- a função da Vercel morre em 30 s (`vercel.json`, plano Hobby);
- o cron da Vercel no Hobby roda **uma vez por dia**, e `vercel.json` não tem
  `crons` de propósito — a reconferência tem um único agendador (B-11,
  `tests/workflow-environment-isolation.test.ts`);
- pontuar o acervo inteiro (~6 mil vagas) para uma trilha custa ~4 s de CPU num
  laptop e ~60 gravações em lote; na Vercel, perto do teto de uma função, e
  mais que isso com várias trilhas.

## Decisão

1. **A pontuação com prazo para entre lotes.** `scoreAll(candidato, { deadline })`
   lê as vagas desatualizadas em páginas por id, grava em lotes de cem e confere
   o prazo depois de cada lote; vencido, devolve `complete: false`. A fatia
   seguinte recomeça pelo que o filtro de staleness ainda aponta — nada é
   refeito. Toda fatia avança ao menos um lote.
2. **Fatia interrompida não é falha.** `runScoreQueue({ budgetMs })` devolve a
   tarefa a `pending` sem contar tentativa e com a soma das notas já gravadas;
   depois do prazo não reivindica outra tarefa.
3. **Três consumidores, o mesmo código.** O `after()` das ações que enfileiram
   de currículo (salvar, importar PDF, restaurar versão, criar perfil) roda
   uma fatia de `SCORE_SLICE_MS` (20 s) depois da resposta; `GET
   /api/cron/score`, protegida por `CRON_SECRET` como `/api/cron/recheck`, roda
   uma fatia para quem a chamar; a varredura e a CLI drenam sem prazo.
4. **O agendador não é da Vercel nem do GitHub.** Quem chama a rota a cada
   poucos minutos é o `pg_cron` + `pg_net` do Supabase (#281). Esta ADR entrega
   a rota e o contrato; o agendamento é da #281. `vercel.json` continua sem
   `crons`.
5. **Recusa tem estado próprio.** `scoreQueueDisplay` separa `refused` (com o
   motivo `noCv`, `weakCv` ou `emptyCatalog`) de `failed`; a tela diz o motivo e
   quem resolve, pelo dicionário.

## Consequências

- Candidato novo tem a trilha principal na primeira fatia (a derivação vem antes
  de pontuar) e as notas em uma ou poucas fatias. Sem o agendador da #281, o que
  não coube na fatia do `after()` espera a próxima ação da pessoa ou a varredura
  diária — mais devagar, nunca incorreto.
- O prazo é conferido entre lotes: a fatia passa dele por até um lote e uma
  página de leitura, por isso 20 s e não 30.
- Uma função morta no meio deixa claim pendurado por `MINUTOS_CLAIM_MORTO`
  (10 min), que continua valendo porque a CLI sem prazo ainda leva minutos.
- Editar trilha continua só enfileirando: a tela da trilha mostra
  "recalculando, notas anteriores" até o consumidor passar, e o E2E trava esse
  estado. Quem atende é a rota por segredo.
- Toda ação nova que grave currículo precisa chamar
  `scoreAfterResponse()`; `tests/score-slice.test.ts` reprova a que esquecer.

## Alternativas rejeitadas

- **Cron da Vercel a cada poucos minutos:** exige plano pago; no Hobby é diário.
- **Cron do GitHub Actions:** o dono pediu processamento fora do Actions (#281);
  o cron do GitHub atrasa sob carga e compete com a varredura pelo mesmo grupo
  de concorrência.
- **A função chamar a si mesma em cadeia:** exige mandar o segredo para um
  endereço montado em runtime e um limite de saltos para não virar laço; o
  agendador externo resolve o mesmo com menos superfície.
- **Pontuar dentro da requisição:** milhares de gravações com a pessoa olhando
  um formulário travado — e estouraria os 30 s.
