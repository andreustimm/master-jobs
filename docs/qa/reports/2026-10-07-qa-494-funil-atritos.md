# Execução de QA — 2026-10-07 — #494, atritos do Funil (PR #499)

- **Escopo:** reteste em persona dos seis ajustes da #494 em
  `PIPE-filter-applications` (contraste do botão primário no escuro herdado do
  sistema, anel e `aria-current` do estágio escolhido, "aplicado em" no fuso de
  quem lê, canal traduzido no selo e no seletor, primeiro Aplicar sem
  `fitMax=`, aviso de `?fit=abc`/`?fitMax=abc`) e canária
  `JOBS-filter-fields-follow-url` em `/jobs` (limpar, preset e faixa invertida
  sem teto vazio na URL; `/jobs?fit=abc` e `/jobs?fitMax=abc`). Sem refresh
  entre os passos; refresh só como leitura independente no fim.
- **Tier:** targeted
- **Build:** `fix/funil-atritos` em `c55f4fe9`. Conferido na cópia do harness
  (`.jho-e2e-Kspoqo/app`) que `app/themes.css` (com `#4d8bff` nos dois blocos
  escuros), `app/pipeline/`, `app/local-date.tsx` e `app/filter-state.ts` são
  idênticos aos da worktree (`diff` sem saída) ·
  **Ambiente:** `tests/e2e/run-isolated.mjs --manual` — build de produção
  standalone, PostgreSQL descartável em loopback, login real por senha
  (`alex@local.test`). Nunca produção. Ambiente encerrado ao fim (runner saiu
  com código 0 e o diretório temporário foi removido).
- **Início:** 2026-10-07 09:55 BRT · **Status:** closed

## Personas

| Persona | Base | Dispositivo / Rede / Idioma | Sessões |
|---|---|---|---|
| Andreus em triagem noturna | `personas.md` | laptop 1280 px e 375 px, `prefers-color-scheme: dark`, Aparência "Sistema", `TZ=America/Sao_Paulo` (pt-BR) / loopback | CH-filter-pipeline (reteste #494) |
| Andreus em triagem | `personas.md` | laptop 1280 px, escuro do sistema (pt-BR) / loopback | canária JOBS-filter-fields-follow-url |

Uma segunda sessão do navegador com `TZ=Pacific/Kiritimati` (UTC+14, en)
serviu só para o "aplicado em" (ver Dados).

## Fluxos

- `J-preserve-application-decision` — decidir e reencontrar candidaturas no
  funil sem perder o estado (`../journeys/J-preserve-application-decision.md`)
- `J-trust-the-filtered-board` — confiar no quadro filtrado de Vagas
  (`../journeys/J-trust-the-filtered-board.md`)

## Dados

Funil montado pela CLI pública com o ambiente privado do runner
(`node --env-file=<runtime.env> src/cli.ts track <id> <estágio> --channel`),
às 09:56 BRT: 13 A fazer; 1 e 8 (direct) Pré-selecionada; 9 (referral), 7
(direct) e 6 (agency) Candidatura enviada; 12 (referral) Triagem.
`jho pipeline` confirmou 1 · 2 · 3 · 1.

**Hora da candidatura:** a CLI carimba `appliedAt` com o relógio da máquina, e
a sessão rodou de manhã: a vaga 9 ficou com `2026-10-07T12:56:27Z` (09:56
BRT). Não deu para gravar uma candidatura às 23:45 BRT. Para exercer o mesmo
mecanismo (dia local ≠ dia UTC), a mesma candidatura foi lida também com o
navegador em `Pacific/Kiritimati`, onde 12:56 UTC já é 8 de outubro.

## Matriz

| # | Charter | Jornada / Cenário | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | CH-filter-pipeline (reteste #494) | J-preserve-application-decision / PIPE-filter-applications | Andreus em triagem noturna | Back-Button Tour | Pass | BUG-20261006-pipeline-active-stage-invisible; BUG-20261006-primary-button-contrast-dark-theme; novos: BUG-20261007-primary-button-hover-contrast-dark, BUG-20261007-job-history-day-in-utc | 891042f; 7415e40 |
| 2 | CH-filter-pipeline (canária) | J-trust-the-filtered-board / JOBS-filter-fields-follow-url | Andreus em triagem | Back-Button Tour | Pass | | |

Legenda: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Percurso de PIPE-filter-applications

Leituras: atributos e estilo computado lidos da página após cada navegação,
auditoria axe-core 4.12.1 (`agent-browser a11y`), capturas e, no fim, link
aberto direto e recarregado. Evidência em
`docs/qa/evidence/2026-10-07-qa-494-funil-atritos/`.

### Tema escuro herdado do sistema — pass

- Antes de entrar no Funil: `prefers-color-scheme: dark` verdadeiro,
  `data-theme="hp"`, e no menu Aparência o botão marcado é "Sistema" (nenhuma
  escolha explícita de Claro/Escuro).
- `/pipeline` → "engenheiro" → Buscar → "ampliar busca" (com canal `referral`,
  mínimo 75 e Candidatura enviada já aplicados):
  `?stage=applied&q=engenheiro&channel=referral&fit=75&semantic=1`. "Buscar" e
  "ampliar busca" (ligado, `aria-current`) com fundo `rgb(77, 139, 255)` e
  texto `rgb(11, 13, 16)`. axe com o ponteiro fora: zero `color-contrast`;
  resta só `label-title-only` (best-practice, já conhecido de 06/10)
  (`03-funil-escuro-sistema-buscar-ampliar.png`).
- `/jobs?q=engenheiro`: 11 elementos com preenchimento primário, todos
  `#4d8bff`/`#0b0d10`; axe com a página assentada: zero `color-contrast`
  (`06-vagas-escuro-sistema-primario.png`). Uma primeira auditoria logo após o
  carregamento acusou 23 nós com cores esmaecidas (nota da vaga, título,
  selos): era a animação de entrada em curso; 3 s depois, zero.
- **Achado novo:** com o ponteiro sobre "Buscar", "ampliar busca" ou o Aplicar
  de Vagas, o hover `bg-primary/80` vira `#4274d2` e o axe dá 4,31:1
  (BUG-20261007-primary-button-hover-contrast-dark, Cosmetic;
  `07-hover-primario-4-31.png`).

### Estágio escolhido — pass

- `/pipeline` sem estágio: só "Todos" com `aria-current="true"` e anel de 2 px
  `rgb(77, 139, 255)`; os outros com o contorno de 1 px.
- Clicar em "3 Candidatura enviada" → `?stage=applied`: o anel e o
  `aria-current` passam para ele; "Todos" perde os dois
  (`01-estagio-escolhido-anel-escuro.png`). Seguem nele depois de canal,
  score, busca e "ampliar busca".
- 375 px em `?stage=applied&channel=referral`: anel visível, `aria-current`,
  `scrollWidth` 375 (`11-funil-375-estagio-escolhido.png`).

### Canal traduzido — pass

- Selos: vagas 9 e 12 "INDICAÇÃO", 7, 8 e 1 "DIRETO", 6 "AGÊNCIA".
- Seletor de canal aberto: caixas "agência", "direto", "indicação"
  (`02-seletor-canal-traduzido.png`). Marcar "indicação" e Aplicar →
  `?stage=applied&channel=referral` (a URL guarda o valor gravado), resumo
  "1 de 3", só a vaga 9.

### Primeiro Aplicar só com mínimo — pass

- Com `?stage=applied&channel=referral`, digitar 75 no mínimo, máximo vazio,
  Aplicar → `?stage=applied&channel=referral&fit=75`, sem `fitMax=`; campos
  75/vazio, controle 75–100.

### `?fit=abc` e `?fitMax=abc` — pass

- `/pipeline?fit=abc`: aviso "O score precisa ser um número de 0 a 100; o
  valor ilegível foi ignorado.", campos vazios (placeholders 0/100), 7 Todos
  (`04-funil-fit-abc-aviso.png`).
- `/pipeline?fitMax=abc`: o mesmo aviso, campos vazios, 7 Todos.

### "Aplicado em" no fuso de quem lê — pass (com substituição de hora)

- `America/Sao_Paulo`: as quatro linhas aplicadas dizem "aplicado em 7 de out.
  de 2026" (`<time datetime="2026-10-07T12:56:…Z">`).
- `Pacific/Kiritimati`, mesma conta e mesmos dados: "applied on Oct 8, 2026"
  nas quatro (`05-aplicado-em-fuso-kiritimati.png`). O dia segue o fuso do
  navegador, não o UTC — o mesmo mecanismo que corrige a candidatura às 23:45
  BRT. A candidatura noturna real não foi gravada (ver Dados).
- **Achado novo:** abrindo a vaga 9 a partir do Funil, em Kiritimati, o
  histórico do detalhe diz "2026-10-07 · registered at Applied" e "first seen
  2026-10-07": o detalhe ficou em UTC e discorda do Funil para o mesmo evento
  (BUG-20261007-job-history-day-in-utc; `10-detalhe-historico-dia-utc-kiritimati.png`).
  Em São Paulo, de dia, as duas telas coincidem.

### Histórico do recrutador — não verificado

`renata@local.test` (recrutadora, sessão em inglês) entra e "Followed" diz "Nobody has
authorised you to follow a pipeline yet." O vínculo só nasce por uma ação do
candidato que ainda não tem tela nem comando na CLI (só o setup do E2E o
cria); `/recruiter/[candidateId]` não foi alcançável em persona. A prova
automática fica com o E2E da PR.

### Leitura independente

`/pipeline?stage=applied&channel=referral&fit=75` aberto direto e recarregado:
só "Candidatura enviada" com `aria-current` e anel, selo "indicação", "7 de
out. de 2026", resumo "1 de 3". O detalhe da vaga 9 mostra "Candidatura
enviada" (estágio confirmado por outra tela).

## Percurso de JOBS-filter-fields-follow-url (canária)

- `/jobs?fit=abc`: aviso de score ilegível, mínimo 45 (corte padrão), máximo
  vazio, 10 vagas (`08-vagas-fit-abc-aviso.png`). `/jobs?fitMax=abc`: o mesmo
  aviso, mínimo 45, máximo vazio, controle 45–100.
- A partir de "Vagas" no menu: Score só com mínimo 50 → `?fit=50`; salário só
  com mínimo 6000 → `?fit=50&pay=6000&cur=USD&per=year`, sem `payMax=`.
- Salário invertido 12000/6000 → aviso "O mínimo estava acima do máximo; os
  dois foram trocados.", campos e controle 6000/12000, máximo do Score vazio e
  fora da URL. Aplicar de novo → `pay=6000&payMax=12000`, sem aviso.
- Score invertido 80/60 → aviso, campos e controle 60/80.
- "Limpar" do salário → `?fit=60&fitMax=80`, campos do salário vazios.
  Aplicar do salário → `?fit=60&fitMax=80&pay=&cur=USD&per=year`; Aplicar do
  Score → `?cur=USD&per=year&fit=60&fitMax=80`. O salário não volta.
- Preset: 70 aplicado (`?unblocked=1&named=1&fit=70`) → "Aplicáveis hoje" →
  `?fit=60&unblocked=1&named=1`, mínimo 60, máximo vazio. Antes, o mesmo preset
  a partir de 60–80 também esvaziou o máximo. Aplicar do Score → `fit=60`, sem
  `fitMax=`.
- Refresh no fim: mesma URL, mínimo 60, máximo vazio, "9 correspondem aos
  filtros." (`09-vagas-preset-sem-teto-vazio.png`).

## Session Debriefs

### CH-filter-pipeline (reteste #494) — Andreus em triagem noturna

- **Ran:** 2026-10-07, 09:56–10:25 BRT, após o build do ambiente isolado (box respeitado)
- **Findings:**
  - Os seis ajustes da #494 aparecem na tela como prometido.
  - Novo, Cosmetic: hover do botão primário no escuro a 4,31:1 — legível,
    transitório, só sob o ponteiro.
  - Novo, Trust-Damage: o histórico do detalhe da vaga mostra o dia em UTC e,
    à noite, discorda do "aplicado em" do Funil. A #494 corrigiu o Funil e
    deixou a outra tela que mostra a mesma data, o que torna a divergência
    visível. Medium/P2 porque a janela é de três horas por dia.
- **Bugs filed/updated:** BUG-20261006-pipeline-active-stage-invisible → verified;
  BUG-20261006-primary-button-contrast-dark-theme → verified;
  BUG-20261007-primary-button-hover-contrast-dark (novo, open);
  BUG-20261007-job-history-day-in-utc (novo, open).
- **Scenarios settled:** PIPE-filter-applications → pass (retest pass);
  JOBS-filter-fields-follow-url → pass.
- **Paper cuts:** o resumo do seletor de canal diz "1 de 3", sem nomear o
  canal escolhido (dull; anterior à #494).
- **Surprises:** a primeira auditoria axe em `/jobs` pegou a animação de
  entrada e acusou 23 nós; reauditada depois de 3 s, limpa. Um clique do
  driver logo após o login caiu numa referência velha (erro do operador, não
  do produto).
- **Suggested next charter:** candidatura gravada de fato entre 21:00 e 23:59
  BRT (ou relógio controlável na CLI) e o histórico do recrutador quando o
  vínculo tiver tela.

### Canária JOBS-filter-fields-follow-url — Andreus em triagem

- **Ran:** 2026-10-07, 10:15–10:22 BRT
- **Findings:** nenhum defeito. Nenhum teto vazio na URL em nenhum caminho.
- **Bugs filed/updated:** nenhum.
- **Scenarios settled:** JOBS-filter-fields-follow-url → pass.
- **Paper cuts:** o Aplicar do salário com o mínimo vazio ainda grava `pay=`
  vazio, com `cur`/`per` (dull; a #494 tratou só o teto).
- **Surprises:** nenhuma.
- **Suggested next charter:** fontes (não refeitas aqui; o hook não mudou nesta PR).

## Lentes

| Jornada | Usabilidade | Acessibilidade | Desempenho percebido | Compatibilidade | Recuperação de erro | Paridade | Evidência |
|---|---|---|---|---|---|---|---|
| PIPE-filter-applications (ajustes da #494) | pass | friction | pass | pass | pass | pass | seções acima; BUG-20261007-primary-button-hover-contrast-dark |
| JOBS-filter-fields-follow-url | pass | pass | pass | pass | pass | pass | seções acima |

- Acessibilidade do Funil: repouso limpo no axe (só `label-title-only`,
  best-practice, conhecido); hover do primário a 4,31:1 → friction.
  `aria-current` no estágio escolhido confirmado.
- Recuperação de erro: `?fit=abc`/`?fitMax=abc` agora avisam nas duas telas em
  vez de ignorar em silêncio.
- Compatibilidade: só Chromium do `agent-browser`, 1280 e 375 px.
- Paridade: build de produção standalone, login real; o histórico do
  recrutador ficou fora (sem caminho público para o vínculo).

## What Was Fixed

Nada nesta sessão. As correções são as de `891042f` e `7415e40` (PR #499); a
sessão retestou.

## Paper Cuts

| Persona | Onde | Sentido | Sharpness | Outcome |
|---|---|---|---|---|
| Andreus | Vagas, faixa salarial | "limpei o salário e a URL ainda leva `pay=` vazio" | dull | watching |
| Andreus | Funil, seletor de canal | "o seletor diz '1 de 3', não qual canal" | dull | watching |

## Runtime Errors Observed

Nenhum erro: `agent-browser errors` vazio. `console` só com 7 avisos
"Couldn't load preload assets" (sem efeito visível; também nas sessões
anteriores do ambiente isolado).

## Human Verifications Needed

- [ ] Gravar uma candidatura entre 21:00 e 23:59 em São Paulo
  (`jho track <id> applied`) e conferir em `/pipeline` que "aplicado em" diz o
  dia de São Paulo (linha 1). O mecanismo foi provado com outro fuso; a hora
  real não era controlável nesta sessão.
- [ ] Quando o vínculo recrutador↔candidato tiver tela, conferir "aplicado em"
  em `/recruiter/<candidateId>` no mesmo cenário noturno (linha 1).

## Decisions for a Human

### Histórico da vaga em UTC (BUG-20261007-job-history-day-in-utc)
- O que quebra: o detalhe da vaga mostra o dia em UTC e, à noite, discorda do
  Funil (`10-detalhe-historico-dia-utc-kiritimati.png`).
- Por que não corrigido aqui: fora do escopo da PR #499 e esta sessão não
  edita código.
- Opções: 1. levar o `LocalDate` também ao histórico e ao "visto em" de
  `/jobs/[id]` nesta PR — fecha a divergência que a própria PR expõe, ao custo
  de ampliar o diff; 2. issue própria — PR atual fica enxuta, a divergência
  fica conhecida até lá.
- Recomendação: opção 2, com a issue citada na PR #499.

## Learnings

- `TZ=<zona>` no comando que sobe a sessão do `agent-browser` muda o fuso do
  Chromium (`Intl…timeZone` confirma); um fuso com dia diferente do UTC
  substitui a candidatura noturna quando a hora não é controlável.
- Auditar o axe só com a página assentada e o ponteiro fora dos controles; com
  o ponteiro em cima, a auditoria mede o hover.
- O FIFO como stdin do `run-isolated.mjs --manual`, com um escritor mantido
  aberto e `echo` no fim, encerra o ambiente com limpeza.

## Final Status

- **Exit gate:** sessão de QA sobre PR com código já validado pelo autor; a
  suíte completa fica com o CI da PR #499 (não rodada aqui).
  `pnpm check:qa-tracker` rodado após a atualização dos arquivos de QA (saída
  na entrega).
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 0 ·
  Trust-Damage 1 aberto (BUG-20261007-job-history-day-in-utc, fora do diff) ·
  Friction 0 abertos (2 verificados) · Cosmetic 1 aberto
  (BUG-20261007-primary-button-hover-contrast-dark)
- **Coverage:** 2 jornadas, 2 cenários; os seis ajustes da #494 e os caminhos
  da canária. Fora: candidatura gravada de fato à noite (substituída por outro
  fuso), histórico do recrutador, passos 1, 2, 3, 5 e 7 do Funil além do que os
  ajustes tocam, inglês, WebKit e aparelho físico.
- **Verdict:** ready-with-blocked-items — a #494 está corrigida em persona;
  os dois achados novos não bloqueiam e os itens humanos são a candidatura
  noturna real e o recrutador.
