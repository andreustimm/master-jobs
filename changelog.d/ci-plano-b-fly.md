## Técnico

### Adicionado

- Plano B de deploy (Fase 4 da #351, ADR 0030, issue #369): `Dockerfile` multi-stage (`deps` → `builder` → `runner`) para o build `standalone` já declarado em `next.config.ts`, rodando como usuário não-root dedicado (`nextjs`, uid 1101); `.dockerignore` exclui `.env*` e todo diretório operacional do contexto de build.
- `fly.toml` fixa `primary_region = "gru"` (a mais próxima do Supabase de produção, `sa-east-1`) e um health check HTTP contra `/manifest.json` — rota pública sem sessão e sem dependência do banco.
- `.github/workflows/publicar-imagem-fly.yml`, estritamente `workflow_dispatch` (nenhum push, PR ou agendamento aciona): publica a imagem em `ghcr.io/andreustimm/master-jobs`, confere via `docker history --no-trunc` que nenhuma camada carrega um valor com formato de segredo e, só quando o dono marca `deploy: true` no disparo, implanta a imagem publicada no Fly (`environment: production`).
- Exceção documentada de G36/regra 12 (`docs/engineering/rules/security.md#g36`, `AGENTS.md`): o contêiner escuta em todas as interfaces (`ENV HOSTNAME=0.0.0.0`) só dentro da imagem — nunca em `package.json` — porque o proxy de borda do Fly fica fora do namespace de rede do container; `dev`/`start` continuam presos a `127.0.0.1`, travado por `tests/deploy-fly.test.ts`.
- `docs/engineering/deploy.md` ganha a seção "Plano B: Fly.io como destino alternativo", com o runbook de failover de DNS na Cloudflare (ida e volta), a lista de segredos a replicar manualmente (nome, nunca valor), pré-requisitos únicos (`fly apps create`, `FLY_API_TOKEN` no ambiente `production` do GitHub, `_acme-challenge` antecipado) e o encaminhamento da varredura fatiada durante o failover (repontar o `pg_cron` ou aceitar a pausa e deixar `varredura.yml` cobrir por `workflow_dispatch`).

### Corrigido

- CRITICAL (revisão L2 da PR #373): `fly.toml` e o `Dockerfile` declaram `JHO_ENV=production`, para `isLocalProcess()` (`src/contexts/auth/domain/open-mode.ts`) nunca confundir o contêiner do plano B com a máquina do dono — sem isso, `JHO_AUTH_MODE=open` liberaria tudo sem sessão, o mailer de recuperação imprimiria o link no log (G18) e a varredura recusaria por não se reconhecer como produção.
- MAJOR: novo `src/contexts/auth/domain/public-origin.ts` (`resolvePublicOrigin`) substitui o cabeçalho `Host` da requisição, usado até aqui para montar o link de recuperação de senha (`app/login/forgot/actions.ts`, `app/login/reset/actions.ts`) — atrás de qualquer proxy isso é host poisoning (G17/G18). A origem agora vem só de `JHO_PUBLIC_URL`, configurada por deployment; sem ela, fora da máquina do dono, falha fechado. **Vale para a Vercel também**: `JHO_PUBLIC_URL` precisa ser cadastrada lá (Production) antes desta mudança chegar a produção, ou a recuperação de senha para de enviar e-mail.
- MAJOR: `.github/workflows/publicar-imagem-fly.yml` builda a imagem localmente (`load: true`) e inspeciona o sistema de arquivos dela (`docker run … find`/`grep` por segredo) **antes** de qualquer login ou push no GHCR — não só os metadados do `docker history`.
- Minors da mesma revisão: base do `Dockerfile` pinada por digest, `GIT_REVISION` como build-arg para o marcador de versão do PWA (`scripts/sw-version.mjs`) não cair sempre em "sem-revisao", `setup-flyctl` pinado por SHA (nunca `@master`), tag de entrada do workflow validada por allowlist de caracteres via variável de ambiente, `packages: write` só no job que publica, publicação travada em `github.ref == 'refs/heads/main'`, `.dockerignore` espelhando os padrões sensíveis do `.gitignore`, e `Dockerfile`/`fly.toml`/`.dockerignore` classificados como L2 em `.claude/skills/deep-review/scripts/review_level.py`.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
