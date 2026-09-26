# Regras de segurança, privacidade e ação externa

Referência normativa do domínio de segurança. A entrada comum
([AGENTS.md](../../../AGENTS.md)) resume as invariantes críticas; aqui fica o
detalhe: obrigação, escopo, exceções, origem e onde está a prova. O índice e o
procedimento de conflito estão em [README.md](README.md).

Os IDs `Gnn` vêm da [matriz da auditoria](../../../.compozy/tasks/governanca-regras/_audit.md).
"Regra N" é a numeração da entrada comum, mantida para que comentários de
código e testes que citam "regra N do CLAUDE.md" continuem apontando para o
lugar certo.

---

<a id="g01"></a>
## G01 — Nunca adquirir dados do LinkedIn (regra 1)

**Obrigação.** Nada neste repositório raspa o LinkedIn, lê o cookie `li_at`,
dirige sessão autenticada ou usa "LinkedIn MCP" não oficial. Isso viola a
§8.2 do User Agreement e arrisca a conta, que é o principal ativo de
posicionamento do usuário.

**Permitido.** Publicação pela API oficial (`w_member_social`); comentários e
conexões **assistidos** (o agente redige, a pessoa executa); **job alert por
e-mail**, que é a via legítima (ADR 0008); guardar e exibir uma URL do
LinkedIn vinda de alerta ou cadastro manual — guardar não é buscar.

**Como o runtime garante.** `assertSafeRemoteUrl` recusa `linkedin.com`,
`linkedin.cn`, `lnkd.in`, `licdn.com` e subdomínios antes do DNS, e
`safeRemoteFetch` repete a checagem em cada salto de redirect. `jobs verify`
devolve `inconclusive` sem pedido (nunca fecha a vaga); `scrape run` bloqueia
antes do `robots.txt`. O inventário de transporte de saída é fechado.

**Limite declarado.** A recusa casa pelo nome do host; scripts avulsos,
navegador, ferramentas de agente e MCPs ficam fora do runtime e são cobertos só
pela política. Domínio público, `robots.txt` permissivo ou HTTP 200 **não**
autorizam a aquisição.

Origem: regra 1. Detalhes: [linkedin-policy.md](../../linkedin-policy.md) §5.1,
[ADR 0001](../../adr/0001-nao-fazer-scraping-do-linkedin.md),
[ADR 0008](../../adr/0008-ingestao-de-email-como-fonte-de-sourcing.md).
Prova: `tests/linkedin-acquisition-boundary.test.ts`,
`tests/outbound-transport-boundary.test.ts`.

<a id="g09"></a>
## G09 — Não inventar evidência (regra 7)

**Obrigação.** Tailoring de CV, dossiê, cover letter e qualquer texto que fale
pela pessoa citam somente o que está em `evidence:` no `profile.yaml`. O que
está em `growth:` é lacuna assumida — sinalize, nunca maquie. Skill detectada
não é skill confirmada.

**Escopo.** Vale para código, prompts de LLM, skills e agentes. Texto livre
produzido por agente continua exigindo revisão humana: o teste prova o dossiê,
não certifica toda redação livre.

Origem: regra 7. Detalhes: [docs/prompts/system/](../../prompts/system/README.md),
[matching-and-evidence.md](matching-and-evidence.md) (uso no score).
Prova: `tests/cov-apply-dossier.test.ts` (fixture adversa com alegação só em
`growth`), `tests/cov-skills-domain.test.ts`.

<a id="g37"></a>
## G37 — Nada envia candidatura (regra 13)

**Obrigação.** O sistema prepara; quem envia é a pessoa. `jho prep` monta o
dossiê e imprime o link de candidatura como texto. Nenhum código, skill,
comando ou agente submete candidatura, documento ou mensagem a empregador ou
ATS. Automatizar o envio antes de a triagem estar calibrada acelera o gargalo
errado, e candidatura enviada não volta.

**Proibido como "solução".** Criar serviço de submissão "desabilitado" ou
adapter de candidatura: a regra protege a **ausência** da capacidade. A
[ADR 0010](../../adr/0010-submissao-autonoma.md) define as três condições para
reavaliar; mudar isso é decisão nova, não ajuste de implementação.

Origem: regra 13. Prova: `tests/cov-apply-dossier.test.ts` (transporte
instrumentado responde 200 a tudo e nenhum pedido sai),
`tests/outbound-transport-boundary.test.ts`.

<a id="g38"></a>
## G38 — Autenticação exigida por omissão (regra 14)

**Obrigação.** Nenhuma página nem API responde sem sessão válida — inclusive
`/api/export`, que carrega o acervo inteiro. O modo aberto existe mas precisa
ser pedido (`JHO_AUTH_MODE=open`) e só vale na máquina local: em deployment o
código ignora o pedido (`src/contexts/auth/domain/open-mode.ts`). Produção,
preview, staging, dev e valor desconhecido continuam exigindo login.

**Por quê.** "Só roda em loopback" protege contra a internet, não contra outro
processo, outra conta da máquina, nem contra um bind errado — que já aconteceu
aqui. Segurança por omissão é a omissão ser a opção segura.

**Primeiro acesso.** `jho auth add-user <email> --role admin,candidate` e
`jho auth set-password <email>`. Sem conta cadastrada, `/login` mostra esses
dois comandos em vez de um formulário sem saída.

Origem: regra 14. Detalhes: [security.md](../../security.md) ("Modo aberto só
na máquina local"). Prova: `tests/cli-first-access.test.ts` (o comando citado
na entrada comum e em `/login` funciona), testes de sessão e `open-mode`.

<a id="g39"></a>
## G39 — Toda entrada é guardada antes de dado ou efeito (regra 15)

**Obrigação.** Toda Server Action chama `guard(...)` **antes** de qualquer
efeito, e toda página chama `requirePage(...)` — guardar só as actions deixa o
dado legível por quem não tem sessão. `proxy.ts` é a rede grossa (existe
cookie?); a página é a checagem real (o cookie vale?).

**Exceções registradas, cada uma com o controle que substitui a sessão:**
`passwordLoginAction` (limite de tentativas), recuperação de senha (resposta
uniforme, token de uso único), `logoutAction` e `stopImpersonatingAction` (só
revogam/restauram o próprio cookie), preferência de interface
(`setLocaleAction`, `setAppearanceAction`), as telas pré-sessão `/login`,
`/login/forgot`, `/login/reset` e `/login/callback`, o cron por segredo
(`/api/cron/recheck`) e `/p/[slug]` (G21).

**Classes de superfície sem sessão** (resolve C02): conteúdo público
(`/p/[slug]`, único), pré-sessão (login, recuperação, callback), shell e
assets (`/offline.html`, manifest, estáticos) e serviço com autenticação
própria (cron). Rota desconhecida é privada.

**Descoberta.** O inventário acha toda página, Route Handler e export
`"use server"` pela semântica do Next; entrada nova sem política reprova, e
exceção órfã também. As exceções de action vivem em
`tests/support/entry-inventory.ts`, as de página e rota em
`tests/architecture.test.ts`. A descoberta é léxica: nas páginas ela prova a
presença do guarda, e a ordem das leituras é coberta pelos cenários por papel
do E2E.

Origem: regra 15. Detalhes: [security.md](../../security.md) ("Toda entrada tem
política"). Prova: `tests/entry-denial.test.ts` (negação antes de qualquer
escrita, cookie, revalidação ou rede), `tests/architecture.test.ts`.

<a id="g40"></a>
## G40 — Decisão por `can()`, escopo vindo da sessão (regra 15)

**Obrigação.** Autorização passa por `can()`; a decisão mora em
`src/contexts/auth/domain/policy.ts`, é pura e **nega por padrão**. Nenhuma
action aceita `candidateId` (ou outro identificador de posse) da própria
entrada — id em FormData, JSON ou parâmetro é pedido, não prova. O escopo nasce
da sessão.

Origem: regra 15. Prova: `tests/auth-policy.test.ts`,
`tests/entry-denial.test.ts` (ids da vítima numa sessão válida de outro
candidato e de recrutador vinculado).

<a id="g16"></a>
## G16 — Política correta precisa funcionar na composição

**Obrigação.** Não basta a política estar certa: login, redirecionamento e
guarda de cada tela precisam respeitá-la para cada papel. `job:read` é dos três
papéis, mas `/jobs` guardava por escopo de candidato e o login mandava todo
mundo para `/` — um recrutador entrava com a senha certa e recebia 403 em toda
tela. Cada metade estava correta sozinha, e por isso nenhum teste puro via.

**Prova exigida.** Cenário por papel em `pnpm test:e2e`. Mudança de política,
login ou guarda de tela revisa esses cenários.

Origem: AGENTS (invariante "Política correta não basta").

<a id="g24"></a>
## G24 — Admin assume identidade; não lê dado privado

**Obrigação.** Três papéis: `admin`, `candidate`, `recruiter`. Admin não lê
dado privado diretamente: ele assume a identidade, e isso fica registrado. A
sessão emprestada perde **toda** ação de administração em bloco, decidida por
`impersonatedBy !== null` e não por papel — o alvo pode ser outro admin.
Criar o próprio perfil de candidato também é negado à sessão emprestada.

Origem: AGENTS (invariante "Admin não lê dado privado"). Prova:
`tests/impersonation.test.ts`, `tests/entry-denial.test.ts`.

<a id="g25"></a>
## G25 — Vínculos e contas não dão acesso por procuração

**Obrigação.** Ninguém além do próprio candidato cria vínculo
recrutador↔candidato, e nenhuma conta nova é apontada para candidato
existente: os dois seriam leitura de CV alheio por procuração. Conta nova de
papel candidato cria o **próprio** candidato (linha nova, privada, com a
identidade digitada — nunca a do `profile.yaml`).

Origem: AGENTS (mesma invariante). Detalhes: [security.md](../../security.md)
(Achado 5, "Conta nova cria o próprio candidato"). Prova:
`tests/candidate-onboarding.test.ts`, `tests/candidate-ownership.test.ts`.

<a id="g17"></a>
## G17 — Recuperar senha não revela quem está cadastrado

**Obrigação.** Endereço existente e inexistente recebem a mesma URL e o mesmo
texto, redigido como "se existir uma conta". Isso vale também para erro de
envio e limite de tentativas.

Origem: AGENTS (invariante "Recuperar senha"). Prova:
`tests/password-reset.test.ts` e comparação no navegador no E2E.

<a id="g18"></a>
## G18 — Token de recuperação: uso único, uma hora, sessões derrubadas

**Obrigação.** Token de uso único, válido por uma hora, **queimado antes** de
gravar a senha. Trocar a senha derruba **todas** as sessões, porque quem
recupera costuma suspeitar de acesso indevido.

**Sem provedor.** Sem `RESEND_API_KEY` o link vai para o terminal — ausência de
provedor não bloqueia produto — mas só em processo local. Em deployment o log é
lido por outras pessoas e o link é credencial: o sistema só alerta, sem
imprimir o link (`withheldMailer`).

Origem: AGENTS (mesma invariante). Detalhes:
[deploy.md](../deploy.md) (`RESEND_API_KEY`, `RESEND_FROM`). Prova:
`tests/password-reset.test.ts`, `tests/resend-mailer.test.ts`,
`tests/operational-docs-contract.test.ts`.

<a id="g19"></a>
## G19 — Hash de senha corrompido nega acesso

**Obrigação.** Dado corrompido em coluna de senha nega, nunca concede. O
parâmetro do verificador nunca sai do valor verificado: `verifyPassword`
derivava a chave com o comprimento do valor **gravado** em vez da constante
`KEYLEN`, e um `password_hash` truncado produzia buffers vazios —
`timingSafeEqual(vazio, vazio)` aceitava qualquer senha.

Origem: AGENTS (invariante "Hash de senha com tamanho errado"). Prova:
`tests/password-truncated-hash.test.ts`.

<a id="g21"></a>
## G21 — `/p/[slug]` mostra só a lista de permissão

**Obrigação.** `/p/[slug]` é a única rota de **conteúdo** sem sessão (as
demais classes estão em G39). O que ela mostra é lista de permissão:
`publicProfile()` enumera os campos que saem, e a página não alcança o registro
do candidato. Nunca saem e-mail, telefone, funil, candidaturas nem piso
salarial — o piso é a posição de negociação, e publicá-lo é mostrar a carta
antes da mesa. Nome, headline, localização e links passam por
`containsContact()` e são esvaziados quando trazem e-mail ou telefone.

**Endereço.** `/p/` lê `public_slug`, nunca o `slug` interno; trocar o endereço
faz o antigo responder 404 sem redirecionar (ADR 0024).

Origem: AGENTS (invariante "`/p/[slug]`"). Prova:
`tests/public-profile.test.ts`, `tests/public-name.test.ts`,
`tests/public-slug.test.ts`.

<a id="g22"></a>
## G22 — Perfil não público responde 404, não 403

**Obrigação.** Perfil privado, inexistente ou com endereço revogado responde
**404**. 403 confirmaria que o slug existe, e existência é informação.

Origem: AGENTS (mesma invariante). Prova: `tests/public-slug.test.ts` e o
serviço de perfil público; o status HTTP real é conferido no E2E.

<a id="g23"></a>
## G23 — Texto do CV público exige segundo consentimento e continua filtrado

**Obrigação.** Publicar o texto do currículo exige um **segundo**
consentimento, separado de tornar o perfil público. Mesmo com ele, o texto
passa por `publicCvText()`: e-mail, telefone e o bloco do piso saem. O
consentimento não cria exceção tácita a G21.

**Limite declarado.** Detecção por padrão, com limite escrito em
`src/core/public-cv.ts` e travado em teste: valor sem rótulo e telefone sem
marca passam. Não é sanitização perfeita, e não deve ser apresentado como tal.

**Forma não abre o filtro.** A estrutura inferida do CV importado
(`cvTextToMarkdown()`) é aplicada entre dois passes de `publicCvText()`, e o
que for derivado dela — seções de resumo, experiência e formação
(`cvSections()`) — parte do `cv` que `publicProfile()` já devolveu filtrado.

Origem: AGENTS (mesma invariante). Prova: `tests/public-cv.test.ts`,
`tests/cv-markdown.test.ts`, `tests/public-profile.test.ts` (#325).

<a id="g14"></a>
## G14 — O service worker não guarda nada autenticado

**Obrigação.** A ausência é a política. Só caches `static-` e `shell-`
(`/offline.html`, gerado e sem credenciais). `/login` nunca entra no cache. Sem
`pages-`, sem `api-`, e `/p/` também fora — público por escolha revogável, e
cópia em disco não obedece a revogação.

**Não é alternativa.** Limpar no logout não bastaria: `logoutAction` não roda
em sessão vencida nem em aparelho perdido.

**Fonte.** `scripts/sw-template.js` é a fonte; `public/sw.js` é gerado com a
versão e ignorado pelo git.

Origem: AGENTS (invariante "O service worker"). Prova: `tests/pwa.test.ts`,
`tests/pwa-chrome.test.ts` (conteúdo real do cache em Chromium).

<a id="g41"></a>
## G41 — Chave de API nunca vai para o banco (regra 16)

**Obrigação.** O cadastro de provedores guarda o **nome da variável de
ambiente**, jamais a chave. Banco é copiado, versionado em backup e aberto por
outros processos — chave dentro dele viaja junto. BYOK só é promessa cumprida
se for estrutural. Nada imprime a chave: nem log, nem erro, nem saída de CLI.

**Quem apaga.** O adapter que assina a requisição conhece a chave e a apaga
pelo VALOR de todo erro que sai dele (`redactSecret`). Regex de formato
(`redactText`, peneira do Sentry) é segunda linha: não reconhece `nvapi-…` nem
chave curta de serviço compatível.

Origem: regra 16. Prova: `tests/llm-key-sentinel.test.ts` (V03-06) — chave
sentinela pelo caminho real, procurada no erro, no evento do Sentry, na saída
da CLI, em todas as tabelas e no painel da análise; e testes asserindo que
nenhuma coluna guarda chave e que nada a imprime
(`tests/cov-cli-posicionamento.test.ts`, `tests/cov-cli-rede-llm.test.ts`,
`tests/llm-registry.test.ts`). O gate estrutural de `tests/architecture.test.ts`
isenta `apiKeyEnv` por ocorrência, nunca por arquivo.

<a id="g36"></a>
## G36 — Scripts locais só fazem bind em `127.0.0.1` (regra 12)

**Obrigação.** `--hostname 127.0.0.1` nos scripts `dev` e `start`, travado por
teste. Em rede compartilhada, bind em todas as interfaces é publicação de CV,
funil e piso salarial.

**Justificativa atual** (resolve C01). A autenticação existe e é exigida por
omissão (G38); o loopback é defesa em profundidade da máquina local, não a
única barreira. A implantação hospedada (Vercel + Supabase) é outro modelo de
ameaça, descrito em [security.md](../../security.md) e
[deploy.md](../deploy.md). O Achado 1 de `security.md` registra o incidente
original em que `next dev` escutava em `0.0.0.0`.

Origem: regra 12. Prova: `tests/security.test.ts`.

<a id="g73"></a>
## G73 — Rede controlada nas operações que a pedem

**Obrigação.** Acesso à rede passa pela porta adequada à finalidade:
`getJson()` para JSON, `getText()` para HTML, sonda HEAD/GET da verificação e
captura da raspagem. Abaixo delas, toda URL de vaga passa por
`safeRemoteFetch` (`src/core/remote-url.ts`), que valida cada salto de redirect
— endereço privado, DNS misto e LinkedIn (G01) são recusados antes do pedido.
Identificar-se (`user-agent`), timeout curto, retry só em falha transitória e
respeito a `robots.txt` na captura.

**Resolve C16.** A frase antiga "todo acesso à rede passa por `getJson`" não
vale para HTML, HEAD, e-mail nem provedores de LLM. O que vale é porta por
finalidade com as proteções comuns; não force corpo JSON onde a operação não é
JSON. O inventário de quem pode abrir transporte de saída é fechado.

Origem: [sources.md](../../sources.md) ("Etiqueta de rede"). Prova:
`tests/cov-core-remote-url.test.ts`, `tests/outbound-transport-boundary.test.ts`,
`tests/cov-sources-http.test.ts`.

<a id="g79"></a>
## G79 — Ingestão real só no ambiente autorizado

**Obrigação.** Dev e staging usam dados sintéticos (fixtures), nunca ingestão
real nem credencial de produção. A guarda de runtime recusa ingestão fora do
ambiente autorizado; workflows não recebem segredo de produção onde não devem.

Origem: [deploy.md](../deploy.md),
[ADR 0021](../../adr/0021-ambientes-nao-produtivos-com-dados-sinteticos.md).
Prova: `tests/ingestion-environment.test.ts`,
`tests/ingestion-guard-entrypoints.test.ts`,
`tests/workflow-environment-isolation.test.ts`.

<a id="g80"></a>
## G80 — Privilégio mínimo no runtime; migration com credencial própria

**Obrigação.** O runtime conecta com a role restrita (`master_jobs_app`, sem
DDL); migrations usam `DATABASE_MIGRATION_URL`, credencial própria e destino
validado. Não anuncie correção de produção sem evidência: o estado verificado
da role em produção, e o que ainda falta confirmar, ficam registrados em
[deploy.md](../deploy.md) ("Configuração verificada"), não copiados aqui.

**Nunca**, como diagnóstico: imprimir URL de conexão, extrair valor Sensitive
ou rotacionar o usuário `postgres`.

Origem: [deploy.md](../deploy.md) ("Dar login à role de runtime"). Prova:
`tests/postgres-permissions.test.ts`, `tests/postgres-deployment.test.ts`.
