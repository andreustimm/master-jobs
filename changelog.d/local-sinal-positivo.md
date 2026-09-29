## Técnico

### Segurança

- `isLocalProcess()` (`src/contexts/auth/domain/open-mode.ts`) passa a exigir sinal positivo de máquina local — `JHO_ENV=local` declarado, sem `VERCEL` nem `VERCEL_ENV` — e nega por omissão (issue #378, G27). Antes, a ausência das três variáveis contava como "máquina do dono": um deployment em que nenhuma chegasse (a Vercel sem as variáveis de sistema expostas, um destino novo que não declara nada) aceitava `JHO_AUTH_MODE=open` (G38), usava o mailer de terminal com o link de recuperação no log (G18) e deixava `resolvePublicOrigin()` montar o link a partir do `Host` do cliente (G17). Os três consumidores herdam a correção sem mudança própria; `VERCEL_ENV` declarado com qualquer valor (inclusive `local`) nunca conta como local.
- Pedido de modo aberto recusado agora avisa uma vez por processo no log do servidor (`[auth] JHO_AUTH_MODE=open ignorado…`), dizendo o que declarar, sem ecoar valor do ambiente (`openModeRefused()` no domínio, aviso em `isOpenMode()`).
- Conveniência local preservada por declaração, não por omissão: `pnpm dev` passa por `scripts/dev.ts`, que declara `JHO_ENV=local` só quando nem o processo nem os `.env*` que o Next carrega em dev declaram `JHO_ENV` (na ordem do Next: `.env.development.local`, `.env.local`, `.env.development`, `.env`) — um `JHO_ENV` do `.env` nunca é sobrescrito. A suíte já declarava em `tests/support/ingestion-env.ts`. Nenhum script do `package.json` embute `JHO_ENV` (`tests/deploy-fly.test.ts`), porque `start` e a CLI também rodam fora do laptop. `pnpm jho` e `pnpm start` locais precisam de `JHO_ENV=local` no `.env` para o modo aberto e o mailer de terminal; `jho auth status` avisa quando o `.env` pede `JHO_AUTH_MODE=open` sem declarar `JHO_ENV` (a CLI recusa, mas o `pnpm dev` abre).
- E2E isolado (`tests/e2e/run-isolated.mjs`): sobe o servidor com `JHO_PUBLIC_URL` apontando para a própria porta. Sem ela, a recuperação de senha cairia em `recordResetSendFailure` para qualquer endereço, e o E2E de G17 compararia dois caminhos idênticos. `tests/e2e/ui/password-reset.mjs` agora confere em `auth_event` que os dois pedidos passaram por `requestPasswordReset` (`reset_requested_unknown` para o endereço inexistente). O `--manual` também declara `JHO_ENV=local`, para o link de recuperação sair no terminal de quem faz o QA; a suíte automática não declara, e o link nunca vai para o log do CI.
- `docs/engineering/deploy.md` ("Dependência silenciosa") e `docs/engineering/rules/security.md` (G17, G38) atualizados: sem as variáveis de sistema da Vercel o efeito passa a ser falha fechada de disponibilidade (a recuperação grava `reset_send_failed`), não a abertura do modo aberto.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
