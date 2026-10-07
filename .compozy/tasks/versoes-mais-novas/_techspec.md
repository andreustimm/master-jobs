# Tudo na versão mais nova — #468

Tamanho M, revisão L2 (CI, promoção e deploy). Diretriz do dono (06/10/2026):
SO, linguagens, bibliotecas, frameworks e bancos na versão mais nova, mantidos
assim por automação, com o CI verde como garantia. Quebra se resolve adaptando
o código, nunca rebaixando. A política vigente mora em
[versions.md](../../../docs/engineering/versions.md); esta spec registra o
contrato da entrega.

## Componentes

- **Runner do CI:** etiqueta `ubuntu-NN.04` escrita em todo `runs-on:` e no
  padrão de `CI_RUNS_ON` (`HOSTED_RUNNER` em `tests/support/ci-workflow.ts`);
  nenhuma `ubuntu-latest`. O vigia de cota reverte com
  `gh variable delete CI_RUNS_ON`, sem copiar etiqueta que envelhece.
- **Actions:** `uses:` na última major (SHA só no `flyctl`).
- **Node, pnpm e Python:** Node na maior major que a Vercel aceita, igual em
  `engines.node`, `.nvmrc`, `@types/node` e nas imagens `node:*`; pnpm exato
  em `packageManager`, lido pelo CI, `Dockerfile` e runner, com
  `minimumReleaseAge` declarado em `pnpm-workspace.yaml`; Python em
  `.python-version` com versão completa e na imagem do runner.
- **Dependências:** todas na última, inclusive major, com o código adaptado
  (majors novas: Vitest 5, `@sentry/nextjs` 11, `@sentry/cli` 3, pnpm 12; o
  resto do lockfile na última minor/patch).
- **Imagens:** `Dockerfile` e `scripts/runner/Dockerfile` por tag e digest;
  runner do GitHub por `ARG RUNNER_VERSION` (SHA-256 conferido pelo dono).
- **PostgreSQL:** `config/postgres-majors.json` declara `latest` (mais nova do
  PostgreSQL, bancos descartáveis), `production` (Supabase de produção) e
  `local` (imagem `supabase/postgres` mais nova publicada, a do Compose
  local), na ordem production ≤ local ≤ latest. O job `banco-nas-majors`
  (matriz `production|latest` × 2 fatias) roda todo teste de PostgreSQL real e
  o ensaio de corte em cada major; o check obrigatório `schema-e-migracao`
  depende dele com `always()` e reprova se alguma fatia não passou.
- **Renovate:** `renovate.json` para npm, Actions, runners, Node, pnpm,
  Python, Docker e as versões fora dos gerenciadores padrão (regex). PR para
  `dev`, `chore(deps)`, agrupada, **sem mescla automática**.
- **Gate `pnpm check:versions`:** no `pnpm check` e no job `contratos`;
  reprova etiqueta flutuante, imagem sem tag nem digest, major do Node
  divergente e tag Supabase do Compose fora da major `local`.
- **Sentry 11:** `dataCollection` com toda coleta automática desligada (o
  `sendDefaultPii` deixou de existir), `traceLifecycle: "static"` e
  `beforeSendSpan` marcado por `withStaticSpan`, para as peneiras de
  transação e de span continuarem no caminho; a major instalada fica travada.

## Decisões e limites aceitos

- **Sem automerge.** A issue pedia merge automático com o CI verde; isso
  pularia o revisor (regra 19) e a issue no Project (regra 24). Liberar exige
  exceção decidida pelo dono, registrada como pendência em `versions.md`.
- **Node limitado pela Vercel:** major do Node e do pnpm chega com rótulo
  `confirmar-vercel`, porque o CI não roda o build da Vercel.
- **Produção do Supabase sobe pelo dono**, no painel; até lá o CI prova as
  duas majors.
- **Compose local abaixo de `latest`:** a Supabase não publicou imagem
  `supabase/postgres` na major de `latest` (Docker Hub e
  `ansible/vars.yml` do repositório `supabase/postgres` conferidos em
  06/10/2026). O local fica na mais nova disponível (`local`), e a PR do
  Renovate que trouxer a major nova sobe `local` e revê o bootstrap.
- **Codinome da distribuição Debian** muda à mão; o Renovate só sobe a versão
  dentro da variante.
- **Sem fragmento de changelog:** manutenção `chore(deps)`, sem bump.

## Pendências do dono

Instalar o app do Renovate, decidir o automerge, reaplicar
`supabase/cron/watchdog.sql`, conferir o SHA-256 do runner e subir o Postgres
de produção quando quiser (lista completa em `versions.md`).

Entrega: PR draft para `dev`; revisão L2 e juiz antes de ficar pronta.
