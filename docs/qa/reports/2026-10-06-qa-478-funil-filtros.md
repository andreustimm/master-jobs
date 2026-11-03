# Execução de QA — 2026-10-06 — #478, filtros do funil (PR #482)

- **Escopo:** filtros de `/pipeline` entregues na PR #482 (já em `dev`):
  texto, "ampliar busca", empresa, canal, faixa de score e estágio combinados,
  estado na URL, contadores por estágio, 375 px, pt-BR e en; canária adjacente
  `PIPE-undo-and-move-back` sobre o funil filtrado.
- **Tier:** targeted
- **Build:** `origin/dev` em `4f62a49a` (merge da PR #482) · **Ambiente:**
  `tests/e2e/run-isolated.mjs --manual` — build de produção standalone
  (`next build --webpack`), PostgreSQL descartável em loopback
  (`jho_test_…`), login real por senha, `SEARCH_SYNONYMS_ENABLED=1` fixo pelo
  harness. Nunca produção. Ambiente removido ao fim da sessão.
- **Início:** 2026-10-06 23:40 BRT · **Status:** closed

## Personas

| Persona | Base | Dispositivo / Rede / Idioma | Sessões |
|---|---|---|---|
| Andreus em triagem noturna | `personas.md` | laptop 1280 px (pt-BR) e celular 375 px (en) / loopback | CH-filter-pipeline |

## Fluxos

- `J-preserve-application-decision` — decidir e reencontrar candidaturas no
  funil sem perder o estado (`../journeys/J-preserve-application-decision.md`)

## Dados

O `setup-manual.ts` cria vagas mas nenhuma candidatura. O funil do dono
(`alex@local.test`, candidato `default`) foi montado pela CLI pública com o
ambiente privado que o runner imprime (`jho track <id> <estágio> --channel`),
porque canal só se grava pela CLI:

| Vaga | Empresa | Score | Estágio | Canal |
|---|---|---:|---|---|
| 13 Senior Software Architect Pessoas (Lisboa) | Pessoas QA Lab | 77 | A fazer | — |
| 1 Senior Software Architect | Aurora Sistemas | 84 | Pré-selecionada | — |
| 8 Staff Engineer Direct Career | Vercel | 76 | Pré-selecionada | direct |
| 7 Staff Engineer Direct Career | Vercel | 83 | Candidatura enviada | direct |
| 9 Go Platform Engineer | Gopher Labs QA | 78 | Candidatura enviada | referral |
| 6 Staff Engineer Anonymous Fixture | Grupo QA | 49 | Candidatura enviada | agency |
| 12 Node.js Backend Architect | Runtime QA Lab | 71 | Triagem | referral |

## Matriz

| # | Charter | Jornada / Cenário | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | CH-filter-pipeline | J-preserve-application-decision / PIPE-filter-applications | Andreus em triagem noturna | Back-Button Tour | Fail | BUG-20261006-pipeline-back-keeps-stale-picker-marks (#492); BUG-20261006-pipeline-swapped-score-fields-stale (#492); BUG-20261006-pipeline-active-stage-invisible; BUG-20261006-primary-button-contrast-dark-theme | |
| 2 | CH-filter-pipeline | J-preserve-application-decision / PIPE-undo-and-move-back (canária) | Andreus em triagem noturna | Back-Button Tour | Pass | | |

Legenda: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Percurso de PIPE-filter-applications

Leitura independente usada: refresh, link aberto numa segunda sessão logada
(375 px, inglês), detalhe da vaga (`/jobs/<id>`) e `jho pipeline` (CLI pública).

### 1. Duas empresas + estágio — pass (com atrito)

Marcar Vercel e Gopher Labs QA e aplicar: `?company=Gopher+Labs+QA&company=Vercel`,
resumo "2 de 6", contadores 3 Todos · 1 Pré-selecionada · 2 Candidatura enviada.
Abrir "2 Candidatura enviada" mostra exatamente 2 linhas (vagas 7 e 9). Após
refresh, marcas, resumo, contadores e lista iguais; `jho pipeline` confirma que
as candidaturas `applied` dessas empresas são 7 e 9. "Limpar" do seletor manteve
`stage=applied`. Atrito: nada na tela marca o estágio escolhido
(BUG-20261006-pipeline-active-stage-invisible, anterior à #478).
Evidência: `01-duas-empresas.png`, `01-seletor-aberto-apos-aplicar.png`.

### 2. Texto — pass (vaga fechada não verificada)

- `Python` (só na descrição) → vagas 1 e 13; contadores 2 · 1 A fazer · 1 Pré-selecionada.
- `Lisboa` (localização) → 13. `Vercel` (empresa) → 7 e 8.
- `"gestão de pessoas"` → 13; `"pessoas de gestão"` → zero, com "Nenhuma
  candidatura com estes filtros." e "limpar filtros".
- Vaga fechada: o ambiente não tem candidatura de vaga fechada e a CLI só fecha
  vaga verificando a URL de origem na rede — **não verificado**.

### 3. "Ampliar busca" — pass (flag desligada não verificada)

`engenheiro` literal → 0. Com "ampliar busca" (`semantic=1`, `aria-current="true"`)
→ 4 linhas "…Engineer" (6, 7, 8, 9), contadores 4 · 1 · 3. `Architekt` (uma letra
trocada) ampliado → as três "Architect" (1, 12, 13); literal → 0. A busca ampliada
continua ligada ao enviar outro termo. Nenhum texto da tela fala em "semântica".
Com `SEARCH_SYNONYMS_ENABLED` desligada: **não verificado** (o runner a liga sempre).
Evidência: `03-ampliar-engenheiro.png`.

### 4. Canal + score + estágio — pass na filtragem, fail nos campos

- `channel=referral` → 9 e 12 (1 Candidatura enviada · 1 Triagem).
- + mínimo 75 → só 9. + estágio Candidatura enviada + canal `direct` →
  7 e 9 (3 Todos · 1 Pré-selecionada · 2 Candidatura enviada; a 12, com 71, sai).
- + máximo 80 → só 9 (2 · 1 · 1).
- Faixa invertida: aviso "O mínimo estava acima do máximo; os dois foram
  trocados." e lista certa. Partindo de `fit=75&fitMax=80` e digitando 80/75,
  os campos ficam 80/75 e o Aplicar seguinte reenvia o par invertido
  (2/2) — BUG-20261006-pipeline-swapped-score-fields-stale. Em `/jobs` o mesmo
  gesto não inverte.
- Candidatura sem nota: todas as vagas do ambiente têm nota — **não verificado**.
- Ruído: o primeiro Aplicar do score gravou `fitMax=` vazio na URL (inofensivo).
Evidência: `04-faixa-invertida.png`, `04-canal-aberto.png`.

### 5. Zero resultado — pass

`?stage=backlog&q=Vercel`: 0 A fazer continua visível ao lado dos outros
contadores, mensagem "Nenhuma candidatura com estes filtros." e "limpar
filtros", que leva a `?stage=backlog` com a vaga 13. Evidência: `05-zero-com-estagio.png`.

### 6. Refresh, voltar e link — fail

- `?q=engenheiro&semantic=1&company=Vercel&stage=applied` montado pela tela;
  refresh mantém campo, busca ampliada, marca, contadores (2 · 1 · 1) e a
  linha 7. A mesma URL numa segunda sessão (375 px, inglês) mostra a mesma
  visão ("1 of 6", 2 · 1 · 1, linha 7). Abrir a linha 7 e voltar mantém tudo.
- Voltar duas vezes leva a `?q=engenheiro&semantic=1` com campo, resumo
  ("todas as empresas") e lista certos, **mas a caixa "Vercel" continua
  marcada**; marcar Gopher e aplicar devolve `company=Gopher+Labs+QA&company=Vercel`.
  Reproduzido em um passo (`?company=Vercel` → voltar), com "limpar" e com o
  seletor de Canal. Em `/jobs` (fontes) os dois caminhos desmarcam —
  BUG-20261006-pipeline-back-keeps-stale-picker-marks, issue #492.
- Campo de texto depois de voltar: segue a URL.
Evidência: `06-voltar-marca-velha.png`.

### 7. 375 px e inglês — pass

Sessão `phone` a 375×812, sem cookie de idioma (inglês): com os seletores de
empresa e canal abertos, `scrollWidth = clientWidth = 375` e nenhum elemento de
`main` passa da borda. Varredura de texto fora de `data-user-content`: único
português é "Português" no menu de idioma. Aviso de faixa trocada, estágio
desconhecido ("Unknown stage; showing the whole pipeline.") e zero resultado
em inglês. Evidência: `07-375-en-seletores-abertos.png`.

## Session Debriefs

### CH-filter-pipeline — Andreus em triagem noturna

- **Ran:** 2026-10-06, sessão de navegador entre 23:45 e 23:56 BRT, após o
  build do ambiente isolado (box de 60 min respeitado)
- **Findings:**
  - Voltar/limpar deixa empresa e canal marcados e o Aplicar seguinte os
    ressuscita — Trust-Damage: a pessoa filtra por uma empresa que desfez.
  - Faixa invertida igual à aplicada: aviso de troca com campos invertidos —
    Trust-Damage: a tela diz uma coisa e mostra outra.
  - Estágio escolhido invisível — Friction (anterior à #478).
  - Contraste 4,34:1 do preenchimento primário no tema escuro — Friction
    (anterior, também em `/jobs`).
- **Bugs filed/updated:** BUG-20261006-pipeline-back-keeps-stale-picker-marks,
  BUG-20261006-pipeline-swapped-score-fields-stale,
  BUG-20261006-pipeline-active-stage-invisible,
  BUG-20261006-primary-button-contrast-dark-theme. Issue #492 cobre os dois
  primeiros.
- **Scenarios settled:** PIPE-filter-applications → fail;
  PIPE-undo-and-move-back → pass (recorte da canária).
- **Paper cuts:** ver tabela.
- **Surprises:** uma vez o clique em "direct" no seletor de canal, logo depois
  de trocar de estágio, foi recusado pelo driver por um nó do controle de score
  por cima; na reabertura não se repetiu (provável janela da transição; não
  registrado como bug). `?fit=abc` é ignorado sem aviso no Funil e em Vagas,
  embora o contrato do Funil diga que parâmetro inválido "vira aviso".
- **Suggested next charter:** reteste de #492 sem refresh entre os passos;
  vaga fechada e candidatura sem nota com fixture própria; busca ampliada com
  a lista de sinônimos desligada.

### Canária PIPE-undo-and-move-back

Com `/pipeline?channel=referral`, abrir a vaga 9, mover para Triagem com a nota
"recrutadora respondeu" e clicar "Desfazer" no aviso: estágio volta a
Candidatura enviada, histórico com "desfazer: de Triagem para Candidatura
enviada" e a linha revertida "desfeito". Mover de novo e desfazer pelo botão
do histórico; após refresh, o histórico tem as quatro linhas, nenhuma some. A
segunda sessão viu o contador filtrado ir a 2 Screening e voltar a 1 Applied +
1 Screening, sem perder `channel=referral`; `jho pipeline` confirma a vaga 9 em
`applied`. Passos 1, 4, 5 e 6 do cenário não foram refeitos.

## Lentes

| Jornada | Usabilidade | Acessibilidade | Desempenho percebido | Compatibilidade | Recuperação de erro | Paridade | Evidência |
|---|---|---|---|---|---|---|---|
| PIPE-filter-applications | friction | friction | pass | pass | fail | pass | bugs acima |
| PIPE-undo-and-move-back (canária) | pass | não medida | pass | pass | pass | pass | seção acima |

- Acessibilidade (axe-core 4.12.1 via `agent-browser a11y`, tema escuro) na URL
  combinada do Funil: `color-contrast` em `pipeline-query-submit` e
  `pipeline-broaden` (4,34:1) e `label-title-only` (best-practice) no campo de
  busca. `/jobs?q=engenheiro` tem as mesmas duas regras, com 9 nós de contraste.
- Recuperação de erro `fail`: voltar e limpar, os caminhos de desfazer um
  filtro, levam ao estado errado no Aplicar seguinte.
- Compatibilidade: só Chromium do `agent-browser`; WebKit e aparelho físico
  não exercitados.

## What Was Fixed

Nada. A sessão é de QA; os defeitos foram registrados e a correção fica na #492.

## Paper Cuts

| Persona | Onde | Sentido | Sharpness | Outcome |
|---|---|---|---|---|
| Andreus | lista do funil | "apliquei hoje e diz 2026-10-07" — `aplicado em` mostra a data UTC; às 23:45 BRT já é o dia seguinte | dull | anterior à #478; watching |
| Andreus | selo de canal | `DIRECT`, `REFERRAL`, `AGENCY` em inglês na interface em português | dull | o cenário trata canal como dado da pessoa; watching |
| Andreus (en) | rótulos | "EMPLOYER" no rótulo e "all companies" no resumo | dull | watching |
| Andreus | zero resultado | o "." depois de "limpar filtros" cai sozinho em outra linha | dull | watching |
| Andreus | URL | primeiro Aplicar do score grava `fitMax=` vazio | dull | watching |

## Runtime Errors Observed

Nenhum erro de página observado nos fluxos percorridos (console não
capturado sistematicamente).

## Human Verifications Needed

Nenhuma perna exigiu humano.

## Decisions for a Human

Nenhuma. Os dois defeitos que impedem o `Pass` viraram a issue #492 (correção
de componente, fora do escopo de uma sessão de QA).

## Learnings

- O `setup-manual.ts` não cria candidatura; o funil vazio precisa ser montado
  pela CLI com o ambiente privado do runner — canal só existe por
  `jho track --channel`. Uma fixture de funil no manual (com vaga fechada e
  candidatura sem nota) fecharia os dois sub-passos não verificados.
- O harness fixa `SEARCH_SYNONYMS_ENABLED=1`; o caminho desligado da busca
  ampliada não é percorrível no ambiente isolado sem mudar o runner.
- Defeito de "campo não segue a URL" só aparece sem refresh: a área E2E que lê
  após `goto` não o pega.

## Final Status

- **Gates:** `pnpm check:qa-tracker`, `pnpm check:instructions` e
  `pnpm check:release-ready` (diff só de Markdown, regra L0); a suíte completa
  fica com o CI da PR. Saídas: `docs/qa/state.csv: 116 scenarios`;
  `Instruções: symlinks dos harnesses, links, âncoras e inventário de regras
  conferem.`; `release-ready version=1.35.0`.
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 0 ·
  Trust-Damage 2 · Friction 2 · Cosmetic 0
- **Coverage:** 1 jornada, 2 cenários; 3 sub-passos não verificados (vaga
  fechada, sem nota, flag desligada); WebKit e aparelho físico fora.
- **Verdict:** not-ready para dar `PIPE-filter-applications` como aprovado —
  os filtros e contadores estão certos, mas voltar ou limpar empresa/canal e a
  faixa invertida deixam campos que contradizem a URL; corrigir a #492 e
  retestar os passos 4 e 6.
