# ADR 0026 — Repontuação de candidato em fatias na web

**Status:** aceita · 2026-09-23 · issue #280 (sobre a varredura fatiada da
[ADR 0025](0025-varredura-fatiada-na-vercel-agendada-pelo-supabase.md), #281)

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
- o agendamento periódico é o `pg_cron` do Supabase chamando fatias de
  `/api/cron/varredura` (ADR 0025); `vercel.json` segue sem `crons`;
- a fatia `pontuar` da ADR 0025 repassa todo candidato a cada dez minutos, mas
  não conclui a tarefa de `score_task` nem registra a recusa — e é a tarefa que
  a tela de candidato lê;
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
3. **Três consumidores, o mesmo código.** O `after()` das ações de currículo
   (salvar, importar PDF, restaurar versão, criar perfil) roda uma fatia de
   `SCORE_SLICE_MS` (20 s) depois da resposta; a fatia **`repontuar`** da
   varredura (`/api/cron/varredura?fatia=repontuar`) drena a fila com o
   orçamento que sobra da chamada; a CLI drena sem prazo.
4. **A continuação é uma fatia da varredura, não uma rota nova.** Mesmo
   segredo e mesma borda (`cronDenied`), métrica em `sweep_run`, agendada a
   cada dois minutos em `supabase/cron/varredura.sql`. Não consulta a política
   de ingestão: só grava nota no banco do próprio ambiente.
5. **Recusa tem estado próprio.** `scoreQueueDisplay` separa `refused` (com o
   motivo `noCv`, `weakCv` ou `emptyCatalog`) de `failed`; a tela diz o motivo e
   quem resolve, pelo dicionário.

## Consequências

- Candidato novo tem a trilha principal na primeira fatia (a derivação vem antes
  de pontuar) e as notas em uma ou poucas fatias. Enquanto o SQL do agendamento
  não for reaplicado em produção, o que não coube na fatia do `after()` espera
  a próxima ação da pessoa ou a CLI — mais devagar, nunca incorreto.
- O prazo é conferido entre lotes: a fatia passa dele por até um lote e uma
  página de leitura, por isso 20 s e não 30.
- Uma função morta no meio deixa claim pendurado por `MINUTOS_CLAIM_MORTO`
  (10 min), que continua valendo porque a CLI sem prazo ainda leva minutos.
- Editar trilha continua só enfileirando: a tela da trilha mostra
  "recalculando, notas anteriores" até o consumidor passar, e o E2E trava esse
  estado. Quem atende é a fatia `repontuar`.
- Toda ação nova que grave currículo precisa chamar
  `scoreAfterResponse()`; `tests/score-slice.test.ts` reprova a que esquecer.

## Alternativas rejeitadas

- **Cron da Vercel a cada poucos minutos:** exige plano pago; no Hobby é diário.
- **Rota própria por segredo:** duplicaria a borda, a métrica e o agendamento
  que a varredura fatiada já tem.
- **Fazer `pontuar` concluir a tarefa:** `pontuar` reserva por candidato e roda
  sem prazo por unidade; a fila tem reivindicação, tentativa e recusa próprias.
- **A função chamar a si mesma em cadeia:** exige mandar o segredo para um
  endereço montado em runtime e um limite de saltos para não virar laço.
- **Pontuar dentro da requisição:** milhares de gravações com a pessoa olhando
  um formulário travado — e estouraria os 30 s.
