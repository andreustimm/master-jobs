# job-hunt-os — instruções para agentes (Codex / OpenCode)

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
> Fica em `src/core/scoring/score.ts` (hoje `1.2.1`). Depois
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

> **9. Todo frontend segue o sistema de temas.**
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

> **10. Toda tela funciona no celular.**
> Verificado por `pnpm test:e2e`, que mede `scrollWidth` real em 375px. Teste
> estático não pega estouro horizontal — os dois que existiam passavam por
> todos os greps e só apareceram num browser.
> `export const viewport` com `width: device-width` no layout raiz — sem isso o
> telefone renderiza a 980px e todo o CSS responsivo vira código morto. Grid de
> múltiplas colunas precisa de fallback de coluna única; nada de largura fixa
> acima de 360px; nunca limite o zoom. Coberto por `tests/mobile.test.ts`.

> **11. O dashboard nunca faz bind fora de `127.0.0.1`.**
> Não há autenticação nenhuma, e ele serve CV, funil e piso salarial. Em rede
> compartilhada isso é publicação. `--hostname 127.0.0.1` nos scripts `dev` e
> `start`; travado por teste. Ver `docs/security.md`.

> **12. Nada neste sistema envia uma candidatura.**
> `jho prep` monta o dossiê; quem envia é o usuário. Automatizar envio antes de
> a triagem estar calibrada acelera o gargalo errado, e candidatura enviada não
> volta. ADR 0010 define as três condições para reavaliar.

> **13. Autenticação é exigida por omissão.**
> Nenhuma página nem API responde sem sessão válida — inclusive `/api/export`,
> que carrega o acervo inteiro. O modo aberto existe mas precisa ser pedido:
> `JHO_AUTH_MODE=open`. "Só roda em loopback" protege contra a internet, não
> contra outro processo, outra conta da máquina, nem contra um bind errado —
> que já aconteceu aqui. Segurança por omissão é a omissão ser a opção segura.
>
> Primeiro acesso: `jho auth add-user <email> --role owner` e
> `jho auth set-password <email>`. Sem conta cadastrada, `/login` mostra esses
> dois comandos em vez de um formulário sem saída.

> **14. Autorização passa por `can()`, e o escopo vem da sessão.**
> Toda Server Action chama `guard(...)` **antes** de qualquer efeito, e **toda
> página chama `requirePage(...)`** — guardar só as actions deixa o dado
> legível por quem não tem sessão. `middleware.ts` é a rede grossa (existe
> cookie?), a página é a checagem real (o cookie vale?). Nenhuma action aceita
> `candidateId` da própria entrada — id em FormData é pedido, não prova.
> Exceção única e registrada: `passwordLoginAction`, onde a sessão nasce; ela
> é protegida por limite de tentativas, não por permissão.
> A decisão mora em `src/contexts/auth/domain/policy.ts`, é pura, e nega por
> padrão. Coberto por teste de arquitetura.

> **15. Chave de API nunca vai para o banco.**
> O cadastro de provedores guarda o **nome da variável de ambiente**, jamais a
> chave. Banco é copiado, versionado em backup e aberto por outros processos —
> chave dentro dele viaja junto. BYOK só é promessa cumprida se for estrutural.
> Há teste asserindo que nenhuma coluna guarda chave e que nada a imprime.

> **16. `??` não protege contra string vazia.**
> Várias APIs devolvem `""` para campo não preenchido. Use `firstNonEmpty()`
> de `src/core/sources/http.ts`. Esse bug já apagou 4.538 descrições uma vez.

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
rtk pnpm jho auth add-user <email> --role owner
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
rtk pnpm test:e2e                # browser real: fonte, tooltip, mobile (precisa do dev no ar)
rtk pnpm db:generate             # gera migration após editar schema.ts
```

Referência completa: `docs/cli.md`.

---

## Arquitetura

```
src/contexts/      bounded contexts (ADR 0007) — auth, skills
src/core/          lógica pura, compartilhada entre CLI e UI
  db/              schema Drizzle (14 tabelas), client libSQL, queries, migrations
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
  fx.ts            cotações com cache
  contacts.ts      rede profissional e referrals
src/cli.ts         Commander
app/               dashboard Next.js 16 — Server Components sobre src/core
config/sources.yaml   quais boards buscar
profile/profile.yaml  perfil do candidato — fonte da verdade do scoring
data/jobs.db       banco local (gitignored)
```

Fluxo: `sources → ingest → scoring → application → report/UI`.

> **Invariante:** a UI é **adaptador**, não implementação paralela. Server
> Components chamam as mesmas funções de `src/core` que a CLI chama, e a única
> mutação passa por `setApplicationStatus`. Nunca duplique query entre as duas
> superfícies — coloque em `src/core/db/repo.ts`.

Detalhes: `docs/architecture.md`, `docs/data-model.md`.
A migração para hexagonal/DDD está decidida em `docs/adr/0007` e **concluída** —
ver `MIGRATION.md`, inclusive as duas notas sobre passos resolvidos por outro
caminho. `contexts/skills/` e `contexts/auth/` são o padrão para módulo novo
(regra 4).

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
| Testes | 242 |

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

Este arquivo é o espelho de `CLAUDE.md`, gerado a partir dele. **Editou um,
edite o outro.**

> Conforme `~/.claude/RTK.md`: no Codex e no OpenCode todo comando de shell vai
> prefixado com `rtk`. No Claude Code **não** — lá o hook global já reescreve.


<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
