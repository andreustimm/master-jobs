# QA Run Report — 2026-09-28T180205401032Z-d6d772a5 — perfil-publico-opt-in-targeted

- **Scope:** PR #362 (issue #327, parte A) — sete fatos de texto opt-in do perfil público (`candidate.public_facts_*`): modelo de trabalho, nível de experiência, disponibilidade, prazo para começar, aceita mudar, área e idiomas. Cada um desligado por padrão, editável em `/candidate`, exibido em `/p/[slug]` só com opt-in ligado.
- **Cadence tier:** targeted
- **Build:** `feat/perfil-publico-opt-in@8556aac`, com um segundo commit (`38b81b5`, fixes de revisão L2 em `candidate-public-facts.ts`/`public-cv.ts`) aplicado **enquanto esta sessão rodava** — o `next dev` local sempre leu do disco, então todas as verificações desta rodada já refletem `38b81b5` (worktree `.claude/worktrees/feat-perfil-publico-opt-in`)
- **Environment:** `next dev` (Turbopack) local em `http://127.0.0.1:3101` (porta alternativa; sem `.env` na worktree — variáveis passadas inline no processo: `DATABASE_URL`/`DATABASE_MIGRATION_URL` apontando para o Postgres local já existente, `docker-compose.local.yml`, `master-jobs-local-supabase-db`, porta 5433; `JHO_ENV=local`), migrações da branch aplicadas (`0028_candidate_public_facts` incluída), conta de QA sintética `qa-perfil-publico-opt-in@local.test` (role `candidate`, sem dado real do dono), autenticação real via `pnpm jho auth login` (link de uso único), navegador Chromium real via `playwright-cli`
- **Started:** 2026-09-28T18:02Z · **Status:** closed

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Andreus no celular | Mobile User | phone-small→desktop / 4g / pt-BR↔en | CH-public-facts-edit-mobile, CH-public-facts-edit-desktop-en |
| Visitante do perfil público | New User | phone-large→desktop / 4g / en-US↔pt-BR | CH-public-facts-visitor-mobile, CH-public-facts-visitor-desktop |

## Flows in Scope

- `J-choose-public-address` — escolher e trocar o endereço `/p/` do próprio perfil; parte tocada: editar e persistir os sete fatos opt-in em `/candidate` (`../journeys/J-choose-public-address.md`)
- `J-open-public-profile` — resolver um link de perfil público sem revelar cadastro; parte tocada: variante publicada exibindo só os fatos ligados (`../journeys/J-open-public-profile.md`)

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | CH-public-facts-edit-mobile | J-choose-public-address / PUB-edit-public-facts | Andreus no celular | Feature Tour | Pass | BUG-20260928-public-facts-uncontrolled-field-warning | |
| 2 | CH-public-facts-edit-desktop-en | J-choose-public-address / PUB-edit-public-facts | Andreus no celular | Feature Tour | Pass | | |
| 3 | CH-public-facts-visitor-mobile | J-open-public-profile / PUB-public-facts-opt-in | Visitante do perfil público | Feature Tour | Pass | | |
| 4 | CH-public-facts-visitor-desktop | J-open-public-profile / PUB-public-facts-opt-in | Visitante do perfil público | Feature Tour | Pass | | |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Session Debriefs

### CH-public-facts-edit-mobile — Andreus no celular

- **Ran:** 2026-09-28T18:07Z → 2026-09-28T18:13Z (box respeitado: sim)
- **Ambiente de dado:** conta de QA sintética `qa-perfil-publico-opt-in@local.test` (candidato 5), criada nesta sessão, sem dado real do dono. Login real por link de uso único (`pnpm jho auth login`).
- **Nota de ambiente:** a worktree não tinha `.env` (só `.env.example`, protegido por regra de permissão do harness); o servidor `next dev` e os comandos `jho`/`drizzle-kit` rodaram com `DATABASE_URL`/`DATABASE_MIGRATION_URL`/`JHO_ENV=local` passados inline no processo, apontando para o Postgres local já existente (`docker-compose.local.yml`, porta 5433) — nenhum segredo foi lido, escrito ou impresso.
- **Nota de ambiente 2:** o link de login de uso único falhava (`/login/callback` respondia 303 para `http://localhost:3101/`, mas o cookie de sessão era gravado só para o host `127.0.0.1` usado na navegação — a troca de host no redirect derrubava a sessão antes de `/` carregar). Contornado navegando sempre por `http://localhost:3101` em vez de `http://127.0.0.1:3101`. Não é comportamento da PR (o redirect e o cookie são do fluxo de auth, código não tocado por #362); registrado aqui como nota de ambiente, não como bug, porque em produção há um único domínio canônico e a troca de host não ocorre.
- **Findings:**
  - Em `/candidate`, o cartão "Dados do perfil público" mostra os sete fatos (Modelo de trabalho, Nível de experiência, Disponibilidade, Prazo para começar, Aceita mudar de cidade ou país, Área, Idiomas), cada um com seu próprio checkbox "Mostrar no perfil público" desmarcado por padrão — confirmado por `data-testid` (`public-fact-*`, `public-fact-show-*`).
  - Marcar Modelo de trabalho (Remoto) + opt-in, Disponibilidade (Aberto a propostas) + opt-in, Aceita mudar (Sim) + opt-in, Área ("Engenharia de Software") + opt-in e Idiomas ("Português (nativo), Inglês (fluente)") + opt-in, deixando Nível de experiência (Sênior) e Prazo SEM opt-in, e salvar mostra "Dados do perfil salvos." Recarregar a página confirma que só os cinco marcados continuam marcados, com os valores certos — leitura independente via fresh load.
  - Tentar gravar `"Pretensão: USD 15,000"` em Área é recusado com `"A área não pode ter valor em dinheiro nem pretensão salarial: ela nunca sai no perfil público."`; tentar `"contato: andreus@example.com"` em Idiomas (isoladamente, com Área já válida) é recusado com `"Idiomas não pode ter e-mail nem telefone: o campo pode sair no perfil público."`. Em ambos os casos, recarregar a página confirma que o valor anterior (válido) continuou salvo — a recusa não apaga nem sobrescreve o que já estava lá.
  - Repetido em inglês (sessão 2, mesma conta): `"Field can't contain an amount of money or a salary expectation: that is never shown on the public profile."`, com o mesmo comportamento de preservação após refresh.
  - O cartão traz a dica declarada no cenário: "Pretensão salarial não é um destes campos e nunca sai no perfil público." / "Salary expectation is not one of these fields and is never shown on the public profile." Não existe nenhum campo de pretensão salarial na tela.
  - Um segundo ciclo de edição, desta vez ligando os sete fatos (incluindo Nível de experiência = Sênior e Prazo = "Em 1 mês"), salvou e persistiu os sete corretamente — cobertura completa dos sete campos, não só os cinco do primeiro ciclo.
  - Desligar o opt-in de Modelo de trabalho e salvar remove o fato da leitura anônima na hora (ver sessão 3).
- **Bugs filed/updated:** `BUG-20260928-public-facts-uncontrolled-field-warning` (novo, `open`) — aviso de console (Base UI: FieldControl não controlado → controlado) após o primeiro "Salvar dados"; sem efeito observável, dados salvam e persistem corretamente.
- **Scenarios settled:** `PUB-edit-public-facts` → pass (bug linkado, cosmético, não rebaixa o veredito).
- **Paper cuts:** nenhum sentido pela persona — mensagens de recusa nomeiam o campo e a razão, e o valor anterior nunca se perde.
- **Surprises:** o rótulo em inglês de "Área" é "Field" (não "Area") — tradução deliberada para evitar confusão com "área geográfica"; consistente entre `/candidate` e `/p/[slug]`, não é um vazamento de tradução.
- **Suggested next charter:** isolar qual `FieldControl` específico dispara o aviso de console (não investigado nesta sessão, por não ter efeito observável).

### CH-public-facts-edit-desktop-en — Andreus no celular

- **Ran:** 2026-09-28T18:10Z → 2026-09-28T18:18Z (box respeitado: sim; sessão intercalada com a mobile na mesma aba, viewport redimensionado)
- **Findings:**
  - Em 1280×900, com idioma trocado para inglês, todos os rótulos do cartão traduzem corretamente: "Work model", "Experience level", "Availability", "Can start", "Open to relocation", "Field", "Languages", "Show on public profile", incluindo o texto de ajuda ("E.g. Portuguese (native), English (fluent). Up to 160 characters.").
  - O conteúdo digitado pela pessoa ("Engenharia de Software", "Português (nativo), Inglês (fluente)") permanece no idioma original em que foi escrito, sem tentativa de tradução automática — como o cenário exige.
  - Recusa de valor inválido em inglês testada isoladamente (`"Salary: USD 15,000"` em Field) com a mensagem em inglês já citada acima, e o valor anterior preservado após refresh.
- **Bugs filed/updated:** nenhum novo nesta sessão.
- **Scenarios settled:** `PUB-edit-public-facts` → pass (mesmo veredito da sessão 1, reforçado em inglês/desktop).
- **Paper cuts:** nenhum.
- **Surprises:** nenhuma além da já registrada na sessão 1.
- **Suggested next charter:** nenhum pendente para este cenário.

### CH-public-facts-visitor-mobile — Visitante do perfil público

- **Ran:** 2026-09-28T18:11Z → 2026-09-28T18:17Z (box respeitado: sim)
- **Ambiente:** sessão de navegador separada, sem login (janela anônima equivalente), `qa-pub-visitor`, abrindo `/p/qa-perfil-publico-opt-in` direto pela URL — como o visitante real chegaria por um link compartilhado.
- **Findings:**
  - Com cinco fatos ligados (Modelo de trabalho, Disponibilidade, Área, Idiomas, Aceita mudar) e dois desligados (Nível, Prazo), a faixa do topo mostra só "Work model: Remote" e "Availability: Open to offers" — Nível de experiência ausente, nem como rótulo vazio. O cartão "At a glance" mostra "Field", "Languages" e "Open to relocation" — Prazo ausente da mesma forma.
  - Confirmado por leitura independente (reload) que os mesmos fatos sobrevivem ao refresh, em inglês e em pt-BR (troca de idioma pelo seletor do cabeçalho, sem sessão).
  - `document.documentElement.scrollWidth === clientWidth` (375×375) em 375px, sem rolagem horizontal, com o conjunto de 5 e depois de 7 fatos.
  - Após o candidato desligar o opt-in de Modelo de trabalho em `/candidate` (sessão 1) e salvar, recarregar esta página anônima remove "Work model" da faixa imediatamente — sem cache nem atraso.
  - Depois que o candidato ligou os sete fatos (sessão 1, segundo ciclo), recarregar mostra os sete no lugar certo: faixa do topo com Modelo de trabalho, Nível de experiência e Disponibilidade; "Em resumo"/"At a glance" com Área, Idiomas, Prazo para começar e Aceita mudar — bate exatamente com a divisão declarada na PR.
  - `document.body.innerText` da página inteira (com os 7 fatos ligados) não contém e-mail, telefone nem qualquer valor monetário/pretensão salarial, em nenhum dos dois idiomas.
- **Bugs filed/updated:** nenhum.
- **Scenarios settled:** `PUB-public-facts-opt-in` → pass.
- **Paper cuts:** nenhum sentido pela persona — a página é enxuta e não mostra "não informado" para fatos desligados, só omite a linha inteira.
- **Surprises:** nenhuma.
- **Suggested next charter:** nenhum pendente.

### CH-public-facts-visitor-desktop — Visitante do perfil público

- **Ran:** 2026-09-28T18:13Z → 2026-09-28T18:17Z (box respeitado: sim; mesma sessão de navegador da anterior, redimensionada)
- **Findings:**
  - Em 1280×900, `getBoundingClientRect()` confirma grade de duas colunas: `h1` (cabeçalho do perfil) em `left≈48px`, `h2` "Em resumo"/"At a glance" em `left≈864px` — mesma estrutura de duas colunas já confirmada na QA da PR #355, não quebrada pelos fatos novos (canário adjacente ao layout, dentro do escopo desta rodada).
  - Rótulos em pt-BR: "Modelo de trabalho", "Disponibilidade", "Nível de experiência", "Área", "Idiomas", "Prazo para começar", "Aceita mudar de cidade ou país" — todos corretos e sem vazamento de inglês.
- **Bugs filed/updated:** nenhum.
- **Scenarios settled:** `PUB-public-facts-opt-in` → pass (reforça o veredito da sessão 3 em desktop).
- **Paper cuts:** nenhum.
- **Surprises:** nenhuma.
- **Suggested next charter:** nenhum pendente.

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-choose-public-address | pass | pass | pass | friction | pass | friction | Feedback ("Dados do perfil salvos.", mensagens de recusa) aparece de imediato; ordem de tabulação Área→"Mostrar no perfil público" é lógica, com contorno de foco visível (`outline: auto`) e nome acessível correto em todos os checkboxes/comboboxes (confirmado pela árvore de acessibilidade do snapshot); recusa preserva o valor anterior e nomeia o campo e a razão. Compatibilidade só em Chromium via `playwright-cli` (sem Safari/Firefox real) — não medido nesta rodada. Parity: `next dev` local, não `next build && next start`; sem extensões de navegador; auth real por link de uso único. |
| J-open-public-profile | pass | pass | pass | friction | n/a | friction | Faixa de fatos e cartão "Em resumo" aparecem junto com o resto da página, sem layout shift perceptível; ausência de fato desligado não deixa espaço vazio nem rótulo órfão; sem rolagem horizontal em 375px com 5 e com 7 fatos. Sem caminho de erro nesta jornada (perfil sempre existe e é público nesta sessão) — `n/a`. Mesmas ressalvas de compatibilidade/parity da linha acima. |

## What Was Fixed

<!-- nenhum fix nesta rodada: bug é registrado e reportado, não corrigido (instrução da tarefa) -->

## Paper Cuts

| Persona | Where (journey/step) | Felt | Sharpness | Outcome |
|---|---|---|---|---|
| Andreus no celular | J-choose-public-address, cartão "Dados do perfil público" | "O rótulo em inglês de Área virou 'Field' — bati o olho duas vezes antes de confirmar que é o mesmo campo." | dull | watching (tradução deliberada, não é erro; citada nos Surprises) |

## Runtime Errors Observed

- **Aviso de hidratação do app-splash em quase toda navegação** (`A tree hydrated but some attributes of the server rendered HTML didn't match the client properties...`, apontando para o `div#app-splash` em `app/layout.tsx`) — reproduzido em `/login`, `/`, `/candidate` e `/p/[slug]` nesta sessão, em modo `next dev`. Um sintoma do mesmo tipo (aviso de React ligado ao `<script>`/app-splash, só em `/p/[slug]` 404) já havia sido observado e descrito como pré-existente numa sessão de QA anterior hoje (relatório `docs/qa/reports/2026-09-28T164126181554Z-de433ca6-perfil-publico-layout-targeted.md`, citando `BUG-20260928-public-profile-404-script-tag-warning`), mas esse arquivo de bug não foi encontrado no registro (`docs/qa/bugs/`) nem em `dev` nem nesta worktree — não foi possível confirmar se é exatamente o mesmo aviso ou uma variante mais ampla (aqui aparece em toda navegação, não só no 404). Não mintei um novo id por incerteza de duplicidade; registro aqui como explicado, não arquivado, para quem revisar decidir se concilia com o achado anterior. Não afeta nenhum observável desta PR (todas as verificações de dado, opt-in e recusa passaram) e é consistente com uma característica de desenvolvimento (Turbopack/Next 16 dev), não uma regressão de #362.
- **`Base UI: A component is changing the default value state of an uncontrolled FieldControl after being initialized.`** — novo, filed como `BUG-20260928-public-facts-uncontrolled-field-warning`, ligado a `PUB-edit-public-facts`.

## Human Verifications Needed

- Nenhuma. Todos os passos desta rodada são alcançáveis e verificáveis pela interface pública/autenticada, sem pagamento real, e-mail/SMS externo ou OAuth de conta real.

## Decisions for a Human

- Nenhuma decisão de produto pendente nesta rodada — os dois cenários no escopo fecharam `pass`, e o único bug novo é cosmético (console, sem efeito observável).

## Learnings

- A worktree desta PR não trazia `.env`; variáveis de ambiente locais (`DATABASE_URL`, `DATABASE_MIGRATION_URL`, `JHO_ENV`) precisaram ser passadas inline no processo porque o harness nega leitura/escrita de qualquer arquivo `.env*` (proteção correta contra vazamento de segredo) — vale documentar esse caminho (env inline, sem tocar arquivo) para a próxima worktree sem `.env`.
- O link de login de uso único (`jho auth login`) só autentica de fato quando a navegação usa o mesmo host (`localhost`) que o redirect final da aplicação usa internamente; abrir pela URL com `127.0.0.1` (como o próprio comando `jho auth login` imprime) derruba a sessão no meio do redirect. Não investigado a fundo (fora do escopo desta PR), mas vale registrar para a próxima sessão local não perder tempo com o mesmo sintoma.
- O registro de bugs pode ter um "buraco": um relatório de QA de hoje cita `BUG-20260928-public-profile-404-script-tag-warning` como já filed, mas o arquivo correspondente não existe em `docs/qa/bugs/` (nem em `dev`, nem nesta worktree) — meu vereditos não dependem dele, mas vale um `qa-report` futuro conferir se esse bug caiu no meio de um merge.
- **Achado operacional, fora do escopo desta QA:** ao checar `git status` no fim da rodada, a worktree já trazia mudanças **staged e não commitadas** em `src/core/candidate-public-facts.ts`, `src/core/candidate.ts`, `src/core/public-cv.ts` e testes associados — endurecendo exatamente a validação que testei (telefone sem marca e valor "com cara de dinheiro" em Área/Idiomas, e-mail de conta/candidato reconhecido além do texto livre, e um ajuste de performance de regex citado como "revisão L2 da #362"). Eu não fiz nem toquei nessas mudanças; eu as testei "de graça" porque o `next dev` lê do disco, não do índice do git, então minha sessão já validou o comportamento pós-fix. Não commitei nada além dos meus quatro arquivos de QA (pathspec explícito), para não assinar um código que não escrevi nem revisei — quem preparou essas mudanças precisa commitá-las separadamente antes que se percam.

## Final Status

**Pronto para seguir — os dois cenários no escopo (`PUB-edit-public-facts`, `PUB-public-facts-opt-in`) fecharam `pass`**, com sete campos cobertos ida e volta (opt-in ligado/desligado, valor, persistência, remoção ao vivo), recusa de contato e pretensão salarial testada em Área e Idiomas, em pt-BR e inglês, em 375px e desktop, sem vazamento de pretensão salarial/contato em nenhum estado. Um bug novo, cosmético (`BUG-20260928-public-facts-uncontrolled-field-warning`, aviso de console sem efeito observável), não bloqueia. Nenhuma verificação humana pendente, nenhuma decisão de produto em aberto.

**Totais por camada de impacto do usuário nesta rodada:** Blocks-Completion: 0 · Data-Loss: 0 · Trust-Damage: 0 · Friction: 0 · Cosmetic: 1 (aberto, não bloqueia).

**Gate de saída:** por escopo da tarefa, rodei só `pnpm check:qa-tracker` (`docs/qa/state.csv: 103 scenarios`, sem erro) e `pnpm check:instructions` (`Instruções: symlinks dos harnesses, links, âncoras e inventário de regras conferem.`) — ambos verdes. **Não rodei `pnpm check` completo nem `pnpm test:e2e`**: a PR já reporta essas suítes verdes (E2E isolado 58/58, área `public-facts` 13/13) e ficam para o CI, como de praxe para QA de jornada (não substitui o CI).

**Ressalva de paridade:** sessão rodou em `next dev` (Turbopack), não `next build && next start`; só Chromium via `playwright-cli` (sem Safari/Firefox reais); conta de QA sintética, não a conta real do dono — nenhuma dessas ressalvas invalida os vereditos acima, mas qualifica o escopo "targeted" desta rodada.
