[Índice](README.md)

---

# Implantar na Vercel com Turso

O código já fala Turso: `src/core/db/client.ts` lê `TURSO_DATABASE_URL` e
`TURSO_AUTH_TOKEN` e cai para `file:./data/jobs.db` quando não há nenhum. Não há
adaptador a escrever — o que existe é migração de dado, configuração e três
decisões que a mudança de forma de execução força.

## O que muda ao sair do laptop

Este sistema foi escrito para rodar em `127.0.0.1`, com um banco em arquivo e
um operador só. Nada disso é acidental — está nas ADRs 0002 e 0009 — e três
coisas deixam de valer num ambiente serverless.

### 1. O limite de requisição vira por instância

`createRateLimiter` guarda os contadores na memória do processo. Na Vercel cada
invocação pode cair numa instância diferente, então o limite de 30 requisições
em 5 minutos passa a valer **por instância**, não por visitante.

Não é ruína: continua encarecendo a varredura, porque um varredor sequencial
tende a reusar a mesma instância quente. Mas deixa de ser garantia. Se o
portfólio público virar alvo real, o limite precisa sair para um armazenamento
compartilhado — e aí a ADR 0009 se inverte, porque o motivo dela (processo
único, banco local) deixou de existir.

### 2. O robô de captura e a reconferência não têm onde rodar

`jho scrape run` e `jho jobs recheck run` são comandos de terminal que rodam por
minutos. Uma função serverless tem teto de duração, e o de 30 segundos declarado
no `vercel.json` não é generoso — é o máximo do plano gratuito.

Duas saídas, e a escolha é de custo:

- **Cron da Vercel chamando uma rota que processa um lote pequeno.** É o que o
  `vercel.json` prevê: uma chamada por dia que consome parte da fila. Simples,
  cabe no plano gratuito, e leva dias para vencer uma fila grande.
- **Continuar rodando no laptop, contra a Turso.** O `jho` aponta para o banco
  remoto pelas mesmas variáveis, e a máquina que já roda a sincronização
  continua rodando. Zero infraestrutura nova, e é o caminho recomendado
  enquanto o operador for um.

### 3. `profile.yaml` e `sources.yaml` são lidos do disco em runtime

`loadProfile()` e `loadSourcesConfig()` fazem `readFile` sobre `process.cwd()`.
Os dois arquivos estão versionados e entram no pacote, mas o Turbopack avisa que
o acesso dinâmico ao sistema de arquivos "causa o rastreamento do projeto
inteiro" — é como eles acabam incluídos, e é frágil.

`JHO_PROFILE_PATH` e `JHO_SOURCES_PATH` existem e permitem apontar para outro
lugar. Enquanto os dois arquivos forem versionados, o padrão funciona.

## Variáveis

| Variável | Onde | Para quê |
|---|---|---|
| `TURSO_DATABASE_URL` | Vercel + local | `libsql://<banco>-<org>.turso.io` |
| `TURSO_AUTH_TOKEN` | Vercel + local | token do banco |
| `RESEND_API_KEY` | Vercel | e-mail transacional; sem ela o link vai para o log |
| `RESEND_FROM` | Vercel | remetente de domínio verificado |
| `CRON_SECRET` | Vercel | protege a rota de cron; a Vercel a envia em `authorization` |

**`JHO_AUTH_MODE` não deve existir em produção.** Com `open`, o sistema sintetiza
uma sessão e serve currículo, funil e export para qualquer requisição. É modo de
desenvolvimento local e num endereço público é o vazamento inteiro.

## Os três ambientes

Um banco por ambiente, no grupo `master-jobs` em `aws-us-east-1` — a mesma
região das funções da Vercel (`iad1`), para o round-trip não atravessar o país.

| Branch | Endereço | Banco Turso | Ambiente Vercel |
|---|---|---|---|
| `main` | `jobs.mastertimm.com.br` | `master-jobs` | Production |
| `staging` | `jobs-staging.mastertimm.com.br` | `master-jobs-staging` | Preview |
| `dev` | `jobs-dev.mastertimm.com.br` | `master-jobs-dev` | Preview |
| — | local | `file:./data/jobs.db` | Development |

Os três compartilham o schema; só o de produção carrega dado real. `dev` e
`staging` nascem vazios de propósito: copiar produção para lá levaria junto
`auth_user`, `auth_session` e `auth_login_token` — credenciais de gente de
verdade num ambiente com menos cuidado. Para popular um deles, aponte o script
para a URL correspondente e escolha à mão o que copiar.

As variáveis `TURSO_*` de `staging` e `dev` estão declaradas **por branch** no
ambiente Preview da Vercel, e não só no Preview genérico. Sem isso as duas
branches dividiriam o mesmo banco, e uma migração destrutiva testada em `dev`
levaria `staging` junto.

### DNS

Os três são `CNAME` para `cname.vercel-dns.com` na Cloudflare, **sem proxy**
(nuvem cinza). Com a nuvem laranja ligada a Vercel não consegue emitir o
certificado, e o resultado são dois CDNs em série sem ninguém ganhar nada.

### Quem enxerga o quê

A proteção de deployment da Vercel está em `all_except_custom_domains`. Ela
isenta **apenas o domínio de produção**: `jobs.mastertimm.com.br` responde a
qualquer visitante, e é o que o portfólio público (`/p/…`) e o manifest da PWA
exigem.

`jobs-dev` e `jobs-staging` continuam atrás do SSO da Vercel, e isso é
deliberado — ambiente de teste com dado de teste não precisa de plateia. Para
abri-los seria preciso desligar a proteção do projeto inteiro, o que tornaria
pública também toda URL de preview de PR.

## O portão

`.github/workflows/ci.yml` roda typecheck, testes com cobertura e build no PR e
no push das três branches. `migrate.yml` aplica as migrações no banco da branch.

**A Vercel implanta no push, independente do CI.** As duas coisas disparam do
mesmo evento e não se conhecem: sem proteção de branch em `main` exigindo o CI
verde, o workflow vermelho não impede o deploy. O portão existe, mas só fecha
depois que alguém liga a proteção em Settings → Branches.

Segredos que o `migrate.yml` precisa, um por ambiente para que um workflow de
`dev` comprometido não alcance produção: `TURSO_TOKEN_PROD`,
`TURSO_TOKEN_STAGING`, `TURSO_TOKEN_DEV`.

## Migrar o banco

```bash
turso db tokens create master-jobs

export TURSO_DATABASE_URL="libsql://master-jobs-andreustimm.aws-us-east-1.turso.io"
export TURSO_AUTH_TOKEN="..."

pnpm jho db migrate          # cria o schema no banco remoto
node scripts/turso-migrate.mjs --dry-run --skip-html
node scripts/turso-migrate.mjs --skip-html
```

`--reset` limpa o destino antes de copiar. É o que se usa para refazer uma carga
que morreu no meio: sem ele o script recusa destino não-vazio, porque
`INSERT OR REPLACE` sobrescreveria em silêncio um banco que talvez não seja o
que se pensa.

As FKs ficam desligadas durante a cópia via `client.migrate()`, e **não** por
`PRAGMA foreign_keys=OFF`: o pragma é ignorado dentro de transação, e
`batch(…, "write")` abre uma. O `pragma foreign_key_check` no fim é o que
confere o resultado.

O banco local tem **529 MB**, e a maior parte não é o que parece:

| | tamanho | linhas |
|---|---:|---:|
| `job_page.html` + `text` | 145 MB | 220 |
| `job.description_text` + `raw` | 130 MB | 8.768 |

`job_page.html` é HTML bruto guardado para o `jho scrape reparse` — reextrair
quando o parser melhora, sem tornar a buscar a página. São 660 KB por linha, e
é o único dado do sistema que existe apenas para ser reprocessado.

`--skip-html` deixa esses 145 MB para trás. O custo é que um reparse futuro
precisará rebuscar as páginas; o ganho é migrar menos de um terço do volume. A
escolha é de quem implanta, e por isso não tem padrão implícito: a flag precisa
ser digitada.

## O que confirmar depois de subir

1. `/login` responde e nenhuma outra rota responde sem sessão.
2. `/p/<slug>` de um perfil privado devolve **404**, não 403.
3. `jho jobs recheck status` a partir do laptop enxerga a mesma fila.
4. `/manifest.json` e `/sw.js` respondem — sem eles a PWA não instala.
