# Proposta: upgrade LTS e paridade de runtime

**Status:** proposta para decomposição em PRD, TechSpec e tarefas Compozy
(`stack-lts-upgrade-and-runtime-parity`). Nenhum upgrade de dependência ou
mudança de produção é feito por este documento.

## Por que agora

O runtime já está em Node 24 e PostgreSQL é o caminho único da aplicação. O
Supabase de produção foi observado em PostgreSQL 17.6.1.166, enquanto a
fixture local agora usa a mesma linha major/minor com a imagem pinada
`supabase/postgres:17.6.1.171`, além de `pgmq` e `vector`. Essa proximidade
reduz diferenças entre migrations, permissões e extensões. O restante da stack
deve ser atualizado com evidência de compatibilidade, em vez de um salto de
versão que misture runtime, framework e banco na mesma mudança.

## Baseline a validar

| Camada | Baseline atual | Alvo da tarefa | Prova |
|---|---|---|---|
| Node | `^24.19.0` no `package.json` | último patch LTS 24 suportado por Vercel e CI | `pnpm check`, build e E2E |
| pnpm | `10.28.0` | último patch 10 compatível com lockfile | instalação `--frozen-lockfile` |
| Next/React | Next 16 / React 19 | patches mais recentes dentro dos majors | build, E2E e QA vivo |
| TypeScript/Drizzle | TS 7 / Drizzle 0.45 | patches compatíveis com type stripping e migrations | typecheck + rehearsal |
| Testes | Vitest 4 / Playwright 1.62 | patches atuais sem alterar contratos | cobertura e browser isolado |
| CSS | Tailwind 4 | patches atuais dentro do major | check visual e mobile |
| PostgreSQL | Supabase 17.6.1.166 | local pinado em 17.6.1.171; confirmar patch remoto antes do corte | migrations + `pgmq`/`vector` smoke |
| CI | actions checkout/setup-node/pnpm atuais | revisar majors e Node 24 explícito | workflows em pull request |

O Node 26 instalado na máquina não vira o runtime do produto automaticamente:
o CI, a Vercel e o `engines` precisam convergir primeiro. O alvo é o último
patch LTS que todos os ambientes suportem, não a versão mais nova disponível
no laptop.

## Plano de execução

1. **Inventário:** capturar versões efetivas (`pnpm outdated`, lockfile,
   workflow, Vercel e PostgreSQL remoto) e separar patch, minor e major.
2. **Runtime e imagem:** fixar Node 24/pnpm 10, confirmar o runtime da Vercel,
   executar migrations duas vezes no Compose PG17 e criar `pgmq`/`vector` em
   volume vazio.
3. **Dependências por família:** atualizar primeiro patches de Next/React,
   TypeScript/Drizzle e ferramentas de teste em PRs pequenos. Qualquer major
   fica em tarefa própria com migração e rollback explícitos.
4. **Gates:** `pnpm check`, `pnpm test:e2e`, `pnpm db:rehearse-production`,
   import de fixture local e smoke de extensões. Mudança de schema segue
   `drizzle-safe-migrations` e pausa a promoção automática quando necessário.
5. **Promoção:** dev → staging automático; staging → main somente por revisão
   humana. Confirmar o patch do Supabase antes da migration de produção e
   manter a imagem anterior documentada para rollback.

## Critérios de aceite

- Uma matriz versionada mostra Node, pnpm, Next, Drizzle, Vitest, Playwright,
  imagem PostgreSQL e extensões em local, CI, Vercel, staging e produção.
- Instalação congelada, typecheck, cobertura, E2E, rehearsal e smoke de
  migrations passam em um clone limpo.
- O banco local aceita `CREATE EXTENSION pgmq` e `CREATE EXTENSION vector` em
  volume novo, e a fixture sanitizada importa sem HTML, tokens ou filas de
  crawler.
- Não há escrita de dados de produção durante a atualização; existe plano de
  rollback para cada imagem/dependência modificada.
- A PR declara explicitamente qualquer `FIX_BEFORE_SHIP` de deep-review e tem
  assignee antes de ser aberta.

## Fora do escopo

Esta tarefa não migra dados, não reativa scraping, não troca o `QueuePort` para
PGMQ, não cria embeddings e não atualiza automaticamente a versão major de
Node, Next ou PostgreSQL. Esses itens só entram depois que o baseline e os
gates acima estiverem verdes.
