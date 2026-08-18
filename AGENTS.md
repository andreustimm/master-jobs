# job-hunt-os — instruções para agentes (Codex / OpenCode)

Espelho de `CLAUDE.md`. **Editou um, edite o outro.**

Sistema de sourcing, scoring e gestão de candidaturas de **Andreus Timm**
(Senior AI Software Architect, 20+ anos, São Paulo/Brasil, remoto B2B,
**sem autorização de trabalho nos EUA**).

---

## Diferença específica deste arquivo: prefixo `rtk`

Codex e OpenCode devem prefixar **todo** comando de shell com `rtk`
(o proxy que reduz a saída sem alterar o comando):

```bash
rtk pnpm jho jobs sync
rtk pnpm test
rtk git status
rtk rg -n "scoreJob" src
```

Use `rtk proxy <comando>` quando precisar da saída bruta que o filtro omite.
No Claude Code isso é automático via hook — **não** duplique o prefixo lá.

---

## Regras invioláveis

1. **Nunca faça scraping do LinkedIn.** Nada aqui pode ler `li_at`, dirigir
   sessão autenticada ou usar "LinkedIn MCP" não oficial. Viola a seção 8.2
   do User Agreement e arrisca a conta que é o principal ativo de
   posicionamento do usuário. Publicação usa API oficial (`w_member_social`);
   comentários, conexões e busca são **assistidos** — o agente redige, o
   humano executa. Ver `docs/linkedin-policy.md`.
2. **Ingestão nunca escreve em `application`.** Essa tabela é estado do
   usuário. Sync mexe em `job`, jamais em decisões.
3. **Vaga que some é fechada (`closedAt`), nunca deletada.**
4. **Só sintaxe TypeScript apagável.** Runtime é o type stripping nativo do
   Node 24: sem `enum`, sem parameter properties, sem `namespace`, sem
   decorators. `erasableSyntaxOnly: true` está ligado no `tsconfig.json`.
5. **Mexeu em `profile.yaml` ou no scorer? Bump `SCORER_VERSION`**
   (`src/core/scoring/score.ts`) e rode `rtk pnpm jho jobs score --all`.
6. **Não invente evidência.** Tailoring de CV só cita `evidence` do
   `profile.yaml`. O que está em `growth` é lacuna assumida — sinalize,
   não maquie.

---

## Comandos

```bash
rtk pnpm install
rtk pnpm jho db migrate
rtk pnpm jho jobs sync
rtk pnpm jho jobs list --min-fit 60
rtk pnpm jho jobs show <id>
rtk pnpm jho track <id> applied
rtk pnpm jho pipeline
rtk pnpm jho report
rtk pnpm jho sources list
rtk pnpm jho sources probe ashby textlayer
rtk pnpm jho profile
rtk pnpm jho db seed
rtk pnpm jho tasks list
rtk pnpm jho tasks done PT-0001

rtk pnpm check          # typecheck + test
rtk pnpm db:generate    # após editar schema.ts
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
data/jobs.db       banco local (gitignored)
```

Fluxo: `sources` → `ingest` → `scoring` → `application` → `report`.

---

## Convenções

- Comentários explicam **por quê**, não o quê.
- Adapters são burros: fetch, mapear, retornar. Normalização e scoring são
  responsabilidade das camadas seguintes.
- Erro de uma fonte não derruba o sync — registra em `source.lastError` e segue.
- Tudo idempotente.
- Zod valida o que é editado à mão (`profile.yaml`, `sources.yaml`).
- Sem dependência nativa: libSQL, não `better-sqlite3`.

---

## Ao adicionar uma fonte

1. Adapter em `src/core/sources/` implementando `SourceAdapter`.
2. Registrar em `src/core/sources/registry.ts`.
3. Adicionar em `config/sources.yaml` com `rationale`.
4. **Validar contra a API real:** `rtk pnpm jho sources probe <kind> <handle>`.

Nunca mapeie campos a partir de documentação sem conferir uma resposta real.

---

## Estado atual

Fase 1 pronta: 12 fontes, **4.824 vagas ingeridas** num sync real, scoring
auditável, funil e export funcionando.

Não existe ainda: UI Next.js, deploy Vercel, geração de CV/cover letter,
publicação no LinkedIn. Ver `docs/roadmap.md`.

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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
