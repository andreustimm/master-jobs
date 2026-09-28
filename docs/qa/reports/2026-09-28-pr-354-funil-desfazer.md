# Execução de QA — 2026-09-28 — PR #354 (issue #346, funil: desfazer e voltar etapa)

Escopo: QA de jornada targeted da PR #354 antes de sair de draft — os 4 Minors
da revisão do desfazer (#316/#341) e as duas rodadas de correção subsequentes
(`648a8b2`, `da2b8f9`), cobertas pelo cenário `PIPE-undo-and-move-back`
inteiro, como a persona "Andreus em triagem noturna".

## Ambiente

Worktree `fix-funil-minors-desfazer` (commit `da2b8f9`), dev server próprio em
`http://127.0.0.1:48213` (`pnpm dev`, porta livre — 3000 e 3100 já em uso por
outra sessão em paralelo, issue #223), PostgreSQL local compartilhado
(`docker-compose.local.yml`, `master-jobs-local-supabase-db`, porta 5433).
Autenticação real por sessão (login por senha, conta do dono
`andreus@zorbit.com.br`, candidato `default`/id 1 — a mesma que `jho track`
usa). Driver: `playwright-cli` via `.claude/skills/playwright`, com duas abas
reais para o cenário de concorrência. Nenhum mock, endpoint interno ou
devtool substituindo interação ou verificação.

Dado de teste: 6 vagas fixture criadas via `jho jobs add`/`jho track`
(`QA Funil A`..`F`, ids 17836–17841), cada uma cobrindo um sub-caso do
cenário. Todas as 6 (e a aplicação/eventos associados) foram **apagadas ao
final** via `DELETE FROM job WHERE id IN (...)` (cascade cuida de
`application`/`application_event`); a conta de teste dedicada
(`qa-funil-desfazer@local.test`, criada e depois removida) só serviu para
confirmar o caminho de login antes de trocar para a conta do dono — o funil
em si nunca chegou a usá-la, porque `jho track` sempre opera sobre o
candidato `default`. As duas aplicações reais preexistentes do dono (vaga 38
`applied`, vaga 42 `shortlisted`) foram conferidas intactas antes e depois.

## Matriz

| # | Passo do cenário | Persona | Status | Evidência |
|---|---|---|---|---|
| 1 | Seletor "Voltar" em Triagem + trilha marca o estágio atual | Andreus em triagem noturna | **Pass** | ver §1 |
| 2 | Voltar com nota preserva a data de candidatura | Andreus em triagem noturna | **Pass** | ver §2 |
| 3 | Desfazer dentro da janela: reverte, histórico com "desfazer:" e linha riscada "desfeito" | Andreus em triagem noturna | **Pass** | ver §3 |
| 4 | Rejeitada/Retirada oferecem progresso em Voltar; Preparando oferece só Arquivar; caso direto-para-Entrevista; desfazer uma reabertura e reabrir até o estágio original | Andreus em triagem noturna | **Pass** | ver §4 |
| 5 | Desfazer até o primeiro registro: some do funil/contagens, reaparece como "Fora do funil", histórico persiste | Andreus em triagem noturna | **Pass** | ver §5 |
| 6 | Duas abas: mover na segunda enquanto o aviso da primeira está aberto; Desfazer na primeira avisa e não desfaz | Andreus em triagem noturna | **Pass** | ver §6 |
| 7 | 375 px sem rolagem horizontal; inglês sem vazamento de português | Andreus em triagem noturna | **Pass** | ver §7 |

Nenhum bug encontrado. Nenhuma correção aplicada nesta sessão (regra do
harness: bug se encontrado, seria registrado e reportado, não corrigido
nesta sessão).

## 1. Seletor "Voltar" em Triagem — Pass

Vaga A progrediu via CLI até `screening` (Triagem). No detalhe
(`/jobs/17836`), o `<select>` real (inspecionado por DOM, não só pela árvore
de acessibilidade) trouxe os `<optgroup>` na ordem certa:

```
Avançar: Em entrevista
Voltar: A fazer, Pré-selecionada, Preparando, Candidatura enviada
Encerrar: Rejeitada, Retirada, Arquivada
```

A trilha ("Estágio no funil") marca "Triagem" com `aria-current="step"` e
estilo distinto (`border-[var(--primary-text)]`), as demais em neutro —
confirmado por leitura de atributo, não só visual.

## 2. Voltar com nota preserva a data — Pass

"Triagem" → "Pré-selecionada" com nota "Voltando para revisar prioridade
(QA)". Histórico ganhou a linha nova com a nota. Leitura independente pela
CLI pública (`jho jobs show 17836`) confirmou `Pipeline shortlisted ·
applied 2026-09-28` — a data de candidatura não mudou.

## 3. Desfazer dentro da janela — Pass

Avançado de novo para "Preparando" e desfeito em seguida. Resultado:
- Estágio voltou a "Pré-selecionada" (trilha e combobox concordam).
- Histórico ganhou "desfazer: de Preparando para Pré-selecionada".
- A linha revertida ("de Pré-selecionada para Preparando") ganhou o marcador
  "desfeito" — inspecionado o HTML real: `<span class="line-through">de
  Pré-selecionada para Preparando</span> · <span
  data-testid="application-timeline-undone">desfeito</span>`, confirmando o
  risco aplicado à frase, não ao rótulo.
- Nenhuma linha do histórico anterior desapareceu.

## 4. Rejeitada/Retirada/Preparando/direto-para-Entrevista — Pass

Quatro vagas fixture, cobrindo com e sem `appliedAt`:

- **Vaga E** (progresso real completo, `applied` gravado): fechada
  `rejected`. "Voltar" ofereceu A fazer, Pré-selecionada, Preparando,
  Candidatura enviada, Triagem, Em entrevista — os estágios de progresso.
- **Vaga F** (progresso real até `applied`): fechada `withdrawn`. "Voltar"
  ofereceu A fazer, Pré-selecionada, Preparando, Candidatura enviada.
- **Vaga B** (registrada direto em `preparing`, sem `appliedAt`): grupo
  "Encerrar" ofereceu só "Arquivada".
- **Vaga C** (registrada direto em `interviewing`, sem `appliedAt`, depois
  `rejected`): "Voltar" ofereceu o mesmo teto de estágios da Vaga E
  (A fazer…Em entrevista) — a reabertura fica limitada a até onde a
  candidatura realmente chegou (`lastStatusChangeFromStatus`), não bloqueada
  pela ausência de `appliedAt` (era o defeito original do #346/#341) nem
  liberada sem teto.

**Desfazer uma reabertura e reabrir até o estágio original** (repro exato do
Major da 2ª rodada de revisão, commit `da2b8f9`): na Vaga C, reabri para
"Triagem" (um estágio abaixo do teto real), desfiz a reabertura, e o
"Voltar" **continuou correto** — A fazer…Em entrevista, não limitado a
"Triagem" (que seria o sintoma do bug: usar o `fromStatus` do evento de
desfazer mais recente em vez de pular eventos desfeitos). Reabri de novo,
desta vez para "Em entrevista" — o estágio real — e a candidatura chegou lá
com nota e histórico íntegro. `undoableEvent()` está de fato pulando o
evento de reabertura desfeito ao calcular o teto.

## 5. Desfazer até o primeiro registro — Pass

Vaga A desfeita passo a passo (5 cliques em "Desfazer", cada um na linha
mais recente não desfeita) até o evento "registrada em Pré-selecionada".
Resultado, com leitura independente em três lugares:
- Detalhe da vaga: rótulo "Fora do funil"; histórico com as 10 linhas
  intactas (5 reais + 5 "desfazer:"), cada revertida com "desfeito".
- `/pipeline`: total caiu de 8 para 7, vaga A ausente da lista e de toda
  contagem por estágio.
- `/jobs` (quadro geral, sem filtro de status): vaga A reaparece com o
  rótulo "Fora do funil" — a busca textual por `unfiled` (o atalho "Não
  triadas") não a lista, porque esse filtro é "nunca teve `application`"
  (`status IS NULL`), e a vaga tem uma linha `application` com
  `status='untracked'`; o quadro geral sem filtro de status é que mostra
  esse estado corretamente. Não é um defeito — é a semântica documentada do
  filtro `unfiled` (`docs/cli.md`), só uma armadilha de busca nesta sessão.

## 6. Duas abas — Pass

Vaga D. Aba 1 moveu para um estágio (gerando seu próprio botão "Desfazer"
persistente na linha do histórico). Sem recarregar a aba 1, a aba 2 (nova,
carregando a vaga do zero) viu o estado real e moveu para outro estágio.
Clicar "Desfazer" na aba 1 (com o `eventId` do evento antigo, já superado):

- Repetido duas vezes (com estágios diferentes) para garantir captura do
  aviso — na primeira tentativa o toast (5 s, `MUTATION_FEEDBACK_MS`) já
  tinha expirado quando o snapshot seguinte foi tirado; na segunda,
  capturado o texto no DOM logo após o clique: **"Esta candidatura mudou em
  outra tela. Recarregue para ver o estágio atual e tente de novo."**
- Em nenhuma das duas tentativas o desfazer foi aplicado: o estágio
  permaneceu o que a aba 2 gravou, sem linha "desfazer:" nova e sem nenhuma
  linha existente marcada "desfeito".
- Aprendizado de sessão: o aviso de conflito é o `MutationFeedbackHost`
  (toast, 5 s) — uma verificação que espera mais de ~3-4 s entre a ação e a
  leitura corre risco de não o capturar e relatar um falso negativo. Registrado
  para a próxima sessão que testar esse caminho.

## 7. 375 px e inglês — Pass

Viewport 375×812, idioma trocado para inglês pela UI. `/jobs/17839`
(Rejected): seletor, trilha ("Funnel stage": Backlog…Rejected) e histórico
("Application history", botão "Undo") totalmente traduzidos.
`document.documentElement.scrollWidth === clientWidth === innerWidth ===
375` — sem rolagem horizontal. Os únicos textos em português na tela são
dado do próprio candidato-fixture ("QA Funil Desfazer", "Remoto",
"Fixture QA item D") — valor de teste que eu mesmo digitei em português no
`-l`/`-c`/`-d` do `jho jobs add`, não string de interface; não é um achado.

## Aprendizados

- `jho track`/`jho jobs add -s` sempre operam sobre o candidato `default`
  (`getCandidate("default")`), não sobre a conta logada na sessão do
  navegador — para uma jornada de funil, logue como o dono
  (`andreus@zorbit.com.br`), não como uma conta de candidato dedicada, ou os
  dados criados pela CLI não aparecem na tela.
- O banco local (`docker-compose.local.yml`, porta 5433) é único e
  compartilhado entre worktrees — não há isolamento por sessão. Vaga fixture
  com nome/URL exclusivo e limpeza por `DELETE FROM job` (cascade) ao final
  é o padrão seguro para não colidir com outra sessão de QA em paralelo.
- Toast de conflito (`MutationFeedbackHost`) dura só 5 s; verificação de
  aviso transitório precisa checar o DOM na resposta imediata da ação, não
  depois de mais 2-3 chamadas de ferramenta.
- Porta de dev server escolhida "ao acaso" pode colidir com a de outra
  sessão que também escolheu uma porta livre sem reservá-la — confirmado ao
  vivo (ver nota abaixo). Preferir uma porta de faixa alta (`>40000`) reduz
  a chance.

### Nota: colisão de porta com outra sessão

Ao subir o dev server pela primeira vez em `:3222`, requisições de
`/admin/plataformas/greenhouse:qa-catalog-223` (claramente da sessão da
issue #223, rodando em paralelo) chegaram ao log deste servidor — as duas
sessões escolheram a mesma porta livre "por acaso" e a da #223 não conseguiu
de fato abrir a própria (ficou short-circuited servida pela minha). Corrigido
subindo de novo em `:48213`, sem mais colisão pelo resto da sessão. Nenhuma
escrita minha foi enviada à sessão da #223 nem vice-versa além dessas
requisições de leitura/admin que passaram pelo meu processo; não houve
escrita em dado de funil compartilhado.

## Final Status

**Pronta para sair de draft do ponto de vista de QA de jornada.** Os 7
passos do cenário `PIPE-undo-and-move-back` passam, incluindo os três casos
que a issue #346 e as duas rodadas de correção da PR existem para cobrir: (1)
reabertura sem `appliedAt` limitada pelo teto real, não pela ausência do
carimbo; (2) desfazer uma reabertura e reabrir de novo chega ao estágio
certo, não a um teto contaminado pelo evento desfeito; (3) a corrida de duas
abas nem corrompe o histórico nem falha silenciosamente — avisa e recusa.
Nenhum bug novo registrado. `pnpm check:qa-tracker` e `pnpm check:instructions`
ficam para a validação local desta mesma sessão (fora do escopo desta
seção, que é só o resultado da jornada).
