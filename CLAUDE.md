# job-hunt-os — instruções para agentes

Sistema de sourcing, scoring e gestão de candidaturas de **Andreus Timm**
(Senior AI Software Architect, 20+ anos, São Paulo/Brasil, remoto B2B,
**sem autorização de trabalho nos EUA**).

Objetivo: encontrar vagas que dão match com o perfil, ranqueá-las de forma
auditável, e gerenciar o funil de candidaturas. Hoje roda **localmente**.

---

## Regras invioláveis

> **1. Nunca faça scraping do LinkedIn.**
> Nada neste repositório pode ler `li_at`, dirigir uma sessão autenticada,
> ou usar um "LinkedIn MCP" não oficial. Isso viola a seção 8.2 do User
> Agreement e coloca em risco a conta que é o principal ativo de
> posicionamento do usuário. Publicação usa a API oficial
> (`w_member_social`); comentários, conexões e busca são **assistidos** —
> o agente redige, o humano executa. Detalhes: `docs/linkedin-policy.md`.

> **2. Ingestão nunca escreve em `application`.**
> A tabela `application` é estado do usuário. Sync pode inserir, atualizar e
> fechar `job`, mas jamais toca decisões. Quebrar isso destrói histórico.

> **3. Vaga que some é fechada, não deletada.**
> Marque `closedAt`. Deletar quebra o histórico de candidaturas.

> **4. Só sintaxe TypeScript apagável.**
> O runtime é o type stripping nativo do Node 24 — sem `enum`, sem parameter
> properties (`constructor(private x: T)`), sem `namespace`, sem decorators.
> `erasableSyntaxOnly: true` está ligado no `tsconfig.json` para pegar isso
> em tempo de checagem. Se o `pnpm jho` estourar `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`,
> é isso.

> **5. Mexeu em `profile.yaml` ou no scorer? Bump `SCORER_VERSION`.**
> Fica em `src/core/scoring/score.ts`. Depois rode `pnpm jho jobs score --all`.
> Sem o bump, scores antigos ficam misturados com novos e ninguém percebe.

> **6. Não invente evidência.**
> O agente de tailoring de CV só pode citar o que está em `profile.yaml`
> na chave `evidence`. O que está em `growth` é lacuna assumida — sinalize,
> nunca maquie.

---

## Comandos

```bash
pnpm install
pnpm jho db migrate          # cria/atualiza o schema
pnpm jho jobs sync           # busca todas as fontes + score automático
pnpm jho jobs list --min-fit 60
pnpm jho jobs show <id>      # breakdown completo do score
pnpm jho track <id> applied  # move no funil
pnpm jho pipeline            # estado do funil
pnpm jho report              # exporta markdown pro vault Obsidian
pnpm jho sources list        # saúde das fontes
pnpm jho sources probe ashby textlayer   # testa um handle sem gravar nada
pnpm jho profile             # valida profile.yaml
pnpm jho db seed             # carrega o plano de posicionamento (auditoria §14)
pnpm jho tasks list          # plano de posicionamento em aberto
pnpm jho tasks done PT-0001  # conclui um item do plano

pnpm test                    # vitest
pnpm typecheck               # tsgo --noEmit
pnpm check                   # typecheck + test
pnpm db:generate             # gera migration após editar schema.ts
```

Referência completa: `docs/cli.md`.

---

## Arquitetura

```
src/core/          lógica pura, compartilhada entre CLI e futura UI Next.js
  db/              schema Drizzle, client libSQL, queries, migrations
  sources/         um adapter por board público (ATS + agregadores)
  ingest/          normalização, fingerprint, upsert idempotente
  scoring/         fit score determinístico + persistência
  profile/         carga e validação de profile.yaml (Zod)
  report/          export markdown pro vault
src/cli.ts         Commander — toda a superfície de uso hoje
config/sources.yaml   quais boards buscar
profile/profile.yaml  perfil do candidato — fonte da verdade do scoring
drizzle/           migrations SQL geradas
data/jobs.db       banco local (gitignored)
```

Fluxo: `sources` → `ingest` → `scoring` → `application` → `report`.

Detalhes: `docs/architecture.md` e `docs/data-model.md`.

---

## Convenções de código

- **Comentários explicam _por quê_, não _o quê_.** O código já diz o que faz.
  Comente decisões, trade-offs e armadilhas (ex.: "Greenhouse HTML-escapa o
  content", "o primeiro item do RemoteOK é aviso legal").
- **Adapters são burros:** fetch, mapear, retornar. Nada de normalizar,
  deduplicar ou pontuar dentro de um adapter.
- **Erros de uma fonte não derrubam o sync.** Registre em `source.lastError`
  e siga. Um board com handle errado não pode custar as outras 11 fontes.
- **Tudo idempotente.** Todo comando pode rodar de novo sem estragar nada.
- **Zod valida o que é editado à mão** (`profile.yaml`, `sources.yaml`).
  Falhe alto e com mensagem útil, não silenciosamente.
- **Sem dependência nativa.** libSQL, não `better-sqlite3` — o mesmo driver
  serve arquivo local hoje e Turso amanhã.

---

## Ao adicionar uma fonte

1. Escreva o adapter em `src/core/sources/` implementando `SourceAdapter`.
2. Registre em `src/core/sources/registry.ts`.
3. Adicione em `config/sources.yaml` com um `rationale` — por que essa fonte
   está na lista.
4. **Valide contra a API real** antes de commitar:
   `pnpm jho sources probe <kind> <handle>`.

Nunca escreva um mapeamento de campos a partir de documentação sem conferir
uma resposta real. Todos os adapters atuais foram verificados assim.

---

## Estado atual

Fase 1 pronta e validada: 12 fontes configuradas, **4.824 vagas ingeridas**
num sync real, scoring auditável, funil funcionando, export pro Obsidian.

Não existe ainda: UI Next.js, deploy Vercel, geração de CV/cover letter,
integração de publicação no LinkedIn. Ver `docs/roadmap.md` — e não descreva
como pronto o que ainda não está.

---

## Documentação

| Documento | Quando ler |
|---|---|
| `docs/architecture.md` | Entender o sistema inteiro |
| `docs/data-model.md` | Mexer no schema ou em queries |
| `docs/sources.md` | Adicionar/debugar uma fonte |
| `docs/scoring.md` | Ajustar o ranking |
| `docs/linkedin-policy.md` | **Antes de qualquer coisa envolvendo LinkedIn** |
| `docs/cli.md` | Referência de comandos |
| `docs/operations.md` | Rotina diária/semanal |
| `docs/roadmap.md` | O que vem depois |
| `docs/adr/` | Por que as decisões foram tomadas |

`AGENTS.md` é o espelho deste arquivo para Codex e OpenCode. **Editou um,
edite o outro** — eles devem dizer a mesma coisa.
