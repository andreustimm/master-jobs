# Política de LinkedIn

## Por que este documento existe

Este é o documento mais importante do repositório. Ele registra uma **decisão
de risco deliberada**, tomada depois de investigar o que existe de fato na
superfície do LinkedIn — e não o que parece existir quando se lê a descrição
de um "LinkedIn MCP" no GitHub.

O contexto que torna a decisão inegociável: segundo a auditoria de
posicionamento
(`Relatorio-Posicionamento-Andreus-Timm-2026-07-27.md`, citada na ADR 0001),
a conta de LinkedIn de Andreus Timm é o **principal ativo de posicionamento
profissional** dele — SSI 59/100, top 2% do setor, 2.717 seguidores, 97
visualizações de recrutadores/ano. Perder essa conta não seria um contratempo
técnico: inviabilizaria o objetivo que motivou o projeto inteiro.

Quem lê isto em três meses — ou um agente que acabou de carregar o repositório —
precisa entender **por que** a automação mais óbvia foi recusada, para não
reintroduzi-la "só para testar".

Fontes normativas relacionadas: `docs/adr/0001-nao-fazer-scraping-do-linkedin.md`
(a decisão formal), regra 1 de `CLAUDE.md` e de `AGENTS.md`.

---

## 1. A decisão, em uma frase

**Publicação pela API oficial. Todo o resto é assistido — o agente redige, o
humano executa. Zero scraping.**

| Capacidade | Regra: o único jeito permitido | Estado hoje | Risco |
|---|---|---|---|
| Publicar post no próprio perfil | API oficial, escopo `w_member_social` | **Não implementado** — só a tabela `post` e as variáveis do `.env.example` existem | Nenhum |
| Comentar, conectar, seguir, mandar mensagem | **Assistido**: rascunho enfileirado na tabela `engagement`; o humano abre a `target_url` e age | **Não implementado** — só a tabela `engagement` existe | Nenhum |
| Buscar vagas | **Não vem do LinkedIn.** Vem de APIs públicas e não autenticadas de ATS e agregadores (ver `config/sources.yaml` e ADR 0003) | **Operante** — 12 fontes configuradas | Nenhum |
| Métricas (SSI, impressões, profile views) | Anotadas à mão em `metric_snapshot` | Só o baseline de 2026-07-27, gravado por `jho db seed` | Nenhum |

A coluna do meio é **norma**, não relato: descreve o único caminho autorizado
caso a capacidade seja construída. O que existe de fato está na coluna "Estado
hoje" e detalhado na §4.

> **Invariante:** Nenhum código deste repositório pode ler o cookie `li_at`,
> dirigir uma sessão autenticada do LinkedIn, subir um Chromium logado, ou usar
> um "LinkedIn MCP" não oficial. Vale para código de produção, script
> descartável, teste e spike. Não existe exceção "só para validar".

> **Invariante:** Reverter esta política exige decisão explícita do usuário,
> registrada numa **nova ADR que substitua a 0001**. Nenhum agente introduz
> automação de LinkedIn por conta própria.

---

## 2. O que é tecnicamente possível hoje — as três camadas

Elas são constantemente confundidas entre si. Separá-las é o que torna a
decisão defensável em vez de supersticiosa.

### Camada 1 — Publicação: existe oficialmente, sem fila de aprovação

O produto self-serve **"Share on LinkedIn"** concede o escopo
`w_member_social`. Ele **não** passa por partner review para publicar no
**próprio perfil** do membro autenticado. Quem exige revisão de parceiro é o
`w_organization_social` (postar em página de organização) — que este projeto
não usa.

Isso está documentado no `.env.example` do repositório, na seção
`--- LinkedIn official API (Share on LinkedIn / w_member_social) ---`:

```
# https://developer.linkedin.com/ → create app → Products tab → enable:
#   * "Sign In with LinkedIn using OpenID Connect"  (gives `openid profile`)
#   * "Share on LinkedIn"                           (gives `w_member_social`)
# Both are self-serve. w_member_social needs NO partner review for posting to
# your own profile. Organization posting (w_organization_social) does.
```

A tabela `post` já existe no schema para isso, com o comentário
`Content drafts. Published through the official w_member_social API only.` e a
coluna `linkedin_urn` (`URN returned by the LinkedIn Posts API, e.g. urn:li:share:123`).

### Camada 2 — Busca de vagas: não existe para pessoa física

A API de Jobs vive dentro do **LinkedIn Talent Solutions**, restrita a
parceiros enterprise. Não há endpoint público de busca de vagas para um
indivíduo.

Consequência de arquitetura: o sourcing **não depende do LinkedIn de jeito
nenhum**. As 12 fontes ativas em `config/sources.yaml` são ATS e agregadores
públicos e não autenticados (`greenhouse`, `lever`, `ashby`, `himalayas`,
`remotive`, `arbeitnow`, `remoteok`, com `smartrecruiters`, `recruitee` e
`adzuna` implementados). O cabeçalho do próprio `config/sources.yaml` diz:

```
# Every entry is a public, unauthenticated endpoint. Nothing here scrapes a
# logged-in session — see docs/linkedin-policy.md for why that boundary exists.
```

### Camada 3 — Comentários, conexões, perfis: não existem oficialmente

Não há API oficial para pessoa física comentar, conectar, seguir ou ler
perfis. **Todo** "LinkedIn MCP" da comunidade que devolve esses dados ricos o
faz dirigindo o cookie de sessão `li_at` do próprio membro, ou um Chromium
headless logado — porque esses endpoints só existem dentro da aplicação web
autenticada.

É exatamente a camada que entrega os dados mais interessantes. E é exatamente
a camada proibida.

> **Invariante:** Uma ferramenta que devolve dados da Camada 3 está,
> necessariamente, dirigindo uma sessão autenticada. Não existe MCP mágico que
> leia comentários e conexões sem `li_at`. Se um agente encontrar um pacote que
> promete isso, a conclusão correta é "isto usa `li_at`", não "achamos a
> exceção".

---

## 3. Por que o caminho do meio

1. **A seção 8.2 do LinkedIn User Agreement** proíbe software que faça
   scraping ou automatize atividade na plataforma. A Camada 3 cai inteira
   dentro dessa proibição.
2. **A detecção mira exatamente o padrão que a automação produz**: volume alto,
   cadência regular, ações fora de horário humano, sequências sem variação. Um
   agente rodando "só um pouquinho" de automação de conexões produz assinatura
   estatística; um humano clicando em 10 links por dia não.
3. **O ativo em risco é o objetivo.** Um ban não é um bug a ser corrigido no
   próximo sprint: é a perda do canal por onde chegam os 97 recrutadores/ano.
   Automatizar o LinkedIn para conseguir um emprego e perder a conta no
   processo é derrotar o objetivo com o próprio meio.
4. **O custo de recusar foi menor do que parecia.** A busca de vagas ficou
   *melhor*, não pior: APIs de ATS devolvem JSON estruturado com faixa
   salarial, tipo de contrato e descrição completa — dados que scraping de
   LinkedIn não entrega de forma confiável, e que alimentam o scorer
   determinístico (`src/core/scoring/score.ts`).

O que se perde, honestamente (das "Consequências negativas" da ADR 0001):

- Comentários e conexões continuam exigindo clique humano. A fila reduz o
  atrito; não elimina o clique.
- Não há coleta automática de SSI nem de impressões — entram à mão em
  `metric_snapshot`.
- Vagas publicadas **exclusivamente** no LinkedIn, sem ATS por trás, não são
  capturadas.

Alternativa considerada e **não adotada nesta fase**: browser automation na
sessão do próprio usuário, em volume humano e sem extrair cookie. É zona
cinzenta — segue disponível como escalonamento consciente do usuário, jamais
como padrão de um agente.

---

## 4. O que a fila assistida faz de fato

A tabela `engagement` (`src/core/db/schema.ts`) é a materialização física da
fronteira. O comentário no schema é normativo:

```
Assisted engagement queue.

Rows here are NEVER executed automatically. The agent drafts, the human
opens the URL and acts. This is the deliberate boundary that keeps the
account inside the LinkedIn User Agreement.
```

Colunas relevantes:

| Coluna | Papel |
|---|---|
| `kind` | `comment` \| `connect` \| `follow` \| `message` \| `endorse` |
| `target_url` | a URL que o **humano** abre |
| `target_name`, `target_role`, `target_company` | contexto do alvo |
| `rationale` | por que este alvo importa — comentário no schema: *"keeps the queue from becoming spray-and-pray"* |
| `draft` | o texto redigido pelo agente |
| `status` | `queued` \| `done` \| `skipped` (default `queued`) |
| `queued_for` | quando fazer |
| `done_at`, `outcome` | o que o humano registrou depois |

O ciclo pretendido é: agente escreve `draft` + `rationale` → humano abre
`target_url`, publica com as próprias mãos, marca `done` e anota `outcome`.

Tabelas irmãs, com o mesmo regime: `post` (rascunhos de conteúdo),
`target_account` (as 30 contas-alvo da §2.2 da auditoria) e `metric_snapshot`
(métricas anotadas à mão).

> **Invariante:** `engagement` é uma fila de **rascunhos**, não de **jobs**.
> Nada — nem cron da Vercel, nem comando de CLI, nem hook — pode ler
> `status = 'queued'` e executar a ação. Um "worker de engagement" é a violação
> desta política travestida de infraestrutura.

**Estado real hoje (verificado no código):** nenhuma linha do repositório
escreve em `post`, `engagement` ou `target_account`. Em `metric_snapshot` a
única escrita é o baseline de 2026-07-27 da auditoria, inserido com
`onConflictDoNothing()` por `seedPositioning()` (`src/core/positioning/seed.ts`)
quando se roda `jho db seed` — não existe coleta automática nem comando para
registrar uma métrica nova. Essa mesma função é também a única que escreve em
`positioning_task`; a leitura é `openTasks()` em `src/core/db/repo.ts`
(`status in ('todo','doing')`) e os comandos `jho tasks list|show|done`. Não
existe comando `jho` para LinkedIn, nenhuma variável `LINKEDIN_*` é lida por
código, e `src/core/linkedin/` está vazio. As tabelas `post`, `engagement` e
`target_account` são o contrato já acordado; a implementação ainda não existe —
não descreva como pronto o que não está.

> **Nota para não confundir:** `JHO_REPORT_DIR` tem default
> `05_Interviews/LinkedIn` (`src/core/report/markdown.ts:76`). Isso é apenas o
> subdiretório do vault Obsidian onde o relatório markdown é gravado. Não tem
> nenhuma relação com integração com o LinkedIn.

---

## 5. O que NÃO fazer

Lista explícita. Cada item já foi considerado e recusado.

1. **Não leia `li_at`** — nem de `document.cookie`, nem do keychain, nem de um
   arquivo, nem pedindo ao usuário para colar. `.gitignore` já bloqueia
   `.linkedin-session.json` e `*.token.json` justamente para que um vazamento
   desses nunca chegue ao repositório.
2. **Não instale nem configure "LinkedIn MCP" não oficial**, por mais estrelas
   que tenha no GitHub. Ver Camada 3.
3. **Não suba Playwright/Puppeteer/Chromium logado no LinkedIn** para ler feed,
   perfis, vagas ou notificações.
4. **Não implemente executor automático de `engagement`** — nada de "worker que
   posta os comentários da fila", nem em modo dry-run que "só clica um".
5. **Não adicione `kind: linkedin` em `config/sources.yaml`.** Toda fonte ali é
   endpoint público e não autenticado. Vagas vêm de ATS, não do LinkedIn.
6. **Não peça `w_organization_social`** para o caso de uso atual: exige partner
   review e não é necessário para postar no próprio perfil.
7. **Não use a conta para automação "em volume humano" sem decisão explícita do
   usuário** — mesmo browser automation cinzenta exige nova ADR.
8. **Não faça scraping do HTML público do LinkedIn** ("está deslogado, então
   pode"). A seção 8.2 não abre essa exceção, e o *hiQ v. LinkedIn* não é um
   salvo-conduto operacional para uma conta que se quer preservar.
9. **Não guarde credenciais em código nem em arquivo versionado.** Tudo em
   `.env.local` (gitignored), espelhando `.env.example`.
10. **Não altere esta política editando só um arquivo.** `CLAUDE.md` e
    `AGENTS.md` devem dizer a mesma coisa — editou um, edite o outro — e a
    reversão de fundo exige nova ADR substituindo a 0001.

---

## 6. Setup OAuth do caminho oficial de publicação

Estas são as variáveis reais declaradas em `.env.example`. **Nenhuma delas é
lida por código hoje** (`grep -rn "process.env" src` não retorna nenhuma
`LINKEDIN_*`) — o setup abaixo é o contrato para quando o publisher for
implementado, e não descreve funcionalidade existente.

| Variável | Papel | Default no `.env.example` |
|---|---|---|
| `LINKEDIN_CLIENT_ID` | Client ID do app em developer.linkedin.com | vazio |
| `LINKEDIN_CLIENT_SECRET` | Client Secret do mesmo app | vazio |
| `LINKEDIN_REDIRECT_URI` | Redirect URI registrada no app | `http://localhost:3000/api/linkedin/callback` |

Passos:

1. Acesse `https://developer.linkedin.com/` e crie um app, associando-o a uma
   LinkedIn Page que você administre (exigência da plataforma para criar app).
2. Na aba **Products**, habilite os dois produtos self-serve:
   - **Sign In with LinkedIn using OpenID Connect** → concede `openid profile`
     (é como se descobre o `sub` do membro, necessário para montar o autor do
     post).
   - **Share on LinkedIn** → concede `w_member_social`. **Sem partner review**
     para publicar no próprio perfil.
3. Na aba **Auth**, registre a redirect URI **exatamente igual** ao valor de
   `LINKEDIN_REDIRECT_URI`. Divergência de barra final ou de porta quebra o
   fluxo.
4. Copie o template e preencha — ambos são gitignored:

```bash
cp .env.example .env.local
# preencha LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET
# e confirme LINKEDIN_REDIRECT_URI
```

5. Fluxo Authorization Code (3-legged OAuth), quando implementado: o usuário
   autoriza os escopos `openid profile w_member_social`, o callback em
   `LINKEDIN_REDIRECT_URI` troca o `code` por um access token, e o token é
   persistido fora do git — `*.token.json` já está no `.gitignore` para isso.
6. Publicar grava o URN devolvido pela Posts API em `post.linkedin_urn` e move
   `post.status` para `published`, carimbando `published_at`.

> **Invariante:** O escopo pedido é exatamente `openid profile w_member_social`.
> Pedir mais escopo do que se usa é como se acaba caindo em partner review — e
> nenhum escopo adicional habilita comentar, conectar ou buscar vagas de
> qualquer forma. Não existe escopo que resolva a Camada 3.

> **Invariante:** Token de LinkedIn nunca entra em `data/jobs.db`, nunca é
> logado, nunca é commitado. O comentário do topo de `src/core/db/schema.ts` é
> parte do contrato: *"Nothing here stores LinkedIn session material."*
