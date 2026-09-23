# ADR 0025 — Varredura fatiada na Vercel, agendada pelo `pg_cron` do Supabase

**Status:** aceita · ativação pendente de passo humano · 2026-09-23 · issue #281

## Contexto

A varredura de vagas rodava uma vez por dia no GitHub Actions
(`.github/workflows/varredura.yml`, 06:00 UTC). Em 23/09/2026 ela levou ~57
minutos: o runner fica nos EUA e o banco em São Paulo, e cada consulta paga
uma ida e volta. O dono pediu varredura **pelo menos de hora em hora**,
processada na Vercel — onde a função roda em `gru1`, ao lado do banco.

Duas restrições medidas do plano Hobby da Vercel mandam no desenho:

- cron nativo no máximo **1×/dia** — não serve para agendar de hora em hora;
- função com teto de **30 s** — o sync inteiro não cabe numa chamada.

A #269 tinha tirado a reconferência da Vercel pelo mesmo teto, e fixado por
teste que ela tem **um único agendador** (dois sobre a mesma fila dobravam as
requisições a terceiros sem que um soubesse do outro, B-11). Esta ADR muda o
agendador; a regra de ser um só continua.

## Decisão

1. **Trabalho em fatias de menos de 25 s.** `GET /api/cron/varredura?fatia=…`
   executa uma fatia por chamada, com orçamento de 20 s
   (`SWEEP_BUDGET_MS`): `sync`, `termos`, `captura`, `reconferencia`,
   `pontuar`. Uma fatia só **começa** uma unidade que caberia pelo tempo da
   mais lenta até ali; unidade começada não é interrompida.
2. **Sync por fonte, round-robin.** A fatia `sync` escolhe a fonte com a
   tentativa mais antiga (nunca tentada primeiro) e segue enquanto couber.
   Cada fonte é sincronizada no máximo a cada 45 min — teto de custo por
   fonte, qualquer que seja a cadência do agendador.
3. **Reserva por unidade, com prazo.** `sweep_lease` guarda uma reserva por
   fonte (`sync:<id>`) e por candidato (`pontuar:<id>`), tomada por um único
   `INSERT … ON CONFLICT DO UPDATE … WHERE` — com N chamadas simultâneas, uma
   vence. Reserva de função morta vence em 5 min; a tentativa conta para a
   ordem, então uma fonte que mata a função vai para o fim da fila em vez de
   matar todas as chamadas seguintes. As filas existentes (`verify_task`,
   `scrape_task`, `term_capture`) já reservam por linha.
4. **Agendador: `pg_cron` + `pg_net` no Supabase.** O SQL versionado
   (`supabase/cron/varredura.sql`) agenda as cinco fatias; o segredo vem do
   Supabase Vault, nunca do arquivo. Nem Vercel Cron nem GitHub Actions
   horário.
5. **Um contrato de autorização para `/api/cron/`.** `authorizeCronRequest`
   (contexto de autenticação, pura) decide o segredo `CRON_SECRET` em tempo
   constante; `app/api/cron/authorize.ts` é a borda comum (`cronDenied`,
   `ingestionDenied`). Toda rota de `/api/cron/` recusa pelo segredo antes do
   primeiro `await` — travado por `tests/architecture.test.ts`, que descobre
   as rotas em vez de listá-las.
6. **Métrica e alarme.** `sweep_run` guarda uma linha por chamada e uma por
   unidade (duração, itens, erros; só números e ids), por 14 dias. Fonte há
   mais de 2 h sem sync gera alarme (log da função sempre; Sentry quando há
   DSN), no máximo uma vez por hora.
7. **GitHub Actions vira rede de segurança.** Até a troca, a execução diária
   segue como está. Depois dela, o dono define `VARREDURA_AGENDADOR=supabase`
   nas variáveis do repositório e o disparo agendado de `varredura.yml` não
   faz nada; o disparo manual (tela de operações) continua. A qualquer momento
   há um só agendador ativo.

As invariantes de sempre continuam: guarda de ingestão (ADR 0021) antes de
qualquer rede de terceiro — e a fatia `pontuar`, que não toca terceiros, é a
única que roda sem ela; ingestão nunca escreve em `application` (regra 2); só
404/410 fecham vaga; erro de uma fonte vira linha de métrica e a próxima segue;
o livro de cota por plataforma vale também para a fonte sincronizada na fatia.

## Consequências

- **Boas.** Cada fonte revisitada a cada ≤ 60 min; vaga nova pontuada para
  todo candidato em ~10 min; o trabalho roda ao lado do banco; a cadência é
  provável por SQL (`sweep_run`).
- **Custo a medir.** São ~60 chamadas por hora. Chamada sem trabalho devido
  responde em milissegundos, mas o plano Hobby limita CPU ativa e memória
  provisionada por mês. A cadência mora no SQL e o intervalo por fonte no
  domínio; depois das primeiras 24 h, conferir o painel *Usage* da Vercel e
  ajustar antes de o limite decidir por nós.
- **Fonte grande demais.** Uma fonte que sozinha passa de 30 s é morta a cada
  tentativa. A reserva a manda para o fim da fila e o alarme de 2 h a mostra;
  a correção é no adapter (paginação), não no agendador.
- **Ativação é passo humano** (runbook em `docs/operations.md`): extensões,
  dois segredos no Vault, `CRON_SECRET` e `JHO_SOURCE_ALLOWLIST` na Vercel, o
  SQL, a variável do repositório.

## Alternativas rejeitadas

- **Vercel Cron.** 1×/dia no Hobby; não atende "de hora em hora".
- **GitHub Actions a cada hora.** Continua do outro lado do continente — 57 min
  de latência não viram 60 execuções por dia — e o dono quer o processamento
  na Vercel.
- **Uma rota que roda tudo até o teto.** Sem reserva por unidade, duas chamadas
  sobrepostas sincronizariam as mesmas fontes, e a fonte lenta sempre primeiro
  mataria toda chamada.
- **Supabase Queues/PGMQ ou Upstash QStash como agendador.** Fila não é
  relógio; a ADR 0009 continua valendo para o transporte, e `pg_cron` já vem
  no mesmo banco.
