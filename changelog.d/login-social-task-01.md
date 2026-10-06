## Técnico

### Adicionado

- Fundação do login social e do cadastro aberto (#464): migração aditiva `0035_login_social` cria `auth_identity` (identidade do provedor por `(provider, subject)`, `ON DELETE cascade`) e `auth_signup` (cadastro pendente, IP só em HMAC, `ON DELETE set null`) e acrescenta seis colunas anuláveis a `auth_user` (e-mail confirmado, versões de termos aceitas, origem do cadastro, idioma).
- Domínio puro em `src/contexts/auth/domain/`: `parseOidcConfig`, `socialAvailable`, `availableProviders`, `issuerFor`, `parseSessionSecret`, `parseSignupLimits`, `mailSinkDir`, `safeNext` e `landingFor`. Desvios de teste (emissor OIDC falso, sink de e-mail) nunca valem em `JHO_ENV=production` nem na Vercel.
- Cookie cifrado do fluxo OIDC (`infra/flow-cookie.ts`, AES-256-GCM com chave HKDF de `JHO_SESSION_SECRET`, validade de 10 minutos).
- Construtores localizados dos e-mails da conta (`app/account-emails.ts`, chaves `email.*`) e `fileMailer`, escolhido por `configuredMailer` só com `JHO_MAIL_SINK` fora de produção.
- Termos de Uso e Política de Privacidade versionados em `content/legal/` (rascunho original, aguardando revisão do dono) e leitor `src/core/legal.ts`.
- `jho db cleanup --apply` (job semanal de manutenção) passa a apagar cadastros pendentes há mais de 24 h e concluídos há mais de 30 dias.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
