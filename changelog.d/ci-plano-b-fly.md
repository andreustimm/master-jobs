## Técnico

### Adicionado

- Plano B de deploy (Fase 4 da #351, ADR 0030, issue #369): `Dockerfile` multi-stage (`deps` → `builder` → `runner`) para o build `standalone` já declarado em `next.config.ts`, rodando como usuário não-root dedicado (`nextjs`, uid 1101); `.dockerignore` exclui `.env*` e todo diretório operacional do contexto de build.
- `fly.toml` fixa `primary_region = "gru"` (a mais próxima do Supabase de produção, `sa-east-1`) e um health check HTTP contra `/manifest.json` — rota pública sem sessão e sem dependência do banco.
- `.github/workflows/publicar-imagem-fly.yml`, estritamente `workflow_dispatch` (nenhum push, PR ou agendamento aciona): publica a imagem em `ghcr.io/andreustimm/master-jobs`, confere via `docker history --no-trunc` que nenhuma camada carrega um valor com formato de segredo e, só quando o dono marca `deploy: true` no disparo, implanta a imagem publicada no Fly (`environment: production`).
- Exceção documentada de G36/regra 12 (`docs/engineering/rules/security.md#g36`, `AGENTS.md`): o contêiner escuta em todas as interfaces (`ENV HOSTNAME=0.0.0.0`) só dentro da imagem — nunca em `package.json` — porque o proxy de borda do Fly fica fora do namespace de rede do container; `dev`/`start` continuam presos a `127.0.0.1`, travado por `tests/deploy-fly.test.ts`.
- `docs/engineering/deploy.md` ganha a seção "Plano B: Fly.io como destino alternativo", com o runbook de failover de DNS na Cloudflare (ida e volta), a lista de segredos a replicar manualmente (nome, nunca valor) e o encaminhamento da varredura fatiada durante o failover (repontar o `pg_cron` ou aceitar a pausa e deixar `varredura.yml` cobrir por `workflow_dispatch`).

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
