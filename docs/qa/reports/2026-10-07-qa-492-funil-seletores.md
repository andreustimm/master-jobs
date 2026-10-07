# Execução de QA — 2026-10-07 — #492, seletores e faixa de score seguem a URL (PR #496)

- **Escopo:** reteste em persona dos passos 4 (canal + score + estágio, faixa
  invertida) e 6 (voltar, avançar, limpar empresa e canal) de
  `PIPE-filter-applications` depois da correção da #492, e canária do hook
  compartilhado `useAppliedValue` em `/jobs` (`JOBS-filter-fields-follow-url`).
  Tudo sem refresh entre os passos; refresh só como leitura independente no fim.
- **Tier:** targeted
- **Build:** `fix/funil-seletores` em `6c551e69` (contém `961558d`; conferido
  na cópia do harness que `app/auto-submit.tsx` traz a correção) ·
  **Ambiente:** `tests/e2e/run-isolated.mjs --manual` — build de produção
  standalone (`next build --webpack`), PostgreSQL descartável em loopback,
  login real por senha. Nunca produção. Ambiente encerrado ao fim (runner saiu
  com código 0 e o diretório temporário foi removido).
- **Início:** 2026-10-07 00:00 BRT · **Status:** closed

## Personas

| Persona | Base | Dispositivo / Rede / Idioma | Sessões |
|---|---|---|---|
| Andreus em triagem noturna | `personas.md` | laptop 1280 px (pt-BR) / loopback | CH-filter-pipeline (reteste) |
| Andreus em triagem | `personas.md` | laptop 1280 px (pt-BR) / loopback | canária JOBS-filter-fields-follow-url |

## Fluxos

- `J-preserve-application-decision` — decidir e reencontrar candidaturas no
  funil sem perder o estado (`../journeys/J-preserve-application-decision.md`)
- `J-trust-the-filtered-board` — confiar no quadro filtrado de Vagas
  (`../journeys/J-trust-the-filtered-board.md`)

## Dados

Mesmo funil do relatório `2026-10-06-qa-478-funil-filtros.md`, montado pela
CLI pública com o ambiente privado do runner (`jho track <id> <estágio>
--channel`): 13 A fazer; 1 e 8 (direct) Pré-selecionada; 7 (direct), 9
(referral) e 6 (agency) Candidatura enviada; 12 (referral) Triagem.

## Matriz

| # | Charter | Jornada / Cenário | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | CH-filter-pipeline | J-preserve-application-decision / PIPE-filter-applications (passos 4 e 6) | Andreus em triagem noturna | Back-Button Tour | Pass | BUG-20261006-pipeline-back-keeps-stale-picker-marks (#492); BUG-20261006-pipeline-swapped-score-fields-stale (#492) | 961558d |
| 2 | CH-filter-pipeline (canária) | J-trust-the-filtered-board / JOBS-filter-fields-follow-url | Andreus em triagem | Back-Button Tour | Pass | | |

Legenda: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Percurso de PIPE-filter-applications

Leituras: estado das caixas, campos e lista lidos da página após cada
navegação, capturas e, no fim, refresh.

### 6. Voltar, avançar e limpar — pass

- `/pipeline` → Empresa → Vercel → Aplicar (`?company=Vercel`, "1 de 6", 2
  Todos). Voltar: URL `/pipeline`, "todas as empresas", 7 linhas e **nenhuma
  caixa marcada** (`06-voltar-empresa-desmarcada.png`). Marcar Gopher Labs QA
  e Aplicar → `?company=Gopher+Labs+QA`, 1 linha — a Vercel não volta.
- Voltar → nada marcado; Avançar → só Gopher marcada, 1 linha.
- Gopher + Vercel aplicadas ("2 de 6", 3 linhas) → "limpar" → nada marcado,
  7 linhas; Aurora Sistemas → Aplicar → `?company=Aurora+Sistemas` sozinha.
- Canal: `agency` → Voltar → "todos os canais", nada marcado; `direct` →
  Aplicar → `?channel=direct` sozinho (2 linhas); "limpar" → nada marcado
  (`06-limpar-canal-desmarcado.png`); `agency` → `?channel=agency` sozinho.
- Caminho do relatório anterior: `engenheiro` + "ampliar busca" + Vercel +
  "Candidatura enviada" → `?q=engenheiro&semantic=1&company=Vercel&stage=applied`
  (1 linha; 2 · 1 · 1). Voltar duas vezes → `?q=engenheiro&semantic=1`, campo
  "engenheiro", "todas as empresas", nada marcado, 4 linhas. Gopher → Aplicar →
  `?q=engenheiro&semantic=1&company=Gopher+Labs+QA`, 1 linha (Go Platform
  Engineer). Após refresh, o mesmo.

### 4. Canal + score + estágio, faixa invertida — pass

- `channel=referral` → notas 71 e 78 (1 Candidatura enviada · 1 Triagem);
  + mínimo 75 → só 78; + Candidatura enviada + `direct` → 78 e 83 (3 · 1 · 2);
  + máximo 80 → só 78 (2 · 1 · 1). Igual ao relatório anterior.
- Com `fit=75&fitMax=80` aplicado, digitar 80/75 e Aplicar: aviso "O mínimo
  estava acima do máximo; os dois foram trocados.", **campos e controle
  deslizante em 75/80**, lista só com 78 (`04-faixa-invertida-campos-75-80.png`).
  Aplicar outra vez → `fit=75&fitMax=80`, sem aviso, campos 75/80.
- O mesmo a partir de `/pipeline?fit=75&fitMax=80` aberto direto: 80/75 →
  aviso e 75/80; o Aplicar seguinte estabiliza em `fit=75&fitMax=80`.
- Ruído conhecido: o primeiro Aplicar só com mínimo ainda grava `fitMax=` vazio.

## Percurso de JOBS-filter-fields-follow-url (canária)

- `?pay=12000&payMax=6000` aberto: aviso de troca e campos 6000/12000; Aplicar
  → `pay=6000&payMax=12000`, sem aviso.
- Salário invertido igual ao aplicado: 12000/6000 digitado → aviso, campos e
  controle 6000/12000; Aplicar seguinte → `pay=6000&payMax=12000` sem aviso.
- Score invertido igual ao aplicado: 60–80 aplicado, 80/60 digitado → aviso,
  campos e controle 60/80 (`jobs-score-invertido-60-80.png`); Aplicar seguinte
  → `fit=60&fitMax=80` sem aviso. (O relatório de 06/10 dizia que em Vagas o
  gesto não chegava a inverter; desta vez, com os campos preenchidos por
  `fill`, inverteu e foi corrigido.)
- Limpar: "limpar" do salário → campos vazios; Aplicar do salário e depois do
  Score não trazem o salário de volta.
- Preset: score 70–90 aplicado → "Aplicável hoje" → mínimo 60, máximo vazio,
  controle 60–100; Aplicar do Score mantém 60.
- Fontes: careers + manual aplicadas ("2 de 2") → "limpar" → "todas as
  fontes", nada marcado; manual → Aplicar → só manual; Voltar → nada marcado.
- Digitação em curso: Aplicar do Score (50) e, sem esperar, digitar
  "arquiteto" na busca → depois da resposta o campo segue "arquiteto" e o
  termo foi aplicado (`q=arquiteto`). A janela da corrida não é controlável
  pelo driver: tentado, não provado como corrida.
- Refresh no fim: `?fit=50&unblocked=1&named=1&q=arquiteto` com os mesmos
  campos.

## Session Debriefs

### CH-filter-pipeline (reteste #492) — Andreus em triagem noturna

- **Ran:** 2026-10-07, 00:00–00:18 BRT, após o build do ambiente isolado (box respeitado)
- **Findings:** nenhum defeito novo. Os dois sintomas da #492 não se
  reproduzem em nenhum dos caminhos do relatório anterior.
- **Bugs filed/updated:** BUG-20261006-pipeline-back-keeps-stale-picker-marks → verified;
  BUG-20261006-pipeline-swapped-score-fields-stale → verified.
- **Scenarios settled:** PIPE-filter-applications → pass (retest pass);
  JOBS-filter-fields-follow-url → pass.
- **Paper cuts:** `fitMax=` vazio na URL (já registrado, watching).
- **Surprises:** um clique logo depois de Avançar foi recusado pelo driver por
  uma camada `z-50` sobre o seletor (janela de transição, como no relatório
  anterior); repetido em seguida, funcionou. Não registrado como bug. A marca
  do service worker no build saiu `1.34.0+4593cd6` (HEAD do checkout principal,
  porque a cópia do harness fica dentro dele); o código copiado é o da worktree.
- **Suggested next charter:** os sub-passos ainda não verificados do cenário
  (vaga fechada, candidatura sem nota, busca ampliada com a lista desligada) e
  375 px/inglês depois da troca de `key` dos seletores.

## Lentes

| Jornada | Usabilidade | Acessibilidade | Desempenho percebido | Compatibilidade | Recuperação de erro | Paridade | Evidência |
|---|---|---|---|---|---|---|---|
| PIPE-filter-applications (4 e 6) | pass | não medida | pass | pass | pass | pass | seções acima |
| JOBS-filter-fields-follow-url | pass | não medida | pass | pass | pass | pass | seções acima |

- Recuperação de erro passa de `fail` para `pass`: voltar, avançar e limpar
  levam ao estado que a URL diz, e o Aplicar seguinte não ressuscita filtro.
- Compatibilidade: só Chromium do `agent-browser`, 1280 px.
- Acessibilidade não remedida (sem mudança de marcação além da `key`).

## What Was Fixed

Nada nesta sessão. A correção é a do commit `961558d` (PR #496); a sessão
retestou.

## Paper Cuts

| Persona | Onde | Sentido | Sharpness | Outcome |
|---|---|---|---|---|
| Andreus | URL do Funil e de Vagas | primeiro Aplicar só com mínimo grava `fitMax=` vazio | dull | watching (já anotado em 06/10) |

## Runtime Errors Observed

Nenhum: `agent-browser errors` e `console` vazios ao fim da sessão.

## Human Verifications Needed

Nenhuma.

## Decisions for a Human

Nenhuma.

## Learnings

- `run-isolated.mjs --manual` espera Enter no stdin; para rodar em segundo
  plano, um FIFO como stdin mantido aberto e um `echo` nele no fim encerram o
  ambiente com limpeza.
- Ler as caixas e campos logo após Voltar/Avançar, sem refresh, é o que separa
  esse defeito; a área E2E `pipeline-filters` agora faz o mesmo.

## Final Status

- **Exit gate:** sessão de QA sobre PR com código já validado pelo autor; a
  suíte completa fica com o CI da PR #496 (não rodada aqui).
  `pnpm check:qa-tracker` rodado após a atualização dos arquivos de QA (saída
  na entrega).
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 0 ·
  Trust-Damage 0 abertos (2 verificados) · Friction 2 abertos, anteriores à
  #478 (BUG-20261006-pipeline-active-stage-invisible,
  BUG-20261006-primary-button-contrast-dark-theme) · Cosmetic 0
- **Coverage:** 2 jornadas, 2 cenários (passos 4 e 6 do Funil; os 5 caminhos
  da canária de Vagas). Passos 1, 2, 3, 5 e 7 do Funil não refeitos; 375 px,
  inglês, WebKit e aparelho físico fora.
- **Verdict:** ready — a #492 está corrigida em persona no Funil e o hook
  compartilhado não regrediu em Vagas.
