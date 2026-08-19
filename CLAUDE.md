# job-hunt-os — instruções para agentes

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

> **4. Só sintaxe TypeScript apagável.**
> Runtime é o type stripping nativo do Node 24: sem `enum`, sem parameter
> properties, sem `namespace`, sem decorators. `erasableSyntaxOnly: true` no
> `tsconfig.json`. Se `pnpm jho` estourar `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`,
> é isso. Imports relativos carregam extensão `.ts` explícita.

> **5. Mexeu no scorer ou em `profile.yaml`? Bump `SCORER_VERSION`.**
> Fica em `src/core/scoring/score.ts` (hoje `1.2.1`). Depois
> `pnpm jho jobs score --all`. Sem o bump, duas gerações de score convivem na
> mesma coluna sem sinal visível.

> **6. Não invente evidência.**
> Tailoring de CV só cita o que está em `evidence:` no `profile.yaml`.
> O que está em `growth:` é lacuna assumida — sinalize, nunca maquie.

> **7. Dado faltante pontua neutro, nunca punitivo.**
> Vaga sem data de publicação não é vaga velha; vaga sem descrição não é vaga
> sem benefício. Punir ausência rebaixa a fonte pela qualidade da API dela, não
> pela qualidade do emprego. `freshness` sem data vale 0,5; `benefits` em texto
> curto vale 0,5 e **nunca** gera bloqueador.

> **8. Todo frontend segue o `DESIGN.md`. Sem exceção.**
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
> (ver regra 9). Um layout que só existe no desktop não cumpriu o DESIGN.md.

> **9. Toda tela funciona no celular.**
> `export const viewport` com `width: device-width` no layout raiz — sem isso o
> telefone renderiza a 980px e todo o CSS responsivo vira código morto. Grid de
> múltiplas colunas precisa de fallback de coluna única; nada de largura fixa
> acima de 360px; nunca limite o zoom. Coberto por `tests/mobile.test.ts`.

> **10. O dashboard nunca faz bind fora de `127.0.0.1`.**
> Não há autenticação nenhuma, e ele serve CV, funil e piso salarial. Em rede
> compartilhada isso é publicação. `--hostname 127.0.0.1` nos scripts `dev` e
> `start`; travado por teste. Ver `docs/security.md`.

> **11. `??` não protege contra string vazia.**
> Várias APIs devolvem `""` para campo não preenchido. Use `firstNonEmpty()`
> de `src/core/sources/http.ts`. Esse bug já apagou 4.538 descrições uma vez.

---

## Comandos

```bash
pnpm install
pnpm dev                     # dashboard em localhost:3000

# banco
pnpm jho db migrate          # cria/atualiza o schema
pnpm jho db seed             # plano de posicionamento + baseline de métricas
pnpm jho db prune --days 90  # remove vagas fechadas sem candidatura

# sourcing
pnpm jho jobs sync           # busca todas as fontes + pontua
pnpm jho jobs score --all    # repontua tudo
pnpm jho jobs verify         # checa se as vagas do topo ainda existem (404 → fecha)
pnpm jho jobs add <url>      # cadastra vaga por URL, resolvendo pelo ATS
pnpm jho jobs import <file> --source revelo   # importa JSON de plataforma logada
pnpm jho sources list        # saúde das fontes
pnpm jho sources probe ashby textlayer        # testa um handle sem gravar
pnpm jho sources snippet revelo               # extrator para plataforma logada

# triagem e funil
pnpm jho jobs list --min-fit 60
pnpm jho jobs show <id>      # breakdown completo do score
pnpm jho track <id> applied --channel referral
pnpm jho pipeline

# câmbio
pnpm jho fx refresh          # cotações do BCE (Frankfurter)
pnpm jho fx show

# e-mail (ADR 0008)
pnpm jho mail auth           # conecta o Gmail (escopo somente leitura)
pnpm jho mail fetch          # baixa .eml — não importa nada sozinho
pnpm jho mail import ~/mail --dry-run
pnpm jho mail suggestions    # mudanças de funil sugeridas por e-mail
pnpm jho mail accept <id> | dismiss <id>

# rede e referrals
pnpm jho contacts seed       # empresas onde já trabalhou
pnpm jho contacts add "Nome" -c Empresa -k former
pnpm jho referrals           # vagas onde já conhece alguém

# currículo
pnpm jho cv import <arquivo.pdf>   # extrai texto de PDF (--dry-run para conferir)
pnpm jho cv set <arquivo.md>       # salva de texto/markdown

# vocabulário e skills
pnpm jho skills gap          # o que o mercado escreve e o CV não — lacuna de vocabulário
pnpm jho skills detect       # detecta skills no CV (detectada != confirmada)

# posicionamento
pnpm jho tasks list --horizon 24h
pnpm jho tasks done PT-0001

# segurança
pnpm jho security check      # bind, PII versionada, segredos, permissões do banco

# raspagem (robô de descrições)
pnpm jho scrape queue        # enfileira vagas por fit
pnpm jho scrape run          # captura e trata, em paralelo
pnpm jho scrape status       # situação da fila
pnpm jho scrape reparse      # reprocessa tudo sem baixar de novo

# análise
pnpm jho stats               # diagnóstico do scorer e do funil (--json)

# saída
pnpm jho report              # markdown pro vault Obsidian
pnpm jho profile             # valida profile.yaml

# desenvolvimento
pnpm check                   # typecheck + testes — verde antes de qualquer entrega
pnpm db:generate             # gera migration após editar schema.ts
```

Referência completa: `docs/cli.md`.

---

## Arquitetura

```
src/core/          lógica pura, compartilhada entre CLI e UI
  db/              schema Drizzle (14 tabelas), client libSQL, queries, migrations
  sources/         um adapter por board público + registry
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
A migração para hexagonal/DDD está decidida em `docs/adr/0007` e rastreada em
`MIGRATION.md` — **leia antes de criar arquivo novo**.

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
| Vagas abertas | 6.239 |
| Vagas pontuadas | 6.239 |
| Empresas | 1.031 |
| Fontes ativas | 13 |
| Acima de 45 / 60 / 70 | 1.600 / 207 / 23 |
| Melhor fit | 84,0 |
| Vagas com bloqueador | 468 |
| Candidaturas no funil | 1 |
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
| `docs/roadmap.md` | O que vem depois |
| `docs/benchmark/` | Concorrentes e mercado |
| `docs/product/` | **Visão, personas, user stories, backlog** |
| `docs/adr/` | Por que cada decisão |
| `docs/product/vision.md` | **Antes de propor funcionalidade** |
| `docs/product/personas.md` | Antes de mexer em score ou UI |
| `MIGRATION.md` | **Antes de criar arquivo novo em `src/`** |

`AGENTS.md` é o espelho deste arquivo para Codex e OpenCode. **Editou um,
edite o outro.**
