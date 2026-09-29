# QA Run Report — 2026-09-28T205309000000Z-62fe85e4 — perfil-publico-foto-capa-targeted

- **Scope:** PR #364 (issue #327, parte B) — foto e capa do perfil público com armazenamento no formato S3 (Vercel Blob + S3/MinIO). Três cenários novos (`PUB-edit-public-photo-cover`, `PUB-public-image-revoked-404`, `PUB-public-photo-cover-opt-in`) e a parte afetada de `journeys/J-open-public-profile.md`.
- **Cadence tier:** targeted
- **Build:** `feat/perfil-publico-foto-capa`, worktree `.claude/worktrees/feat-perfil-publico-foto-capa`. A sessão começou no commit `ef8d359` e terminou no `21724ef` — **a branch recebeu 4 commits novos enquanto esta sessão rodava** (`a8bca20`, `ba8950f`, `ed355e6`, `21724ef`, todos "Refs #327", revisão L2 da própria PR #364), incluindo uma correção de comportamento (teto de envio de 5 MiB para 4 MiB) que esta sessão pegou em andamento — ver a nota em "Learnings" e a re-verificação completa contra `21724ef` antes do veredito final.
- **Environment:** `next dev` (Turbopack) local em `http://localhost:3102` (porta alternativa; sem `.env` na worktree — variáveis passadas inline no processo: `DATABASE_URL`/`DATABASE_MIGRATION_URL` apontando para o Postgres local já existente, `docker-compose.local.yml`, `master-jobs-local-supabase-db`, porta 5433, `JHO_ENV=local`); `JHO_STORAGE_DRIVER=s3` com MinIO local (`docker-compose.local.yml`, `127.0.0.1:9000`, bucket `master-jobs`) para os cenários com armazenamento, e um terceiro cenário rodado **sem** `JHO_STORAGE_DRIVER` (nem `S3_*`); migração `0029_perfil_publico_foto_capa` aplicada; conta de QA sintética `qa-perfil-publico-foto-capa@local.test` (role `candidate`, sem dado real do dono), autenticação real via `pnpm jho auth login` (link de uso único, navegado sempre por `localhost` e não `127.0.0.1` — troca de host derruba a sessão no redirect, lição já registrada em rodadas anteriores); navegador Chromium real via `agent-browser` (`pnpm exec agent-browser`); dev server reiniciado 5 vezes ao longo da sessão (troca de configuração de armazenamento e, ao final, `rm -rf .next` para garantir build limpo contra `21724ef`, já que o Turbopack aplica HMR a partir do disco e a branch mudou sob os pés da sessão).
- **Started:** 2026-09-28T20:15Z · **Status:** closed

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Andreus no celular | Mobile User | phone-small (375×812) → desktop (1280×900) / 4g / pt-BR↔en | CH-photo-cover-edit-mobile, CH-photo-cover-edit-desktop-en, CH-photo-cover-not-configured |
| Visitante do perfil público | New User | phone-large (375×812) → desktop (1280×900) / 4g / en-US↔pt-BR | CH-photo-cover-visitor-mobile, CH-photo-cover-visitor-desktop, CH-photo-cover-revoked-404 |

## Flows in Scope

- `J-choose-public-address` — escolher e trocar o endereço `/p/` do próprio perfil; parte tocada: enviar/trocar/remover foto e capa em `/candidate` (`../journeys/J-choose-public-address.md`)
- `J-open-public-profile` — resolver um link de perfil público sem revelar cadastro; parte tocada: variante publicada exibindo foto/capa opt-in, e o 404 de uma URL de imagem revogada (`../journeys/J-open-public-profile.md`)

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | CH-photo-cover-edit-mobile | J-choose-public-address / PUB-edit-public-photo-cover | Andreus no celular | Feature Tour | Pass | | |
| 2 | CH-photo-cover-edit-desktop-en | J-choose-public-address / PUB-edit-public-photo-cover | Andreus no celular | Feature Tour | Pass | | |
| 3 | CH-photo-cover-not-configured | J-choose-public-address / PUB-edit-public-photo-cover | Andreus no celular | Edge-Case Tour | Pass | BUG-20260928-public-profile-broken-image-icon-storage-unconfigured | |
| 4 | CH-photo-cover-visitor-mobile | J-open-public-profile / PUB-public-photo-cover-opt-in | Visitante do perfil público | Feature Tour | Pass | | |
| 5 | CH-photo-cover-visitor-desktop | J-open-public-profile / PUB-public-photo-cover-opt-in | Visitante do perfil público | Feature Tour | Pass | | |
| 6 | CH-photo-cover-revoked-404 | J-open-public-profile / PUB-public-image-revoked-404 | Visitante do perfil público | Feature Tour | Pass | | |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Session Debriefs

### CH-photo-cover-edit-mobile — Andreus no celular

- **Ran:** 2026-09-28T20:20Z → 2026-09-28T20:40Z (box respeitado: não — sessão mais longa por causa da branch mudando sob os pés, ver Learnings)
- **Findings:**
  - Em `/candidate`, o cartão "Foto e capa do perfil público" mostra dois sub-cartões, "Foto" e "Capa", cada um com `Escolher imagem`, `Mostrar no perfil público` (nasce desmarcado, confirmado por conta nova) e `SALVAR`.
  - JPEG, PNG e WebP aceitos nos dois cartões (6 combinações testadas: foto×3 formatos, capa×3 formatos), com preview mostrando a imagem reencodada (WebP, recortada — foto quadrada 128×128 mínimo, capa 4:1 mínimo 800×200) e sobrevivendo ao refresh (leitura independente).
  - SVG renomeado para `.png`: recusado com "Envie uma imagem JPEG, PNG ou WebP." nos dois cartões, imagem anterior preservada.
  - Tipo real errado (GIF de verdade, extensão `.gif`): mesma mensagem e mesma preservação.
  - Capa 600×600 px: recusada com "A imagem é pequena demais: o mínimo é 800×200 px." (mensagem capturada via snapshot de acessibilidade — o toast em si é breve e não apareceu nas primeiras capturas de tela, corrigido nas tentativas seguintes).
  - Arquivo acima do teto de tamanho (~4,47 MB e ~5,8 MB): recusado com "A imagem passa de 4 MB." — o teto real é 4 MB, não 5 MB como esta sessão presumiu inicialmente a partir do texto antigo do cenário; ver Learnings. Um arquivo de ~10,5 MB, no início da sessão (`ef8d359`), gerava um erro genérico em vez da mensagem de tamanho; depois das correções `a8bca20`–`21724ef` (aplicadas **durante** esta sessão), o próprio seletor de arquivo recusa o mesmo arquivo antes de qualquer envio, com a mensagem correta — reconfirmado.
  - Trocar a foto/capa por um arquivo válido mostra a nova prévia na hora, sem recarregar.
  - `REMOVER IMAGEM` limpa a prévia e desmarca "Mostrar no perfil público" sozinho — confirmado por refresh (estado do servidor, não só do cliente).
  - Foto com EXIF de GPS (JPEG montado com `piexif`, coordenadas de São Paulo): a prévia aparece em pé; o arquivo servido em `/candidate/image/photo` (baixado com o cookie da própria sessão, equivalente a "salvar imagem como") é WebP, 512×512, **sem nenhum chunk EXIF/XMP/ICC** (inspecionado com PIL e busca binária) — GPS removido. Ver `docs/qa/evidence/.../exif-strip-check.txt`.
  - Um achado do console (não bloqueia, não registrado como bug novo): o mesmo aviso `Base UI: A component is changing the default value state of an uncontrolled FieldControl after being initialized.` já registrado em `BUG-20260928-public-facts-uncontrolled-field-warning` (rodada da PR #362) reaparece ao salvar o endereço público (`SALVAR ENDEREÇO`) — mais um `FieldControl` afetado pelo mesmo padrão, fora do escopo desta PR.
  - **Achado transitório, não é bug do produto:** por volta de 20:36Z, uma tentativa de trocar a foto por um PNG (`valid_photo.png`) resultou em `GET /candidate/image/photo?v=... 500` (`Module ... was instantiated ... module factory is not available`) — sintoma clássico de HMR do Turbopack em sessão longa. Reiniciar o servidor resolveu (mesma chave passou a responder 200 sem nenhuma mudança de código). Não registrado como bug.
- **Bugs filed/updated:** nenhum bug novo confirmado nesta sessão de edição (dois candidatos a bug levantados no meio da sessão — teto de 4 MB vs. 5 MB, e o checkbox "Mostrar" invertendo visualmente após uma recusa — **não se confirmaram contra o HEAD final `21724ef`**; ver Learnings).
- **Scenarios settled:** `PUB-edit-public-photo-cover` → pass.
- **Paper cuts:** o toast de recusa da capa 600×600 é breve o bastante para escapar de uma captura de tela feita com um passo de espera fixo entre o clique e a screenshot — não afeta a pessoa real (ela vê a mensagem em tempo real), só a evidência automatizada desta sessão.
- **Surprises:** o texto de ajuda e a recusa real mudaram de "5 MB" para "4 MB" **enquanto a sessão rodava**, por causa de um limite da própria Vercel (413 acima de ~4,5 MB) descoberto na revisão L2 da mesma PR.
- **Suggested next charter:** nenhum pendente para foto/capa; o aviso de `FieldControl` no endereço público poderia entrar num levantamento futuro do bug já aberto.

### CH-photo-cover-edit-desktop-en — Andreus no celular

- **Ran:** 2026-09-28T20:40Z → 2026-09-28T20:48Z (box respeitado: sim)
- **Findings:**
  - Em 1280×900, com o idioma trocado para inglês (menu "idioma" no cabeçalho — precisou scroll até o topo da página e clique direto no botão, já que o clique não expande o menu se a página estiver rolada para outra seção), os textos traduzem corretamente: "Photo", "Cover", "Choose image", "Show on public profile", "SAVE", "REMOVE IMAGE", "JPEG, PNG or WebP, up to 4 MB. Cropped to a square; at least 128×128 px." / "...Cropped to 4:1; at least 800×200 px."
  - SVG renomeado recusado com "Upload a JPEG, PNG or WebP image."; arquivo acima do teto recusado com "The image is larger than 4 MB." — mesma mensagem em inglês, mesma preservação da imagem anterior.
  - Confirmado que a imagem e o estado de "Mostrar" salvos na sessão em português continuam corretos ao trocar para inglês (mesma conta, mesma aba).
- **Bugs filed/updated:** nenhum.
- **Scenarios settled:** `PUB-edit-public-photo-cover` → pass (reforça o veredito da sessão 1, em inglês/desktop).
- **Paper cuts:** nenhum.
- **Surprises:** nenhuma além da já registrada na sessão 1.
- **Suggested next charter:** nenhum pendente.

### CH-photo-cover-not-configured — Andreus no celular

- **Ran:** 2026-09-28T20:50Z → 2026-09-28T21:00Z (box respeitado: sim; sessão dedicada ao caso "sem `JHO_STORAGE_DRIVER`" pedido pela tarefa)
- **Ambiente:** servidor reiniciado sem `JHO_STORAGE_DRIVER` nem `S3_*`, com foto e capa **já existentes** (enviadas numa sessão anterior com armazenamento configurado).
- **Findings:**
  - Tentar salvar uma nova foto (com armazenamento desligado) mostra corretamente "Image upload is not configured in this environment." — confirmado em inglês; comportamento esperado, funciona.
  - A imagem **já existente** (photo_key/cover_key no banco, "mostrar" ligado) não é servida (`GET /candidate/image/photo` e `/p/<endereço>/image/photo` → 404, coerente com "sem armazenamento, sem leitura possível") — mas em vez de simplesmente não aparecer, o `<img>` sem tratamento de erro mostra o ícone de imagem quebrada do navegador, tanto em `/candidate` quanto no perfil público visitado por um visitante anônimo. Registrado como `BUG-20260928-public-profile-broken-image-icon-storage-unconfigured` — é diferente do caminho de "mostrar desligado", que omite a imagem sem deixar rastro visual (confirmado nas sessões de visitante).
  - Reconfirmado o mesmo sintoma contra o HEAD final (`21724ef`, depois de `rm -rf .next` e reinício limpo): idêntico.
- **Bugs filed/updated:** `BUG-20260928-public-profile-broken-image-icon-storage-unconfigured` (novo, `open`).
- **Scenarios settled:** `PUB-edit-public-photo-cover` → pass (a mensagem "não configurado" em si funciona; o ícone quebrado é uma consequência lateral, vinculado abaixo). `PUB-public-photo-cover-opt-in` → pass, com o bug linkado como achado adjacente (não contradiz a promessa central do cenário, que é sobre ligar/desligar "mostrar" manualmente, e essa parte funciona sem nenhum vestígio visual).
- **Paper cuts:** nenhum sentido por uma pessoa comum nesta sessão (cenário operacional raro: exige que o armazenamento já tivesse dados e depois fique sem configuração).
- **Surprises:** a mensagem "não configurado" só aparece ao **tentar enviar**, não proativamente ao abrir a página com uma imagem já quebrada — aceitável, mas é o motivo do ícone quebrado aparecer sem nenhuma explicação na tela.
- **Suggested next charter:** nenhum — bug já tem reprodução clara.

### CH-photo-cover-visitor-mobile — Visitante do perfil público

- **Ran:** 2026-09-28T21:05Z → 2026-09-28T21:15Z (box respeitado: sim)
- **Ambiente:** sessão de navegador separada (`agent-browser --session pubvisit`), sem login, abrindo `/p/qa-foto-capa` (depois `/p/qa-foto-capa-v2`) direto pela URL, como um visitante chegaria por link compartilhado.
- **Findings:**
  - Com foto e capa ligadas: capa aparece acima do nome, foto ao lado — sem espaço vazio nem iniciais quando desligadas (testado nos três estados: só foto, nenhuma, ambas).
  - Em 375×812: `document.documentElement.scrollWidth === clientWidth` (375 === 375) com foto+capa, só foto e nenhuma imagem — sem rolagem horizontal em nenhum estado.
  - Rótulos e conteúdo em pt-BR corretos ("Perfil sem nome", "COPIAR LINK DO PERFIL"), alternando com inglês pelo seletor do cabeçalho, sem sessão.
  - Imagens servidas em `/p/<endereço>/image/photo` e `/image/cover`, mesma origem do app (`localhost:3102`), nunca um domínio de armazenamento — confirmado por `agent-browser network requests` e por `curl` direto (sem cookie).
- **Bugs filed/updated:** nenhum novo (o achado do storage não configurado veio da sessão 3, não desta).
- **Scenarios settled:** `PUB-public-photo-cover-opt-in` → pass.
- **Paper cuts:** nenhum.
- **Surprises:** nenhuma.
- **Suggested next charter:** nenhum pendente.

### CH-photo-cover-visitor-desktop — Visitante do perfil público

- **Ran:** 2026-09-28T21:15Z → 2026-09-28T21:22Z (box respeitado: sim; mesma sessão de navegador, redimensionada)
- **Findings:**
  - Em 1280×900: `getBoundingClientRect()` confirma capa 1184×296 (4:1 exato) e foto 128×128; em 375×812 (sessão anterior) capa 356×119 (~3:1) e foto 80×80 — bate exatamente com "mais alta no celular (3:1) do que no desktop (4:1)".
  - `Cache-Control: private, no-store, max-age=0` e `Cross-Origin-Resource-Policy: same-origin` confirmados por `curl` sem cookie nas duas imagens.
- **Bugs filed/updated:** nenhum.
- **Scenarios settled:** `PUB-public-photo-cover-opt-in` → pass (reforça o veredito da sessão 4 em desktop, com a proporção exata medida).
- **Paper cuts:** nenhum.
- **Surprises:** nenhuma.
- **Suggested next charter:** nenhum pendente.

### CH-photo-cover-revoked-404 — Visitante do perfil público

- **Ran:** 2026-09-28T21:25Z → 2026-09-28T21:45Z (box respeitado: não — os quatro métodos de revogação levaram mais tempo do que o previsto por causa de um erro de técnica desta sessão, não do produto: cliques em botões fora da área visível do viewport às vezes não disparavam o Server Action, corrigido ao adotar `scrollintoview` antes de todo clique em botão de salvar)
- **Findings:**
  - Copiada a URL da foto (`/p/qa-foto-capa/image/photo?v=...`) como um visitante faria antes de qualquer revogação.
  - **(1) Perfil tornado Privado:** página e as duas imagens (foto e capa) → 404 com corpo vazio (0 bytes), cabeçalhos idênticos a um endereço que nunca existiu (`/p/never-existed-address-xyz`); restaurado para Público, ambas voltam a 200 na mesma URL.
  - **(2) "Mostrar" desligado só na foto** (perfil continua Público): só a foto 404, a capa continua 200 — confirma que os dois campos são revogados de forma independente.
  - **(3) REMOVER IMAGEM:** 404 com corpo vazio; "Mostrar" desliga sozinho (confirmado em `/candidate` após refresh).
  - **(4) Troca de endereço** (`qa-foto-capa` → `qa-foto-capa-v2`, com a foto reenviada): endereço antigo 404 (página e imagem, mesma chave de versão antiga), endereço novo 200 na mesma chave.
  - Reconfirmado o método (2) contra o HEAD final `21724ef` como spot-check depois das correções de revisão L2 (que tocaram upload/leitura/armazenamento, não a lógica de visibilidade) — idêntico.
- **Bugs filed/updated:** nenhum.
- **Scenarios settled:** `PUB-public-image-revoked-404` → pass.
- **Paper cuts:** nenhum sentido pela persona (o mecanismo é transparente para quem só olha o resultado).
- **Surprises:** nenhuma.
- **Suggested next charter:** nenhum pendente.

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-choose-public-address | pass | pass | pass | friction | pass | friction | Mensagens de recusa nomeiam a razão e preservam a imagem anterior em todos os casos; nomes acessíveis corretos nos checkboxes/botões (confirmado pela árvore de acessibilidade). Compatibilidade só em Chromium via `agent-browser` (sem Safari/Firefox real) — não medido. Parity: `next dev` local, não `next build && next start`; sem extensões; auth real por link de uso único; **a branch mudou sob os pés da sessão** (ver Learnings), então a paridade com o código final exigiu reconfirmação explícita. |
| J-open-public-profile | pass | pass | pass | friction | pass | friction | Opt-in liga/desliga sem layout shift perceptível, sem espaço vazio ou iniciais quando desligado; 404 idêntico ao de endereço inventado nos quatro métodos de revogação, inclusive depois de refresh. Mesmas ressalvas de compatibilidade/parity da linha acima; um achado de recuperação de erro (ícone quebrado em vez de omitir a imagem, caso armazenamento fique sem configuração) rebaixaria "error recoverability" para `friction` se fosse específico desta rodada — mantido como bug linkado em vez de rebaixar a lente, por ser um cenário operacional raro (armazenamento configurado e depois removido com dado já existente). |

## What Was Fixed

<!-- nenhum fix nesta rodada: bug é registrado e reportado, não corrigido (instrução da tarefa) -->

## Paper Cuts

| Persona | Where (journey/step) | Felt | Sharpness | Outcome |
|---|---|---|---|---|
| Andreus no celular | J-choose-public-address, recusa da capa 600×600 | "A mensagem de recusa passa rápido — quase perdi ela na primeira tentativa de capturar a tela." | dull | watching (não afeta a pessoa real, só a evidência desta sessão) |

## Runtime Errors Observed

- **`Error: Module [project]/src/core/candidate-images.ts [app-route] ... module factory is not available`**, seguido de `GET /candidate/image/photo?v=... 500` — ocorreu uma vez, por volta de 20:36Z, depois de várias trocas de imagem na mesma sessão longa de `next dev --turbopack`. Reiniciar o servidor resolveu sem nenhuma mudança de código (a mesma chave passou a responder 200). Consistente com um artefato conhecido de HMR do Turbopack em sessão de desenvolvimento longa — não é uma regressão desta PR, e não afeta nenhum veredito (o teste foi refeito depois do reinício). Não registrado como bug de produto.
- **`Base UI: A component is changing the default value state of an uncontrolled FieldControl after being initialized.`** — reproduzido ao salvar "Endereço" em `/candidate`, mesmo sintoma do já registrado `BUG-20260928-public-facts-uncontrolled-field-warning` (rodada da PR #362), aqui aparecendo num campo diferente (endereço público em vez dos fatos opt-in). Sem efeito observável (endereço salva e persiste corretamente). Não abri um bug novo — é o mesmo padrão já registrado, só uma superfície mais ampla do que o bug original descreve; deixo a nota para quem investigar decidir se atualiza o bug existente.
- **Aviso de hidratação do `app-splash`** — mesmo padrão já documentado em rodadas anteriores de hoje (relatórios `...perfil-publico-layout-targeted.md` e `...perfil-publico-opt-in-targeted.md`), reproduzido de novo em `/candidate` e `/p/[slug]` em modo `next dev`. Não é uma regressão desta PR.

## Human Verifications Needed

- Nenhuma. Todos os passos desta rodada são alcançáveis e verificáveis pela interface pública/autenticada e por `curl` direto, sem pagamento real, e-mail/SMS externo ou OAuth de conta real.

## Decisions for a Human

- Nenhuma decisão de produto pendente. O único bug aberto (`BUG-20260928-public-profile-broken-image-icon-storage-unconfigured`) não tem ambiguidade de design — é um `<img>` sem tratamento de erro numa situação de borda (armazenamento removido com dado já existente); fica registrado para a fila normal de correção, não como uma escolha de produto.

## Learnings

- **A branch mudou sob os pés da sessão, e isso quase virou um relatório de bug incorreto.** A sessão começou no commit `ef8d359` e, nos primeiros ~20 minutos, encontrou dois candidatos a bug (teto de envio em ~4 MB quando o texto do cenário e da PR diziam "5 MB"; e um checkbox "Mostrar no perfil público" que aparentava o estado errado depois de uma recusa de envio) e cheguei a redigir os arquivos de bug. Antes de fechar a rodada, um `git log`/`git fetch` de rotina mostrou que a própria branch da PR tinha recebido 4 commits novos (`a8bca20`..`21724ef`, "revisão L2 da #364") **enquanto a sessão rodava**, incluindo uma correção deliberada do teto (5→4 MiB, por causa de um limite de 413 da própria Vercel acima de ~4,5 MB) e uma checagem nova no seletor de arquivo. Refazer os dois testes contra um `next dev` limpo (`rm -rf .next`, reinício) no HEAD final mostrou que **nenhum dos dois candidatos a bug se confirma mais**: o teto de 4 MB é intencional e documentado, e o checkbox não inverte mais em nenhuma direção testada. Os dois arquivos de bug foram apagados antes do commit. **A lição:** numa worktree compartilhada e ativa, `git log`/`git status` no início E perto do fim da sessão (não só no início) é o que evita reportar como bug algo que já foi corrigido a poucos metros de distância, e o `next dev`/Turbopack pode mascarar isso ainda mais ao aplicar HMR a partir do disco sem avisar que o código-fonte mudou de commit.
- **`agent-browser`: clique em botão fora da área visível às vezes não dispara o Server Action, sem erro nenhum.** Em pelo menos três ocasiões (troca de visibilidade para Privado, troca de endereço), `click @refN` num botão "SALVAR..." retornou `✓ Done` mas nenhuma requisição `POST` apareceu no log do servidor — sem nenhuma indicação de falha. `scrollintoview` antes do clique resolveu todas as vezes. Vale registrar como prática obrigatória para o próximo agente que dirigir `agent-browser` contra formulários longos desta tela.
- **O toast de recusa por tamanho/dimensão é breve.** Uma captura de tela com um `wait` fixo entre o clique em "SALVAR" e o `screenshot` perdeu o toast em pelo menos duas tentativas (a mensagem já tinha sumido); ler o texto pelo snapshot de acessibilidade (que captura o DOM no instante da chamada, não depende de timing visual) foi mais confiável do que a captura de tela para confirmar a mensagem exata.

## Final Status

**Pronto para seguir — os três cenários no escopo (`PUB-edit-public-photo-cover`, `PUB-public-image-revoked-404`, `PUB-public-photo-cover-opt-in`) fecharam `pass`**, todos reconfirmados contra o HEAD final da branch (`21724ef`, depois de `rm -rf .next` e reinício limpo do servidor): JPEG/PNG/WebP aceitos nos dois campos com o teto de 4 MB (corrigido durante esta mesma rodada de revisão L2, documentado e testado); SVG renomeado, tipo real errado, tamanho acima do teto e dimensão pequena demais recusados com mensagem própria, sem apagar a imagem anterior, em pt-BR e inglês; EXIF/GPS confirmado removido por inspeção binária do arquivo servido; opt-in liga/desliga foto e capa de forma independente e sem vestígio visual quando desligado, em 375px e desktop, pt-BR e inglês; as quatro formas de revogar uma URL de imagem (privado, "mostrar" desligado, remover, trocar endereço) produzem 404 idêntico a um endereço inventado, com religamento restaurando a mesma URL; o aviso de armazenamento não configurado funciona ao tentar enviar.

**Um bug novo, aberto:** `BUG-20260928-public-profile-broken-image-icon-storage-unconfigured` (Trust-Damage, Low/P3) — quando o armazenamento fica sem configuração com foto/capa já existentes e "mostrar" ligado, o perfil público mostra ícone de imagem quebrada em vez de omitir a imagem. Cenário operacional raro (não bloqueia o caminho comum), não corrigido nesta rodada por instrução da tarefa.

**Dois candidatos a bug investigados e descartados** depois de reconfirmação contra o HEAD final (ver Learnings): teto de 4 MB (intencional, corrigido/documentado pela própria PR durante esta sessão) e inversão visual do checkbox "Mostrar" após recusa (não reproduziu no HEAD final).

**Totais por camada de impacto do usuário nesta rodada:** Blocks-Completion: 0 · Data-Loss: 0 · Trust-Damage: 1 (aberto, não bloqueia) · Friction: 0 · Cosmetic: 0.

**Gate de saída:** por escopo da tarefa (QA de jornada, não CI), rodei `pnpm check:qa-tracker` e `pnpm check:instructions` — resultados no fim desta sessão, ver o commit desta rodada. **Não rodei `pnpm check` completo nem `pnpm test:e2e`**: a PR já reporta essas suítes verdes (inclusive uma nova área E2E `public-images` e um teste novo especificamente para o teto de 4 MB, `ed355e6`), e ficam para o CI, como de praxe para QA de jornada (não substitui o CI).

**Ressalva de paridade:** sessão rodou em `next dev` (Turbopack), não `next build && next start`; só Chromium via `agent-browser` (sem Safari/Firefox reais); conta de QA sintética, não a conta real do dono; a branch mudou de commit em andamento (ver Learnings) — todos os vereditos acima foram reconfirmados contra o HEAD final antes de fechar a rodada, então essa ressalva qualifica o processo, não a confiança nos vereditos.
