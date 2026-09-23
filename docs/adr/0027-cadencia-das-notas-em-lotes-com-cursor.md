# ADR 0027 — Cadência das notas: duas filas, lotes de cem e cursor

**Status:** aceita · ativação pendente de passo humano · 2026-09-23 · issue #288
(sobre a [ADR 0025](0025-varredura-fatiada-na-vercel-agendada-pelo-supabase.md)
e a [ADR 0026](0026-fila-de-repontuacao-em-fatias-na-web.md))

## Contexto

Depois da #285 e da #286, a nota de cada candidato era mantida por três
caminhos: o `after()` de quem salva o currículo, a fatia `repontuar` (fila
`score_task`, a cada 2 min) e a fatia `pontuar` (a cada 5 min, cada candidato no
máximo a cada 10). Esta última não distinguia quem acabou de entrar de quem já
tem nota, rodava `scoreAll` sem prazo dentro de uma função de 30 s, e percorria
o acervo em ordem de id — as vagas mais antigas ganhavam nota primeiro.

O dono pediu (23/09/2026):

1. candidato **sem nota** processado **a cada 10 min** até ficar completo;
2. candidato **com nota** repontuado **de hora em hora**;
3. a primeira carga ao salvar o CV continua em tempo real, no `after()`;
4. tudo em fila, em **lotes de 100 vagas, das mais recentes para as mais
   antigas**, sem onerar o sistema;
5. e tudo isso **só em produção**.

## Decisão

1. **A passada em lotes com cursor.** `scoreAll` percorre as vagas abertas por
   `coalesce(posted_at, first_seen_at)` decrescente (id decrescente no empate),
   em lotes de `SCORE_BATCH` = 100, só as sem nota ou com nota desatualizada.
   Depois de cada lote grava em `score_cursor` (uma linha por candidato e
   trilha) a posição da última vaga lida; a chamada seguinte retoma dela. Lote
   incompleto fecha a passada: posição nula (a próxima começa do topo) e
   `last_completed_at`. As regras são puras, em `src/core/scoring/batch.ts`.
2. **Perfil novo recomeça do topo.** O cursor guarda o `profile_hash` e a
   `scorer_version` da passada; se mudaram, a posição não vale e a passada
   recomeça pela vaga mais recente. É o que faz o currículo salvo agora ter as
   cem mais recentes com nota primeiro, em vez de esperar o fim de uma
   manutenção que estava no meio do acervo.
3. **Prazo por previsão, não por atraso.** Com prazo, só começa um lote que
   caberia pelo mais lento até ali; o primeiro lote que leu vagas sempre
   começa (toda chamada avança). Leitura vazia — trilha já em dia — não gasta
   esse primeiro lote. Sem prazo (CLI), uma passada retomada do meio é seguida
   de outra do topo, para a vaga nova acima do cursor não ficar para depois.
4. **Duas filas, duas fatias.** `sem-nota`: candidato cuja trilha principal
   nunca completou uma passada (inclui quem ainda não tem trilha ou currículo:
   a unidade deriva o perfil, recusa sem gravar e tenta na agenda seguinte).
   `manutencao`: quem já completou. A fila é `scoreQueueOf(last_completed_at)`.
   Mudar o currículo não devolve ninguém a `sem-nota` — quem já tem nota é
   atendido pela fila `score_task` e pela manutenção.
5. **Cadência na agenda, intervalo no domínio.** O `pg_cron` chama `sem-nota`
   a cada 10 min (`5-55/10`) e `manutencao` de hora em hora (minuto 11). Por
   candidato, o intervalo mínimo é a cadência menos 1 min de folga
   (`SCORE_QUEUE_MIN_INTERVAL_MS`): a agenda nunca é recusada pelo atraso do
   `pg_net`, e uma chamada extra no meio não repete o candidato. A reserva em
   `sweep_lease` é `pontuacao:<candidato>`, comum às duas filas.
6. **Teto de 20 s por chamada.** O prazo passado à unidade é o fim do orçamento
   da chamada (`SWEEP_BUDGET_MS`); o candidato que pega a fatia usa o orçamento
   em lotes, e o seguinte só começa se ainda couber. A métrica fica em
   `sweep_run`, uma linha por chamada e uma por candidato.
7. **O `after()` usa o mesmo código.** `runScoreQueue` chama `scoreAll`, então
   a fatia de quem salvou o currículo e a fatia `repontuar` seguem o mesmo
   lote, a mesma ordem e o mesmo cursor.
8. **A fatia `pontuar` sai.** A rota responde 400 para ela, e reaplicar
   `supabase/cron/varredura.sql` remove a agenda `jho-varredura-pontuar`.
9. **Varredura só em produção.** A rota `/api/cron/varredura` responde 503 sem
   trabalhar, em toda fatia, quando `JHO_ENV`/`VERCEL_ENV` não declaram
   `production` (todas as declarações presentes precisam concordar:
   `JHO_ENV=production` não promove um preview). O SQL do agendador recusa
   aplicar em projeto cujo Vault não aponte para `https://jobs.mastertimm.com.br`.
   O `after()` do salvar-CV é produto, não agendamento, e roda em qualquer
   ambiente.

Nada disso muda a rubrica: `SCORER_VERSION` fica como está. Nota ausente
continua neutra na UI (#279), e nada aqui escreve em `application`.

## Consequências

- **Boas.** Candidato novo vê as cem vagas mais recentes com nota na primeira
  fatia do `after()`, e o resto em poucas fatias de 10 min. A manutenção de
  hora em hora pega vaga nova, nota de perfil antigo e frescor vencido. O
  tempo até o primeiro lote, até completo e o atraso da manutenção são
  consultáveis em `score_cursor` (runbook em `docs/operations.md`).
- **Vaga nova durante uma passada.** Uma vaga que entra acima do cursor
  enquanto a passada desce fica para a próxima passada — no máximo a
  manutenção seguinte. Com prazo não se abre uma segunda passada na mesma
  chamada, para a chamada terminar em tempo previsível.
- **Trilha aceita relê o que está fora do alvo.** A vaga fora do alvo nunca
  ganha linha, então toda passada a relê; o cursor garante que isso avança e
  termina. Custa leitura e CPU, não gravação.
- **Candidato legado passa uma vez por `sem-nota`.** Quem já tinha nota antes
  desta versão não tem cursor; a primeira passada completa, quase toda de
  leitura, o move para a manutenção.
- **Dois consumidores no mesmo candidato** (a fila `score_task` e uma fatia da
  agenda) não se excluem: repetem trabalho idempotente, e o cursor pode recuar
  um lote. Não há perda.
- **Ativação é passo humano:** a migração `0017_score_cursor` e reaplicar o SQL
  no projeto Supabase de produção.

## Alternativas rejeitadas

- **Sem cursor, só o filtro de nota desatualizada.** Serve à trilha principal,
  mas a vaga fora do alvo de uma trilha aceita nunca sai do filtro: cada
  chamada releria o mesmo lote para sempre.
- **Cursor em `sweep_lease`.** A reserva é da unidade da varredura; o cursor é
  da trilha e também serve à fila `score_task` e à CLI. Misturar os dois
  prenderia o `after()` à tabela da varredura.
- **Cadência só no domínio, com o `pg_cron` chamando a cada poucos minutos.**
  Funciona, mas o dono pediu a cadência na agenda, onde se lê em `cron.job`;
  o domínio fica com o intervalo mínimo por candidato, que protege de chamada
  extra.
- **Guardar a primeira nota por `job_score.scored_at`.** Toda repontuação
  reescreve `scored_at`; o primeiro lote e a primeira passada completa só
  sobrevivem em colunas próprias (`score_cursor.created_at`,
  `first_completed_at`).
