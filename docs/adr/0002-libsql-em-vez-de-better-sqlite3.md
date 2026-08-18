# ADR 0002 — libSQL em vez de better-sqlite3

**Status:** Aceita · 2026-08-18

## Contexto

O usuário pediu "uma lista, ou sqlite, de vagas". SQLite é a escolha certa:
o dado é pessoal, cabe num arquivo, e não há motivo para operar um servidor
de banco para gerenciar candidaturas.

Mas surgiram duas restrições em momentos diferentes da mesma conversa:

1. **"possivelmente implementar na Vercel"** — o filesystem da Vercel é
   efêmero. Um banco em arquivo local seria zerado a cada deploy, e o
   histórico de candidaturas — a única coisa que o sync jamais recria —
   sumiria silenciosamente.
2. **"por enquanto irei rodar local"** — a operação hoje é local, e não pode
   depender de nenhum serviço externo, conta ou token para funcionar.

As duas precisam ser verdade ao mesmo tempo, sem reescrever a camada de dados
no meio do caminho.

## Decisão

Usar **libSQL** (`@libsql/client`) com Drizzle ORM.

```
Local (hoje)       TURSO_DATABASE_URL=file:./data/jobs.db     sem servidor, sem token
Vercel (depois)    TURSO_DATABASE_URL=libsql://...turso.io    mesmo driver, mesmo SQL
```

libSQL é um fork do SQLite. O dialeto SQL, as migrations e o schema Drizzle
são idênticos nos dois modos — muda só a URL de conexão.

`src/core/db/client.ts` resolve a URL com default para arquivo local, e falha
alto se uma URL remota aparecer sem `TURSO_AUTH_TOKEN` — um deploy mal
configurado deve estourar na largada, não com um 401 no meio de um cron.

## Consequências

**Positivas**

- Zero configuração para rodar local: `pnpm jho db migrate` e pronto.
- **Nenhuma dependência nativa.** `better-sqlite3` exige compilação
  node-gyp, que quebra em troca de versão de Node e é notoriamente hostil
  em ambientes serverless.
- O caminho para a Vercel já está pronto e não pede refactor — é variável
  de ambiente.
- Drizzle Studio (`pnpm db:studio`) funciona nos dois modos.

**Negativas**

- libSQL é levemente mais lento que `better-sqlite3` para operações síncronas
  em processo, por ser assíncrono por natureza. Irrelevante nesta escala:
  o sync de 4.824 vagas roda em segundos, e o gargalo real é a rede.
- Uma dependência a mais em relação ao `node:sqlite` nativo do Node 24 — que
  foi descartado por ser experimental e por não ter o caminho remoto.

## Alternativas consideradas

**`node:sqlite` (nativo do Node 24).** Zero dependências, muito atraente para
o modo local. Rejeitado: é experimental (emite `ExperimentalWarning`), o
suporte do Drizzle não é maduro, e não resolve nada do lado remoto — exigiria
trocar a camada de dados inteira ao ir para a Vercel.

**Postgres (Neon/Vercel Postgres) desde o início.** Rejeitado para a fase 1:
obriga a ter conta e conexão de rede para rodar localmente, contrariando
diretamente o "por enquanto irei rodar local". Continua sendo a saída natural
se o volume ou a concorrência crescerem além do que faz sentido em SQLite.
