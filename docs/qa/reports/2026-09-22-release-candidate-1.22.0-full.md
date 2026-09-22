# QA Run Report — 2026-09-22 — release candidate 1.22.0 (Full)

- **Scope:** Full do release candidate que a PR #257 promove de `staging` para produção. Foco nas mudanças desde a 1.21.2: isolamento entre contas (#240/#241), criar o próprio perfil (#234/#243), endereço público `/p/<slug>` (#235/#250), Minha conta (#236/#242), recuperação sem link no log hospedado (#239), autorização em toda entrada (#233), LinkedIn bloqueado (#232), overlay suave nos filtros (#238), tela 403/404 (#244), busca por termo indexada (#253), e regressão das jornadas principais em 375 px e em inglês.
- **Cadence tier:** full
- **Build:** `13079d1` (= `origin/staging`, release 1.22.0) · **Environment:** `node tests/e2e/run-isolated.mjs --manual` — build standalone de produção, PostgreSQL temporário isolado, `JHO_AUTH_MODE=secure`, CLI restrita pelo `runtime.env` do harness. Nenhum acesso ao banco ou à URL de produção.
- **Started:** 2026-09-22 · **Status:** closed <!-- in-progress | closed -->

## Driver

As sessões usaram Playwright (Chromium, o mesmo pacote fixado do E2E) dirigido
por scripts de sessão, e não o `agent-browser`: a memória do projeto registra
que o cookie autenticado do `agent-browser` não sobrevive entre invocações, e
resolver isso primeiro é a instrução. Cada persona tem um arquivo de estado de
sessão próprio, que sobrevive entre execuções; a sanidade foi conferida no
começo (login real, segunda invocação já autenticada, `/admin/users` visível só
para o admin). Toda interação e toda verificação passaram pela interface
pública — cliques, teclado, formulários e leitura da página. O banco não foi
lido nem escrito; a CLI pública (`jho auth add-user`, `set-password`, `track`)
preparou contas e provocou a mudança concorrente do funil.

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Candidato convidado sem perfil | `nina@` (recrutadora promovida a candidata em `/admin/users`), `ada@` (admin) | 375×812 touch, en | CH-account-isolation-first-entry |
| Recrutadora convidada | `renata@local.test` | 375×812 en e 1280×800 pt-BR | CH-account-isolation-first-entry, varredura |
| Andreus em triagem noturna | `alex@local.test` (admin+candidate) | 1280×800 pt-BR | CH-own-account-sessions (sessão emprestada), funil, trilhas |
| Andreus em triagem noturna (contas de teste) | `bruno@`, `carla@`, `daniel@` | 1280×800 e 375×812 pt-BR | CH-own-account-sessions |
| Operador somente por teclado | `carla@local.test` | teclado apenas | AUTH-account-wrong-current-password |
| Andreus no celular | `alex@local.test` | 375×812 touch, pt-BR e en | CH-public-address-change, CH-release-regression-sweep |
| Visitante do perfil público | anônimo | 414×896 e 375×812, en | CH-public-address-change |
| Candidato após falha | anônimo e `daniel@` | 1280×800 pt-BR | recuperação de senha |

## Flows in Scope

- `J-trust-the-filtered-board` — **P0**
- `J-switch-workspace-screen` — **P0**
- `J-preserve-application-decision` — **P0**
- `J-recover-offline-access` — **P0** (bloqueada: exige PWA instalada)
- `J-coordinate-task-delivery` — **P0** (fora: escritor da regra 24 não está ativo)
- `J-create-own-profile` — **P1**
- `J-manage-own-account` — **P1**
- `J-open-dashboard-direct` — **P1**
- `J-find-jobs-by-work-mode` — **P1**
- `J-save-term-search`, `J-manage-target-tracks`, `J-refresh-candidate-ranking` — **P1** (canárias)
- `J-choose-public-address`, `J-open-public-profile` — **P2**, no escopo por serem mudança desta release

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | CH-account-isolation-first-entry | J-create-own-profile / PROF-create-own-profile, -identity, -address, -double-submit, AUTH-create-profile-refused-roles, AUTH-shared-candidate-denied, NAV-denied-screen-below-header | Candidato convidado sem perfil | Garbage Collector's | Pass | | |
| 2 | CH-account-isolation-first-entry | J-create-own-profile / ADMN-new-account-password-hint | Andreus em triagem | Garbage Collector's | Fail | BUG-20260922-admin-password-hint-wrong-command | |
| 3 | CH-own-account-sessions | J-manage-own-account / AUTH-account-change-password, -rename, -wrong-current-password, ADMN-borrowed-session-account-readonly | Andreus em triagem noturna | Saboteur | Pass | | |
| 4 | CH-own-account-sessions | J-manage-own-account / AUTH-recovery-same-answer | Candidato após falha | Saboteur | Fail | BUG-20260922-local-reset-link-https | |
| 5 | CH-own-account-sessions | J-manage-own-account / AUTH-recovery-link-withheld-hosted | Candidato após falha | Saboteur | Blocked (needs human verify) | exige deployment | |
| 6 | CH-public-address-change | J-choose-public-address / PUB-change-public-address, PUB-public-address-private-404, PUB-public-cv-protected-content | Andreus no celular | Antisocial | Pass | | |
| 7 | CH-public-address-change | J-choose-public-address / PUB-public-address-refusals | Andreus no celular | Antisocial | Fail | BUG-20260922-short-address-wrong-reason; BUG-20260922-long-address-cut-silently | |
| 8 | CH-public-address-change | J-open-public-profile / PUB-public-name-never-email | Visitante do perfil público | Antisocial | Fail | BUG-20260922-public-profile-shows-email-as-name | |
| 9 | CH-release-regression-sweep | J-switch-workspace-screen / NAV-same-screen-soft-transition, NAV-switch-screen-ready | Andreus no celular | Landmark | Pass | | |
| 10 | CH-release-regression-sweep | J-trust-the-filtered-board / JOBS-term-filter-descriptions, -filter-fields-follow-url, -not-interested, -detail-owner-view-english, -country-hub, -country-only-blocked, -track-selector-fit | Andreus no celular | Landmark | Pass | | |
| 11 | CH-release-regression-sweep | J-find-jobs-by-work-mode / JOBS-work-mode-continuity, JOBS-work-mode-mobile | Andreus no celular | Landmark | Pass | | |
| 12 | CH-release-regression-sweep | J-preserve-application-decision / PIPE-note-on-unchanged-stage, PIPE-refused-transition-keeps-draft | Andreus em triagem noturna | Landmark | Pass | | |
| 13 | CH-release-regression-sweep | varredura de 20 rotas em 375 px e inglês (dono e recrutadora) | Andreus no celular | Landmark | Pass | | |
| 14 | CH-release-regression-sweep | J-save-term-search / SRCH-mobile-layout (reteste do estouro) | Andreus no celular | Landmark | Blocked (needs human verify) | toque real e zoom do iPhone | |
| 15 | CH-release-regression-sweep | J-trust-the-filtered-board / CLI-linkedin-job-never-fetched | Andreus em triagem noturna | Landmark | Blocked (needs human verify) | `jobs verify` recusado no ambiente isolado | |
| 16 | CH-offline-installed-recovery | J-recover-offline-access / PWA-* | Andreus no celular | — | Blocked (needs human verify) | exige PWA instalada em aparelho real | |
| 17 | CH-task-worktree-handoff | J-coordinate-task-delivery / CLI-task-* | Operador somente por teclado | — | Skipped | escritor da regra 24 inativo; escrita no Project proibida nesta tarefa | |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Session Debriefs

### CH-account-isolation-first-entry — Candidato convidado sem perfil, Recrutadora convidada

- **Findings:**
  - A conta de papel candidato sem candidato (recrutadora promovida em `/admin/users`) entra em `/jobs` e só vê **Jobs, Create my profile e My account**. `/candidate/skills`, `/candidate/vocabulary`, `/searches`, `/pipeline`, `/referrals` e `/compare` respondem **403**, também após reload. Nenhum texto do dono (nome, e-mail, headline, nota de `profile.yaml`) aparece em nenhuma tela; o quadro de vagas mostra as notas como "—", não as do dono.
  - Recrutadora, admin sem papel candidato e o admin **assumindo** a conta sem perfil recebem 403 em `/candidate`, sem formulário e sem o link na navegação.
  - Criar o perfil em 375 px e em inglês: `bruno` (em uso), `admin` (reservado), `Nina Prado` (formato) e `ab` (curto) são recusados com a razão certa, e os campos preenchidos ficam. Currículo abaixo de 100 caracteres é recusado antes — e esconde a razão do endereço até ser corrigido. Com `nina-prado` e **dois toques simultâneos** em Create profile, nasce um candidato só (#7, sem id pulado) e uma versão de CV. Com o endereço em branco, a conta Ada ganhou `ada-admin`, derivado do nome.
  - Contas criadas por `/admin/users` (Otto) e por `jho auth add-user` (Pia) entram direto num perfil vazio **próprio**.
  - O estado "conta apontada para o candidato do dono" (o incidente da #240) não é mais alcançável por nenhuma interface: admin e CLI criam candidato próprio, e há índice único. O cenário foi percorrido pelas formas que existem.
  - 403 e 404 começam **32 px abaixo do cabeçalho** em 375 e 1280, pt-BR e en; o botão Voltar ao início tem 44 px, flex centralizado (#244 confirmado).
- **Bugs filed/updated:** BUG-20260922-admin-password-hint-wrong-command
- **Scenarios settled:** PROF-create-own-profile, PROF-create-own-profile-identity, PROF-create-own-profile-address, PROF-create-own-profile-double-submit, AUTH-create-profile-refused-roles, AUTH-shared-candidate-denied, NAV-denied-screen-below-header → pass; ADMN-new-account-password-hint → fail
- **Paper cuts:** a orientação de senha em `/admin/users` (virou bug); a validação do currículo curto encobre a do endereço
- **Surprises:** nenhuma

### CH-own-account-sessions — Andreus em triagem noturna, Operador somente por teclado, Candidato após falha

- **Findings:**
  - Com duas sessões de `bruno`, trocar a senha numa mantém esta conectada após reload e derruba a outra para `/login`. Senha antiga recusada ("E-mail ou senha incorretos."), nova entra. Confirmação diferente é recusada com a razão.
  - Pelo teclado, cinco senhas atuais erradas dão "Senha atual incorreta."; a sexta, **certa**, recebe "Tentativas demais. Espere 15 minutos e tente de novo." e nada muda — a senha antiga continua entrando.
  - Nome de exibição trocado em 375 px aparece confirmado, sobrevive ao reload e está no topo em 1280. Nome em branco é recusado sem apagar o anterior.
  - Assumindo a identidade de Nina, Minha conta mostra "Sessão emprestada: a conta de outra pessoa não pode ter senha, e-mail nem nome alterados daqui", o e-mail só para leitura, e nenhum formulário. Nina entrou depois com a própria senha.
  - Recuperação: `daniel@local.test` e `ninguem-aqui@local.test` chegam à **mesma URL** (`/login/forgot?sent=1`) com o **mesmo texto**. O link (terminal do servidor, processo local) troca a senha, derruba a sessão aberta de Daniel e, reaberto, diz "Este link não vale mais". Mas o link sai como `https://127.0.0.1:…` e o servidor local só fala HTTP — não abre sem trocar o esquema à mão.
  - A metade hospedada da #239 (log sem link) só se prova num deployment.
- **Bugs filed/updated:** BUG-20260922-local-reset-link-https
- **Scenarios settled:** AUTH-account-change-password, AUTH-account-rename, AUTH-account-wrong-current-password, ADMN-borrowed-session-account-readonly → pass; AUTH-recovery-same-answer → fail; AUTH-recovery-link-withheld-hosted → blocked-verify
- **Paper cuts:** depois de enviar Minha conta pelo teclado, o foco volta ao `body` — o alerta é anunciado, mas quem navega por teclado recomeça do topo
- **Surprises:** nenhuma

### CH-public-address-change — Andreus no celular, Visitante do perfil público

- **Findings:**
  - Em `/candidate`, a 375 px: `meu endereco`, `joão`, `-abc`, `admin`, `login`, `api`, `bruno` e `nina-prado` são recusados com a razão, o campo guarda o que foi digitado e o endereço atual não muda. `ab` é recusado, mas com a razão de **formato**, não de tamanho (o formulário de criação dá a certa). Colar 41 caracteres **salva os primeiros 40** com "Endereço salvo." — o `maxlength` do campo corta antes de o servidor poder recusar.
  - Público + CV publicado: `/p/alex-ribeiro` mostra o texto profissional com e-mail, `(11) 91234-5678`, `+55 11 91234-5678` e a pretensão salarial trocados por `[…]` ou ausentes, antes e depois do reload.
  - Trocar para `alex-r`: o novo responde 200 e o antigo **404**, após reload, sem redirecionamento. O dono segue vendo o funil.
  - Com Recrutadores e com Privado: o endereço atual, o antigo, `/p/1` (id interno) e um inexistente dão 404 com **texto idêntico**.
  - **Achado de privacidade:** a conta criada por `jho auth add-user` (Pia) tem o e-mail como nome do candidato. Ao publicar, `/p/pia-qa` mostra `pia@local.test` para qualquer visitante — contra a promessa escrita na própria tela ("Nunca aparecem em perfil público: e-mail…"). Trocar o nome em Minha conta não corrige, e `/candidate` não tem campo de nome.
- **Bugs filed/updated:** BUG-20260922-public-profile-shows-email-as-name, BUG-20260922-short-address-wrong-reason, BUG-20260922-long-address-cut-silently
- **Scenarios settled:** PUB-change-public-address, PUB-public-address-private-404, PUB-public-cv-protected-content → pass; PUB-public-address-refusals, PUB-public-name-never-email → fail
- **Paper cuts:** —
- **Surprises:** o nome do candidato criado pela CLI

### CH-release-regression-sweep — Andreus no celular

- **Findings:**
  - **Varredura:** 20 rotas do dono e 5 da recrutadora em 375 px e inglês — nenhum estouro horizontal, nenhum texto acentuado fora de dado do acervo, nenhum erro de console. Única ocorrência de acento: a descrição da vaga em `/jobs/1`, dado de fixture.
  - **Transição suave (#238):** modalidade, ordem, densidade, tamanho de página, preset, Voltar e Avançar em `/jobs` não criam overlay nem `inert`; o shell ganha `aria-busy` e `data-navigation=soft`, o `main` esmaece para ~0,8, "Updating this screen" é anunciado, e a tela fica pronta em ~460 ms. Dois cliques rápidos (Remote → On-site) terminam em On-site. Trocar de tela pelo menu (→ Pipeline) usa o overlay com "Loading the next screen", liberado em ~450 ms.
  - **Busca por termo (#253):** `typescript` e `observabilidade` acham vagas só pela descrição; `type` e `java` não acham pedaço de palavra; empresa e título acham; frase e termo acentuado funcionam; o termo sobrevive ao reload e combina com modalidade.
  - **Quadro:** modalidade permanece após busca, tamanho de página, Voltar e recarga; campo de score segue a URL depois de preset e Voltar; "Não me interessa" arquiva, some de Vagas e do cockpit e "restaurar" devolve; vaga "United States only" fica bloqueada e fora de Aplicáveis hoje; o hub de países abre pela linha agrupada; a segunda trilha reordena e o detalhe mostra o fit de cada trilha.
  - **Funil:** nota com estágio inalterado é gravada e aparece após reload. Com "Preparando" e nota digitados, a CLI arquivou a vaga **por fora**; Salvar recusou com "O funil não vai de Arquivada para Preparando. Sua nota continua aqui", a nota ficou no campo e o seletor passou a oferecer só estágios alcançáveis.
  - **LinkedIn (#232):** vaga cadastrada com URL do LinkedIn é guardada e exibida com a fonte `linkedin.com`. `jho jobs verify --dry-run` recusa rodar no ambiente isolado ("Ingestion blocked in preview"), então o "inconclusivo, sem pedido" ficou para verificação humana — a prova de efeito está em `tests/linkedin-acquisition-boundary.test.ts`.
- **Bugs filed/updated:** nenhum
- **Scenarios settled:** NAV-same-screen-soft-transition, NAV-switch-screen-ready, JOBS-term-filter-descriptions, JOBS-work-mode-continuity, JOBS-work-mode-mobile, JOBS-filter-fields-follow-url, JOBS-not-interested, JOBS-detail-owner-view-english, JOBS-country-hub, JOBS-country-only-blocked, JOBS-track-selector-fit, PIPE-note-on-unchanged-stage, PIPE-refused-transition-keeps-draft → pass; CLI-linkedin-job-never-fetched → blocked-verify
- **Paper cuts:** "0 novas · ver vagas" com 19 px de altura; trilha recém-criada ordena Vagas sem nota guardada e a lista não avisa
- **Surprises:** nenhuma

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-create-own-profile | pass | pass | pass | pass | pass | pass | recusas nomeiam a razão e preservam os campos; duplo toque seguro; 375 px e en limpos |
| J-choose-public-address | friction | pass | pass | pass | friction | pass | razão errada para `ab`, corte silencioso em 41, e-mail como nome público na conta da CLI |
| J-manage-own-account | pass | friction | pass | pass | pass | friction | foco volta ao body após envio por teclado; link local de recuperação em https |

## What Was Fixed

Nada nesta rodada. Os achados são de correção de produto e ficam em Decisions
for a Human; esta PR é só `docs/qa`.

## Paper Cuts

| Persona | Where (journey/step) | Felt | Sharpness | Outcome |
|---|---|---|---|---|
| Operador somente por teclado | J-manage-own-account, enviar o formulário | "o erro foi anunciado, mas estou de novo no topo da página" | dull | observando |
| Andreus no celular | J-save-term-search, cartão do termo | "o link de novas é baixo para o dedo" (19 px) | dull | observando |
| Andreus em triagem noturna | J-manage-target-tracks, primeira troca para a trilha nova | "a ordem mudou, mas não sei se já é pela nota desta trilha" | dull | observando |
| Candidato convidado sem perfil | J-create-own-profile, currículo curto | "corrigi o endereço e só depois descobri que ele também estava errado" | dull | observando |

## Runtime Errors Observed

- Nenhum erro de console nas 25 rotas da varredura nem nas sessões.
- A CLI restrita recusa `jho jobs verify` no ambiente isolado ("Ingestion blocked in preview") — é a política de ingestão por ambiente, não defeito.

## Human Verifications Needed

- [ ] **Log hospedado da recuperação (#239, `AUTH-recovery-link-withheld-hosted`):** num deployment sem `RESEND_API_KEY` (preview ou produção — hoje a #237 segue aberta), pedir a recuperação de uma conta de teste em `/login/forgot` e ler o log da função na Vercel. Deve haver só o alerta, sem destinatário, assunto, token nem link.
- [ ] **LinkedIn na verificação de links (`CLI-linkedin-job-never-fetched`):** numa máquina local com ingestão liberada, cadastrar uma vaga com URL `linkedin.com/jobs/view/…` acima do corte e rodar `jho jobs verify --dry-run`: a vaga sai inconclusiva e continua aberta.
- [ ] **PWA instalada (seis cenários `PWA-*`)** e **leitor de tela** (`NAV-accessible-mobile-transition`): como na 1.13.1, exigem aparelho real.
- [ ] **Buscas no iPhone (`SRCH-mobile-layout`):** toque real, nome de trilha longo e ausência de zoom ao focar o seletor.
- [ ] **Preview da Vercel da PR #257** está em "Deployment rate limited — retry in 24 hours"; o smoke do preview não pôde ser feito.

## Decisions for a Human

1. **BUG-20260922-public-profile-shows-email-as-name (High, Trust-Damage, privacidade).** Nasceu nesta release (`addUser` → `claimOwnCandidate({ name: email })`). Só atinge conta criada por `jho auth add-user` que depois fica Pública — hoje a conta dona usa o `profile.yaml`, e as contas de `/admin/users` usam o nome digitado.
   - Opção A (recomendada): corrigir antes de mesclar a #257 — `add-user` sem nome deixa o candidato sem nome público (ou deriva da parte local do e-mail), e `publicProfile()` recusa publicar um nome que seja e-mail. Pequena, com teste de unidade.
   - Opção B: promover e corrigir em hotfix, com a regra operacional de não criar contas de candidato pela CLI até lá.
2. **Os quatro bugs de Friction** (orientação de senha com comando errado, link local https, razão errada para `ab`, corte silencioso em 41) não bloqueiam; sugestão de um lote de correção depois da promoção.

## Final Status

**O release candidate 1.22.0 está pronto para a PR humana `staging → main` com
uma ressalva que é decisão do dono:** o achado de privacidade do nome público
(High) — veja Decisions for a Human. Nenhum Blocks-Completion nem Data-Loss.

As mudanças de maior risco da leva passaram onde podiam errar: nenhuma conta sem
candidato viu dado do dono em nenhuma rota, direta ou emprestada; a sessão
emprestada não escreve em Minha conta nem cria perfil; trocar a senha derruba as
outras sessões; a recuperação não distingue conta existente; perfil não público
responde 404 idêntico em qualquer endereço; o CV público esconde e-mail,
telefone e piso; a transição suave não trava a tela; e a recusa do funil foi
provocada por concorrência real, pela CLI.

| Impacto | Encontrados | Corrigidos | Abertos |
|---|---:|---:|---:|
| Blocks-Completion | 0 | 0 | 0 |
| Data-Loss | 0 | 0 | 0 |
| Trust-Damage | 1 | 0 | 1 |
| Friction | 4 | 0 | 4 |
| Paper cut | 4 | 0 | 4 (observando) |

Cenários desta rodada: **27 pass, 4 fail, 3 blocked-verify** (dois novos mais o
reteste de `SRCH-mobile-layout`). Não percorridos, com motivo: os dois
`CLI-task-*` (escritor da regra 24 inativo; escrita no Project fora desta
tarefa), `NAV-first-party-navigation-contract` (só a metade de menu e filtros foi
vista; redirect para a mesma tela e "nenhuma ação se repete" ficaram
`untested`), `PWA-direct-load-startup-singleton`, `CLI-term-search-commands`
(capturas desligadas) e os `SRCH-*` que já estavam `blocked-decision` pela
rodada de Buscas.

**Jornadas P0 não verificadas:** `J-recover-offline-access` (PWA instalada) e
`J-coordinate-task-delivery` (ativação da regra 24). Declarado aqui, não
escondido na contagem.

Suíte automatizada do mesmo commit: o CI da PR #257 fechou `qualidade` e
`schema-e-migracao` **verdes**; o check `Vercel` falhou por limite de deploy da
conta ("Deployment rate limited — retry in 24 hours"), não por código. Esta PR
é só de `docs/qa`; a validação estrutural `pnpm check:qa-tracker` passou
(82 cenários).

Evidência local (ignorada pelo Git): `docs/qa/evidence/2026-09-22-rc-1.22.0/`,
com `log.txt` de todas as sessões e as capturas citadas nos cenários.
