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

`RESEND_API_KEY` e `RESEND_FROM` formam um par: se qualquer uma estiver ausente
ou vazia, `configuredMailer` usa o adapter de console e nenhum e-mail é enviado.
O operador cria a chave no Resend, verifica o domínio e cadastra os dois valores
diretamente no ambiente da Vercel. Os valores reais não devem ser copiados para
`.env.example`, documentação, logs ou commits.

O suporte ao Gmail também está completo no código, mas a ativação pertence ao
operador: criar `GMAIL_CLIENT_ID` e `GMAIL_CLIENT_SECRET` no Google Cloud,
configurá-los fora do Git e executar `jho mail auth`. O escopo solicitado é
somente `gmail.readonly`; a ausência dessas credenciais não desativa a importação
manual de `.eml`.

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

## A varredura diária

> **Pausa operacional — 03/09/2026:** o workflow e o cron da Vercel estão
> temporariamente desabilitados para proteger a cota compartilhada do Turso.
> Consulte o [diagnóstico e os gates de reativação](../operations/turso-quota-incident-2026-09-03.md).

Quando habilitado, `.github/workflows/varredura.yml` roda `jobs sync`, `scrape
queue`+`run` e `jobs recheck queue`+`run` contra **produção**, todo dia às
06:00 UTC (03:00 em São Paulo), com `workflow_dispatch` para rodar à mão depois
de mexer em `config/sources.yaml`.

**Por que no GitHub e não na Vercel.** A Vercel tem `/api/cron/recheck`, e ele
resolve um pedaço pequeno: 25 vagas por execução, porque o teto de função no
plano gratuito é de 30 segundos. Com 427 vagas elegíveis (fit ≥ 55, abertas, com
URL), o ciclo completo leva ~17 dias — enquanto `enqueueStale` declara a meta de
reconferir a cada 7. O cron de lá entrega menos da metade do que promete, e não
por defeito: por teto.

E a **busca** não roda lá de jeito nenhum: `jobs sync` e `scrape run` não têm
rota de API. Um runner do GitHub tem 6 horas por job, e é a mesma tarefa num
lugar onde ela cabe. A rota da Vercel servia como rede de segurança, mas não
deve voltar junto com o Actions sem orçamento e responsabilidade distintos.

Só produção é varrida. `dev` e `staging` existem para exercitar código, não para
acumular acervo — varrer os três triplicaria as requisições contra APIs de
terceiros para produzir dois acervos que ninguém lê.

O passo final confere `jho sources list`, porque `syncAll` **não aborta** quando
uma fonte quebra (o que é certo: uma API fora do ar não pode zerar a varredura).
O efeito colateral é a falha ficar silenciosa até alguém olhar — então o CI
olha. Uma fonte fora é aviso; mais da metade é erro, porque aí a causa é comum e
provavelmente daqui.

Segredos opcionais: `ADZUNA_APP_ID` e `ADZUNA_APP_KEY`. Das 15 fontes ativas,
nenhuma exige Adzuna; se ele for habilitado sem essas credenciais, é ignorado
com aviso e as outras fontes seguem.

## O portão

`.github/workflows/ci.yml` roda typecheck, testes com cobertura e build no PR e
no push das três branches. `migrate.yml` aplica migrações somente em produção,
no push de `main`. As migrações de `dev` e `staging` estão desativadas porque
seus bancos Turso foram excluídos para reduzir consumo. A reativação exige
provisionar os bancos, configurar seus tokens e restaurar os gatilhos e passos
correspondentes no workflow. Esta configuração não pausa os deployments da Vercel.

**A Vercel implanta no push, independente do CI.** As duas coisas disparam do
mesmo evento e não se conhecem: sem proteção de branch em `main` exigindo o CI
verde, o workflow vermelho não impede o deploy. O portão existe, mas só fecha
depois que alguém liga a proteção em Settings → Branches.

O único segredo usado por `migrate.yml` é `TURSO_TOKEN_PROD`.

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

Uma cópia real do banco tinha **525,7 MiB**, e a maior parte era entrada
reconstruível duplicada:

| | tamanho | linhas |
|---|---:|---:|
| `job_page.html` | 137,1 MiB | 220 |
| `job.raw` | 125,3 MiB | 13.384 |
| `job.description_html` | 67,7 MiB | 13.384 |
| `job.description_text` | 65,7 MiB | 13.384 |

Desde a ADR 0019, `job_page.html` é apagado após extração bem-sucedida; fontes
de rede também deixam de persistir o payload integral em `raw` e
`description_html` (o `workplaceType` mínimo permanece quando declarado). Uma cópia real
passou a aproximadamente 108 MiB usados após:

```bash
pnpm jho db cleanup
pnpm jho db cleanup --apply
```

`--skip-html` continua útil ao migrar snapshots antigos. Páginas cuja extração
falhou preservam HTML; páginas tratadas exigem `scrape queue --refresh` para um
novo processamento.

## O que confirmar depois de subir

1. `/login` responde e nenhuma outra rota responde sem sessão.
2. `/p/<slug>` de um perfil privado devolve **404**, não 403.
3. `jho jobs recheck status` a partir do laptop enxerga a mesma fila.
4. `/manifest.json`, `/sw.js`, `/icons/icon-192.png`,
   `/icons/icon-512.png` e `/icons/icon-maskable-512.png` respondem; os três PNGs
   decodificam nas dimensões declaradas no manifest — sem isso a PWA não instala.
5. `rtk pnpm check:deployed-css` passa contra produção: todos os marcadores da
   geração atual estão presentes e nenhuma assinatura obsoleta permanece.
6. Com uma PWA que já estava aberta antes do deploy, voltar do segundo plano
   com rede disponível provoca no máximo uma recarga e adota o visual novo sem
   limpar cache nem reinstalar. No aparelho físico, confirmar o piso protetor
   em retrato e, em paisagem baixa de telefone, a ausência da faixa artificial
   de 48px sem perder o inset real informado pelo sistema.
