# master-jobs — instruções para agentes (Codex / OpenCode / Claude)

Sistema de sourcing, scoring e gestão de candidaturas de **Andreus Timm**
(Senior AI Software Architect, 20+ anos, São Paulo/Brasil, remoto B2B,
**sem autorização de trabalho nos EUA**).

Objetivo: encontrar vagas que dão match com o perfil, ranqueá-las de forma
auditável, e gerenciar o funil de candidaturas. Roda **localmente** — CLI +
dashboard Next.js em `localhost:3000`.

---

## Regras invioláveis

> **1. Nunca faça scraping do LinkedIn.**
> Nada aqui pode ler `li_at`, dirigir sessão autenticada, ou usar "LinkedIn MCP"
> não oficial. Viola a §8.2 do User Agreement e arrisca a conta que é o
> principal ativo de posicionamento do usuário. Publicação usaria a API oficial
> (`w_member_social`); comentários e conexões são **assistidos**.
> **Job alert por e-mail é permitido** e é a via legítima — ver ADR 0008.
> Detalhes: `docs/linkedin-policy.md`, `docs/adr/0001`, `docs/adr/0008`.

> **2. Ingestão nunca escreve em `application`.**
> Sync, import e parsing de e-mail mexem em `job`; jamais em decisões do
> usuário. E-mail produz **sugestões** em `mail_suggestion`, que o usuário
> aceita ou descarta. Quebrar isso destrói o único dado irrecuperável.

> **3. Vaga que some é fechada (`closedAt`), nunca deletada.**
> Deletar quebra o histórico de candidaturas por foreign key.

> **4. Módulo novo entra por porta. Sempre.**
> O sistema é feito para receber módulos: fontes, filas, provedores de LLM,
> armazenamento. Cada um desses é uma **porta** com adapter, nunca uma chamada
> direta espalhada pelo código.
>
> As portas que já existem, e que são o padrão a seguir:
>
> | Porta | Variação que ela absorve |
> |---|---|
> | `SourceAdapter` | cada board, ATS e career page |
> | `QueuePort` | tabela hoje, Upstash quando for para a web (ADR 0009) |
> | `LlmPort` | Anthropic, OpenAI, o que vier — BYOK |
> | `SkillCatalogPort` · `CandidateSkillPort` · `TargetCorpusPort` | contexto de skills (ADR 0007) |
>
> **Regra de quando criar porta:** só onde a variação é real. Porta com uma
> implementação e nenhuma alternativa plausível é cerimônia — ADR 0007 rejeita
> isso explicitamente. Mas onde há troca previsível (provedor, serviço, board),
> a porta é obrigatória.
>
> **Domínio puro:** a lógica que decide fica em funções puras, sem banco, sem
> rede, sem relógio. É o que torna `scoring/`, `skills/domain/` e `analytics/`
> testáveis exaustivamente. Adapter é burro: busca, mapeia, devolve.
>
> Estrutura para contexto novo (espelhe `src/contexts/skills/`):
> ```
> domain/     puro — tipos e regras
> ports.ts    só as portas com variação real
> app/        casos de uso, orquestração burra
> infra/      o único lugar que conhece SQL ou HTTP
> index.ts    composição por função, sem container
> ```
> Injeção é composição de função. Container seria ilegal sob a regra 5 (sintaxe apagável).

> **5. Só sintaxe TypeScript apagável.**
> Runtime é o type stripping nativo do Node 24: sem `enum`, sem parameter
> properties, sem `namespace`, sem decorators. `erasableSyntaxOnly: true` no
> `tsconfig.json`. Se `pnpm jho` estourar `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`,
> é isso. Imports relativos carregam extensão `.ts` explícita.

> **6. Mexeu no scorer ou em `profile.yaml`? Bump `SCORER_VERSION`.**
> Fica em `src/core/scoring/score.ts` (hoje `1.3.0`). Depois
> `pnpm jho jobs score --all`. Sem o bump, duas gerações de score convivem na
> mesma coluna sem sinal visível.

> **7. Não invente evidência.**
> Tailoring de CV só cita o que está em `evidence:` no `profile.yaml`.
> O que está em `growth:` é lacuna assumida — sinalize, nunca maquie.

> **8. Dado faltante pontua neutro, nunca punitivo.**
> Vaga sem data de publicação não é vaga velha; vaga sem descrição não é vaga
> sem benefício. Punir ausência rebaixa a fonte pela qualidade da API dela, não
> pela qualidade do emprego. `freshness` sem data vale 0,5; `benefits` em texto
> curto vale 0,5 e **nunca** gera bloqueador.

> **Token de UI não serve como cor de texto.** `--accent-2`, `--warn` e afins
> são feitos para preenchimento, onde o mínimo é 3:1 — `--accent-2` no tema
> graphy claro dá 2.53:1 contra o fundo do editor. Texto precisa de 4.5:1, e a
> paleta de sintaxe do editor mora em `--cm-*`, verificada nos seis ambientes
> por `pnpm test:e2e` lendo o estilo computado dos spans reais.

> **O score é rubrica ponderada, não similaridade de cosseno.** Sete
> componentes com teto fixo, casamento léxico por borda de palavra, curva
> saturante na keyword e decaimento exponencial no frescor — nenhum embedding,
> nenhum vetor, nenhum LLM no caminho. A razão é o caso de uso: sem autorização
> de trabalho nos EUA, "W2 on-site em Austin" é **eliminatório**, e cosseno
> diria 0,91 de similaridade porque o texto de fato se parece. Similaridade não
> distingue "combina" de "é possível". Detalhe em `docs/scoring.md`.

> **Escolha entre apelidos de campo decide pelo VALOR normalizado, nunca pela
> presença da chave.** `{ company: { name: "  " }, employer: "Acme" }` entrava
> como "Desconhecida" porque um objeto passa no teste de presença e `employer`
> nunca era lido — e vaga sem nome de empresa some do `jho referrals`. É a regra
> 17 um nível mais fundo.
>
> **Limite sob concorrência reserva o slot ANTES do `await`.** A reserva
> síncrona é atômica porque o laço de eventos não interrompe código síncrono;
> conferir depois do `await` deixava N−1 workers passarem juntos.

> **O service worker não guarda nada autenticado, e a ausência é a política.**
> Só `static-` e `shell-` (`/login`, `/offline`). Sem `pages-`, sem `api-`, e
> `/p/` também fora — público por escolha revogável, e cópia em disco não
> obedece a revogação. Limpar no logout não bastaria: `logoutAction` não roda em
> sessão vencida nem em aparelho perdido. `scripts/sw-template.js` é a fonte;
> `public/sw.js` é gerado com a versão e ignorado pelo git.

> **Documento de feature em `.compozy/tasks/`; o que sobrevive à feature em
> `docs/`.** A fronteira é o ciclo de vida, e está na ADR 0011: spec, contrato
> de testes e grafo de tarefas nascem e morrem com o slug; ADR, visão, personas,
> backlog e mapa de contextos atravessam features. Parte de `docs/` é teste de
> fitness — `pnpm check` abre `context-map.md` por caminho literal.

> **Política correta não basta: a composição precisa respeitá-la.** `job:read` é
> dos três papéis, mas `/jobs` guardava por escopo de candidato e o login
> mandava todo mundo para `/` — um recrutador entrava com a senha certa e
> recebia 403 em toda tela. Cada metade estava correta sozinha, e por isso
> nenhum teste puro via. Cenário por papel em `pnpm test:e2e` é o que vê.

> **Recuperar senha não revela quem está cadastrado.** Endereço existente e
> inexistente recebem a mesma URL e o mesmo texto, redigido como "se existir uma
> conta". Token de uso único, uma hora, queimado antes de gravar a senha; e
> trocar a senha derruba TODAS as sessões, porque quem recupera costuma
> suspeitar de acesso indevido. Sem `RESEND_API_KEY` o link vai para o terminal
> — ausência de provedor não bloqueia produto.

> **Hash de senha com tamanho errado NEGA acesso.** `verifyPassword` derivava a
> chave com o comprimento do valor **gravado** em vez da constante `KEYLEN`: um
> `password_hash` truncado produzia buffers vazios e `timingSafeEqual(vazio,
> vazio)` aceitava qualquer senha. Dado corrompido em coluna de senha nega,
> nunca concede — e o parâmetro do verificador nunca sai do valor verificado.
>
> **`ALTER TABLE ... ADD ... REFERENCES` no SQLite ignora `ON DELETE`.** A
> cláusula é aceita na sintaxe e vira `NO ACTION`. Coluna com chave estrangeira
> exige reconstrução da tabela, e `tests/cov-db-schema.test.ts` compara o que o
> schema declara com o que o `pragma` aplica.

> **`/p/[slug]` é a única rota sem sessão, e o que ela mostra é lista de
> permissão.** `publicProfile()` enumera os campos que saem; a página não
> alcança o registro do candidato. Nunca saem e-mail, telefone, funil,
> candidaturas nem piso salarial — o piso é a posição de negociação, e
> publicá-la é mostrar a carta antes da mesa. Perfil não público responde
> **404, não 403**: 403 confirma que o slug existe, e existência é informação.
> O texto do currículo exige um SEGUNDO consentimento.

> **Admin não lê dado privado; ele assume a identidade, e isso fica registrado.**
> Três papéis: `admin`, `candidate`, `recruiter`. A sessão emprestada perde TODA
> ação de administração em bloco, por `impersonatedBy !== null` e não por papel
> — o alvo pode ser outro admin. Ninguém além do próprio candidato cria vínculo
> recrutador↔candidato, e nenhuma conta nova é apontada para candidato
> existente: os dois seriam leitura de CV alheio por procuração.

> **Só 404 e 410 fecham uma vaga.** 401/403/429 são bloqueio de robô, não prova
> de ausência — o Himalayas devolve 403 em toda requisição, e fechar nele
> apagaria uma fonte viva inteira. 5xx e falha de rede não decidem nada. A
> regra é função pura em `src/core/ingest/probe.ts` justamente porque é a única
> capaz de esconder uma vaga boa por engano. `alive` reabre: um 404 transitório
> não pode sumir com a vaga para sempre.

> **9. Texto de interface vem do dicionário, nunca do JSX.**
> Isto inclui **rótulo dentro de constante**: `COMPONENTS` em `app/ui.tsx`,
> `FIELD_LABEL` no modal, `CATEGORY_LABEL` nas skills e `THEMES[].description`
> guardavam texto pronto. Constante guarda **chave** — texto em constante não
> aparece em busca por string no JSX e sobrevive a uma revisão de tradução
> inteira.
>
> **Antes de criar chave, procure a existente.** `candidate.edit`,
> `vocabulary.title` e `nav.appearance` já estavam no dicionário e sem uso: a
> tradução existia e o componente a ignorava. Chave duplicada é erro de
> compilação, o que ajuda, mas só depois do trabalho perdido.
>
> `pnpm test:e2e` percorre sete telas em inglês e reprova por dois critérios:
> texto que **é** valor do dicionário português, e texto com acento. A primeira
> versão desta verificação usava lista de palavras escrita à mão — ela passava
> com "Editar", "Vocabulário" e "Práticas" na tela, porque a lista era o
> inventário do que já tinha sido corrigido. Dado do usuário fica de fora por
> `data-user-content`: o currículo tem "São Paulo" e continua tendo em inglês.
> `pt-BR` e `en` em `src/core/i18n/`. As chaves são tipadas contra o dicionário
> português, então tradução faltando é erro de compilação — e não espaço em
> branco descoberto por um usuário. Página obtém o tradutor com
> `getTranslator()`; string literal no JSX é tradução que nunca vai existir.
>
> **Teste que busca controle por texto quebra quando alguém traduz.** Use
> `data-testid` para controle e texto só para conteúdo.

> **10. Todo frontend segue o sistema de temas.**
> Três temas — **HP**, **Huly**, **Graphy** — cada um com ambiente claro e
> escuro, e um terceiro estado que segue o sistema operacional. Definidos em
> `app/themes.css`, registrados em `src/core/theme.ts`.
>
> **Componente lê só token semântico:** `--background`, `--foreground`,
> `--card`, `--primary` (superfície de botão), `--primary-text` (link e texto
> de acento — contrasta com o FUNDO, não com o botão), `--border`, `--muted`,
> `--hairline`, `--good`, `--warn`, `--bad`, `--accent-2`.
> Um `#hex` ou um token bruto (`--color-iris`) num componente é o tema vazando,
> e a partir daí um dos temas começa a ficar errado.
>
> Tema novo = um bloco em `themes.css` + uma linha em `theme.ts`. Nada em
> `components/` muda.
> **Nunca use `max-w-xs`, `max-w-sm`, `max-w-md`, `max-w-lg` nem `max-w-xl`**
> (idem `w-`, `h-`, `min-w-`). O Tailwind v4 resolve esses nomes por
> `--spacing-<nome>`, e o DESIGN.md nomeia os espaçamentos assim — `max-w-xs`
> vale 8px, não 320px. Use valor explícito. Coberto por teste.
> A fonte da especificação é **Forma DJR Micro**, proprietária. O projeto usa
> **Inter** (~85% de similaridade, OFL-1.1) e a substituição está documentada
> no topo de `app/design-tokens.css`. Com Adobe Fonts, troque só `--font-sans`.
> `DESIGN.md` (raiz) é a fonte da verdade visual — cores, tipografia, escala de
> espaçamento, raios, motivos. Ele já está traduzido em `app/design-tokens.css`
> (28 cores, 16 estilos de texto, 8 raios, 8 espaçamentos) e em `app/globals.css`.
>
> **Tela nova, componente novo, ajuste visual: derive dos tokens existentes.**
> Nunca escreva cor, tamanho de fonte ou espaçamento fora da escala — nem
> "só desta vez", nem "um valor aproximado". Se algo parece faltar no sistema,
> a resposta é compor com o que existe, não inventar um valor novo.
>
> Na prática: use `var(--color-*)`, as classes `type-*`, e os utilitários de
> espaçamento do Tailwind já mapeados. Um `#hex` literal ou um `text-[13px]`
> num componente é sinal de que a regra foi quebrada — há teste cobrindo isso.
>
> Vale igual para responsividade: **toda tela precisa funcionar no celular**
> (ver regra 10). Um layout que só existe no desktop não cumpriu o DESIGN.md.

> **11. Toda tela funciona no celular.**
> Verificado por `pnpm test:e2e`, que mede `scrollWidth` real em 375px. Teste
> estático não pega estouro horizontal — os dois que existiam passavam por
> todos os greps e só apareceram num browser.
> `export const viewport` com `width: device-width` no layout raiz — sem isso o
> telefone renderiza a 980px e todo o CSS responsivo vira código morto. Grid de
> múltiplas colunas precisa de fallback de coluna única; nada de largura fixa
> acima de 360px; nunca limite o zoom. Coberto por `tests/mobile.test.ts`.

> **12. O dashboard nunca faz bind fora de `127.0.0.1`.**
> Não há autenticação nenhuma, e ele serve CV, funil e piso salarial. Em rede
> compartilhada isso é publicação. `--hostname 127.0.0.1` nos scripts `dev` e
> `start`; travado por teste. Ver `docs/security.md`.

> **13. Nada neste sistema envia uma candidatura.**
> `jho prep` monta o dossiê; quem envia é o usuário. Automatizar envio antes de
> a triagem estar calibrada acelera o gargalo errado, e candidatura enviada não
> volta. ADR 0010 define as três condições para reavaliar.

> **14. Autenticação é exigida por omissão.**
> Nenhuma página nem API responde sem sessão válida — inclusive `/api/export`,
> que carrega o acervo inteiro. O modo aberto existe mas precisa ser pedido:
> `JHO_AUTH_MODE=open`. "Só roda em loopback" protege contra a internet, não
> contra outro processo, outra conta da máquina, nem contra um bind errado —
> que já aconteceu aqui. Segurança por omissão é a omissão ser a opção segura.
>
> Primeiro acesso: `jho auth add-user <email> --role admin,candidate` e
> `jho auth set-password <email>`. Sem conta cadastrada, `/login` mostra esses
> dois comandos em vez de um formulário sem saída.

> **15. Autorização passa por `can()`, e o escopo vem da sessão.**
> Toda Server Action chama `guard(...)` **antes** de qualquer efeito, e **toda
> página chama `requirePage(...)`** — guardar só as actions deixa o dado
> legível por quem não tem sessão. `proxy.ts` é a rede grossa (existe
> cookie?), a página é a checagem real (o cookie vale?). Nenhuma action aceita
> `candidateId` da própria entrada — id em FormData é pedido, não prova.
> Exceção única e registrada: `passwordLoginAction`, onde a sessão nasce; ela
> é protegida por limite de tentativas, não por permissão.
> A decisão mora em `src/contexts/auth/domain/policy.ts`, é pura, e nega por
> padrão. Coberto por teste de arquitetura.

> **16. Chave de API nunca vai para o banco.**
> O cadastro de provedores guarda o **nome da variável de ambiente**, jamais a
> chave. Banco é copiado, versionado em backup e aberto por outros processos —
> chave dentro dele viaja junto. BYOK só é promessa cumprida se for estrutural.
> Há teste asserindo que nenhuma coluna guarda chave e que nada a imprime.

> **17. `??` não protege contra string vazia.**
> Várias APIs devolvem `""` para campo não preenchido. Use `firstNonEmpty()`
> de `src/core/sources/http.ts`. Esse bug já apagou 4.538 descrições uma vez.

> **18. Tarefa nasce em worktree a partir de `dev`, e a PR aponta para `dev`.**
> Nunca comite direto em `dev`, `staging` ou `main`. A promoção para `staging` é
> automática e a de `staging` para `main` é humana — ver **Fluxo de trabalho**
> abaixo. Um commit direto em `staging` faz as branches divergirem e trava a
> promoção seguinte, com o sintoma aparecendo dias depois da causa.

---

## Fluxo de trabalho

```
worktree/tarefa → PR → dev → (automático) → staging → PR humana → main → tag + volta para dev
```

| Etapa | Quem faz | Como |
|---|---|---|
| tarefa → `dev` | pessoa ou agente | worktree a partir de `dev`, PR com CI verde |
| `dev` → `staging` | automático | `promover-para-staging.yml`, quando o CI de `dev` fica verde |
| `staging` → `main` | **humano** | PR aberta pelo robô, mesclada por gente |
| tag + `main` → `dev` | automático | `sincronizar-apos-main.yml` |

**Fast-forward, não merge, de `dev` para `staging`.** Nada nasce em `staging`;
um merge criaria ali um commit que não existe em `dev`, e a partir dele as duas
divergiriam para sempre. O que está em `staging` é literalmente o que passou no
CI de `dev`.

**Produção não sai sem gente.** A PR `staging → main` é aberta e nunca mesclada
por robô.

**Branch mesclada é excluída, sempre — local e remota.** Assim que a PR entra
em `dev` (ou em `main`), a branch de trabalho e a worktree são removidas: `git
worktree remove` (desbloqueando antes, se estiver locked), `git branch -d` e
`git push origin --delete <branch>`. A remota é tão obrigatória quanto a local —
deixar a remota cria uma floresta de branches mortas que ninguém sabe se ainda
valem. Única exceção: branch ainda não mesclada, que fica até entrar.

**Migração suspende a promoção automática.** Diferença em `drizzle/` ou em
`src/core/db/schema.ts` entre `staging` e `dev` para o fluxo: o deploy da Vercel
e a migração disparam do mesmo push e não se conhecem. Migração aditiva
sobrevive a essa corrida; migração que remove ou renomeia, não — e decidir qual
é qual é leitura humana.

**O retorno para `dev` não é opcional.** Hotfix nasce em `main`, e correção nos
próprios arquivos de fluxo também. Sem devolver, `dev` fica sem esses commits e
a promoção seguinte deixa de ser fast-forward.

**Sobre o `RELEASE_PAT`.** Push feito com o token padrão da Action não dispara
outros workflows — trava anti-recursão do GitHub. Sem o segredo o fluxo funciona
e é seguro, porque o código promovido é bit a bit o que passou no CI de `dev`;
com ele, `staging` e as PRs geradas também recebem checks próprios.

| Ambiente | Branch | Banco Turso | Endereço |
|---|---|---|---|
| Produção | `main` | `master-jobs` | `jobs.mastertimm.com.br` |
| Staging | `staging` | `master-jobs-staging` | `jobs-staging.mastertimm.com.br` |
| Dev | `dev` | `master-jobs-dev` | `jobs-dev.mastertimm.com.br` |
| Local | — | `file:./data/jobs.db` | `127.0.0.1:3000` |

> **19. Antes de abrir PR, rode a revisão profunda.**
> `/deep-review` (skill em `.claude/skills/deep-review/`) revisa o diff com
> evidência causal, cobertura por hunk e veredito **SHIP / FIX_BEFORE_SHIP /
> REWORK**. Rode ANTES de pedir revisão humana: o CI prova que o código roda, e
> a revisão profunda diz se ele está certo — são perguntas diferentes.
> Com `--publish` ela comenta na PR; sem a flag, fica local em `.deep-review/`.
> Um `FIX_BEFORE_SHIP` ignorado é uma decisão, e vai escrita na descrição da PR.

---


## Revisão profunda

A skill `deep-review` roda o pipeline de revisão em seis etapas com artefatos
idempotentes em `.deep-review/`. Instalada uma vez em `.claude/skills/` e
alcançada pelos três harnesses por symlink — `.codex/skills` e
`.opencode/skills` apontam para lá, e nada é duplicado.

```bash
/deep-review                      # diff contra a base, relatório local
/deep-review --pr 7               # uma PR do GitHub
/deep-review --worktree           # trabalho não commitado
/deep-review --pr 7 --publish     # comenta na PR
```

**Onde entra no fluxo:** depois do CI verde e antes do merge em `dev`. O CI prova
que o código roda; a revisão profunda diz se ele está certo. Uma coisa não
substitui a outra, e o veredito não é conselho — `FIX_BEFORE_SHIP` ignorado vira
uma linha na descrição da PR dizendo por quê.

**O que ela recusa a fazer:** aplicar correção. Ela revisa e relata; quem
corrige decide o que aceitar. É por isso que `disable-model-invocation` está
ligado no frontmatter — a skill só roda quando alguém pede.

Configuração opcional em `.deep-review.yaml` na raiz; sem ela, o padrão do
repositório vale, e `path_instructions` do `.coderabbit.yaml` é lido como
fallback para quem vier de lá.

---
## Comandos

> **Os comandos abaixo usam `pnpm jho`.** Para digitar só `jho`, instale o
> atalho uma vez: `ln -sf "$PWD/bin/jho" ~/bin/jho` (com `~/bin` no `PATH`).
> Ele funciona de qualquer subdiretório do projeto.

```bash
rtk pnpm install
rtk pnpm dev                     # dashboard em localhost:3000

# banco
rtk pnpm jho db migrate          # cria/atualiza o schema
rtk pnpm jho db seed             # conta do dono + skills + provedores + posicionamento
rtk pnpm jho db prune --days 90  # remove vagas fechadas sem candidatura

# sourcing
rtk pnpm jho jobs sync           # busca todas as fontes + pontua
rtk pnpm jho jobs score --all    # repontua tudo
rtk pnpm jho jobs verify         # checa se as vagas do topo ainda existem (404 → fecha)
rtk pnpm jho jobs add <url>      # cadastra vaga por URL, resolvendo pelo ATS
rtk pnpm jho jobs import <file> --source revelo   # importa JSON de plataforma logada
rtk pnpm jho sources list        # saúde das fontes
rtk pnpm jho sources probe ashby textlayer        # testa um handle sem gravar
rtk pnpm jho sources snippet revelo               # extrator para plataforma logada

# autenticação
rtk pnpm jho auth seed <email>   # cria a conta do dono, senha gerada e mostrada uma vez
rtk pnpm jho auth status         # modo e contas
rtk pnpm jho auth add-user <email> --role admin,candidate
rtk pnpm jho auth set-password <email>   # senha (entrada escondida ou --stdin)
rtk pnpm jho auth login <email>          # link de uso único → /login/callback

# LLM opcional (BYOK — sua chave, seu custo)
rtk pnpm jho llm seed            # cadastra provedores conhecidos
rtk pnpm jho llm list            # modelos, esforço, custo e quais têm chave
rtk pnpm jho llm use <modelo>    # define o padrão
rtk pnpm jho llm add-provider <slug> --label X --key-env VAR [--kind compatible --base-url URL]
rtk pnpm jho llm add-model <provedor> <modelo> --label X [--reasoning --effort high]
rtk pnpm jho analyze <id>        # leitura qualitativa da vaga; pede confirmação antes de enviar

# candidatura
rtk pnpm jho prep <id>           # dossiê: bloqueios, rede, evidências, vocabulário

# triagem e funil
rtk pnpm jho jobs list --min-fit 60
rtk pnpm jho jobs show <id>      # breakdown completo do score
rtk pnpm jho track <id> applied --channel referral
rtk pnpm jho pipeline

# câmbio
rtk pnpm jho fx refresh          # cotações do BCE (Frankfurter)
rtk pnpm jho fx show

# e-mail (ADR 0008)
rtk pnpm jho mail auth           # conecta o Gmail (escopo somente leitura)
rtk pnpm jho mail fetch          # baixa .eml — não importa nada sozinho
rtk pnpm jho mail import ~/mail --dry-run
rtk pnpm jho mail suggestions    # mudanças de funil sugeridas por e-mail
rtk pnpm jho mail accept <id> | dismiss <id>

# rede e referrals
rtk pnpm jho contacts seed       # empresas onde já trabalhou
rtk pnpm jho contacts add "Nome" -c Empresa -k former
rtk pnpm jho referrals           # vagas onde já conhece alguém

# currículo
rtk pnpm jho cv import <arquivo.pdf>   # extrai texto de PDF (--dry-run para conferir)
rtk pnpm jho cv set <arquivo.md>       # salva de texto/markdown

# vocabulário e skills
rtk pnpm jho skills gap          # o que o mercado escreve e o CV não — lacuna de vocabulário
rtk pnpm jho skills detect       # detecta skills no CV (detectada != confirmada)

# posicionamento
rtk pnpm jho tasks list --horizon 24h
rtk pnpm jho tasks done PT-0001

# segurança
rtk pnpm jho security check      # bind, PII versionada, segredos, permissões do banco

# raspagem (robô de descrições)
rtk pnpm jho scrape queue        # enfileira vagas por fit
rtk pnpm jho scrape run          # captura e trata, em paralelo
rtk pnpm jho scrape status       # situação da fila
rtk pnpm jho scrape reparse      # reprocessa tudo sem baixar de novo

# análise
rtk pnpm jho stats               # diagnóstico do scorer e do funil (--json)

# saída
rtk pnpm jho report              # markdown pro vault Obsidian
rtk pnpm jho profile             # valida profile.yaml

# desenvolvimento
rtk pnpm check                   # typecheck + testes — verde antes de qualquer entrega
rtk pnpm test:e2e                # browser real isolado: build, SQLite e porta temporários
rtk pnpm db:generate             # gera migration após editar schema.ts
```

Referência completa: `docs/cli.md`.

---

## Arquitetura

```
src/contexts/      bounded contexts — auth, correspondence, fx, matching, pursuit, skills
  i18n/            pt-BR e en, chaves tipadas contra o dicionário português
src/core/          lógica pura, compartilhada entre CLI e UI
  db/              composition root Drizzle (28 tabelas), client e migrations
  sources/         um adapter por board público + registry + careers (página própria)
  ingest/          normalização, fingerprint, upsert, import manual, verificação
  scoring/         fit score determinístico (7 componentes) + persistência
                   score.ts · freshness.ts · benefits.ts · apply.ts
  profile/         carga e validação de profile.yaml (Zod)
  mail/            parser MIME, classificador, extrator de job alert, Gmail OAuth
  positioning/     plano da auditoria como dados
  report/          export markdown
  analytics/       estatística: Wilson, Spearman, diagnóstico de componente
  scrape/          fila, robots.txt, captura e extração (duas etapas)
  security.ts      autoverificações (bind, PII, segredos, permissões)
  apply/           dossiê de candidatura (prepara; nunca envia — ADR 0010)
  llm/             porta BYOK, adapters e cadastro de provedores/modelos
                   port.ts · providers.ts · registry.ts · analyze.ts
  clock.ts         relógio injetável — só onde o tempo é decisão, não carimbo
  money.ts         value object (amount + currency + period)
  pdf.ts           extração de PDF (unpdf, JS puro) + limpeza de texto
  contacts.ts      rede profissional e referrals
src/cli.ts         Commander
app/               dashboard Next.js 16 — adapter sobre APIs públicas
config/sources.yaml   quais boards buscar
profile/profile.yaml  perfil do candidato — fonte da verdade do scoring
data/jobs.db       banco local (gitignored)
```

Fluxo: `sources → ingest → scoring → application → report/UI`.

> **Invariante:** a UI é **adaptador**, não implementação paralela. Server
> Components chamam as mesmas APIs públicas que a CLI chama, e a única
> mutação passa por `setApplicationStatus`. Nunca duplique query entre as duas
> superfícies — coloque-a atrás da API pública do contexto proprietário.

Detalhes: `docs/architecture.md`, `docs/data-model.md`.
A migração para hexagonal/DDD está decidida em `docs/adr/0007` e **concluída** —
ver `MIGRATION.md` e `docs/engineering/context-map.md`. Os seis contextos
atuais seguem o padrão da regra 4.

---

## Convenções de código

- **Comentários explicam _por quê_**, não o quê. Comente decisões, trade-offs e
  armadilhas ("Greenhouse HTML-escapa o content", "o primeiro item do RemoteOK
  é aviso legal", "Jobgether anonimiza o empregador por design").
- **Adapters são burros:** fetch, mapear, retornar.
- **Erro de uma fonte não derruba o sync.** Registra em `source.lastError`.
- **Tudo idempotente.**
- **Zod valida o que é editado à mão** (`profile.yaml`, `sources.yaml`).
- **Sem dependência nativa.** libSQL, não `better-sqlite3`.
- **UI:** shadcn/ui sobre Tailwind v4. `--primary` é o azul do `DESIGN.md`.
  Estado de filtro vive na URL, não em React — as páginas não enviam JS de
  cliente.

---

## Ao adicionar uma fonte

1. Adapter em `src/core/sources/` implementando `SourceAdapter`.
2. Registrar em `registry.ts` e no union `SourceKind` de `types.ts`.
3. Adicionar em `config/sources.yaml` com `rationale`.
4. **Validar contra a API real:** `pnpm jho sources probe <kind> <handle>`.

Nunca mapeie campos a partir de documentação sem conferir resposta real.

> **Invariante de qualidade de fonte:** fonte que **nomeia o empregador** vale
> mais que volume anônimo. O Jobgether responde por 74% do acervo, oculta a
> empresa por design e teve **25% de links mortos** na verificação; o Braintrust
> tem 119 vagas, empresa nomeada e elegibilidade por país estruturada.

---

## Estado atual

| Item | Número |
|---|---:|
| Vagas abertas | 6.027 |
| Vagas pontuadas | 6.027 |
| Empresas | 1.031 |
| Fontes ativas | 13 |
| Acima de 45 / 60 / 70 | 1.612 / 262 / 35 |
| Melhor fit | 86,0 |
| Vagas com bloqueador | 468 |
| Descrições offline | 207 |
| Candidaturas no funil | 2 |
| Testes | 1.609 + 89 e2e · cobertura 97,7% fora do CLI · `cli.ts` 39% |

> A última linha é a que importa. O acervo tem 6.239 vagas e o funil tem 1
> candidatura: **o gargalo é a decisão, não a descoberta.** Toda proposta de
> funcionalidade deve ser lida contra isso — ver `docs/product/vision.md`.

Pronto: sourcing (10 adapters), scoring com moeda, funil, e-mail, referrals,
verificação de links, dashboard Next.js, export CSV e markdown.

Não existe ainda: deploy, OAuth do Gmail, geração de CV/cover letter,
publicação no LinkedIn, submissão autônoma. Ver `docs/roadmap.md` — e **não
descreva como pronto o que não está**.

---

## Documentação

| Documento | Quando ler |
|---|---|
| `docs/architecture.md` | Entender o sistema |
| `docs/data-model.md` | Mexer no schema ou em queries |
| `docs/sources.md` | Adicionar/debugar fonte |
| `docs/scoring.md` | Ajustar o ranking |
| `docs/linkedin-policy.md` | **Antes de qualquer coisa de LinkedIn** |
| `docs/email-ingestion.md` | Mexer no pipeline de e-mail |
| `docs/sources-autenticadas.md` | Revelo, BairesDev, marketplaces logados |
| `docs/cli.md` | Referência de comandos |
| `docs/operations.md` | Rotina diária e semanal |
| `docs/security.md` | **Antes de expor a UI ou publicar o repositório** |
| `DESIGN.md` | **Antes de qualquer trabalho de frontend** |
| `docs/adr/0009` | **Fila de raspagem — por que tabela e não broker** |
| `docs/adr/0010` | **Antes de automatizar envio de candidatura** |
| `docs/prompts/system/` | **Antes de mexer em qualquer prompt de LLM** |
| `docs/product/task-auth.md` | Autenticação e autorização — planejado |
| `docs/roadmap.md` | O que vem depois |
| `docs/benchmark/` | Concorrentes e mercado |
| `docs/product/` | **Visão, personas, user stories, backlog** |
| `docs/adr/` | Por que cada decisão |
| `docs/product/vision.md` | **Antes de propor funcionalidade** |
| `docs/product/personas.md` | Antes de mexer em score ou UI |
| `MIGRATION.md` | **Antes de criar arquivo novo em `src/`** |

Este arquivo é a fonte única das instruções para os três harnesses. `CLAUDE.md`
é um symlink para ele — **edite só aqui.**

> Conforme `~/.claude/RTK.md`: no Codex e no OpenCode todo comando de shell vai
> prefixado com `rtk`. No Claude Code o hook global reescreve e não duplica o
> prefixo — o comando já vem com `rtk` e ele não acrescenta outro.


<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
