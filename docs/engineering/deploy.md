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

## Migrar o banco

```bash
turso db create job-hunt-os
turso db tokens create job-hunt-os

export TURSO_DATABASE_URL="libsql://..."
export TURSO_AUTH_TOKEN="..."

pnpm jho db migrate          # cria o schema no banco remoto
node scripts/turso-migrate.mjs --dry-run
node scripts/turso-migrate.mjs
```

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
