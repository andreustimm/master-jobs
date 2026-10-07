## Técnico

### Adicionado

- Login com Google e LinkedIn por OpenID Connect (#464): dependência `oauth4webapi`, porta `OidcProvider` com adapters em `src/contexts/auth/infra/oidc/` (PKCE S256, `state`, `nonce`, assinatura do ID token conferida no JWKS; LinkedIn pede exatamente `openid profile email`, nunca `w_member_social`). Do token sai só sujeito, e-mail e verificação.
- Decisão pura de identidade (`domain/identity-resolution.ts`): identidade ligada entra sem olhar o e-mail; e-mail verificado igual liga sozinho (`origin=automatic`, com aviso por e-mail e `identity_linked`); conflito, conta desabilitada e e-mail não verificado recusam com mensagem neutra, sem criar nada.
- Rotas `GET /login/oauth/[provider]` e `GET /login/oauth/[provider]/callback` (303, origem por `resolvePublicOrigin`, `next` só relativo). O `state` consumido é queimado no servidor (`auth_login_token`, propósito `oidc_flow`): o retorno vale uma vez. As recusas sociais entram na mesma janela de `login_failed` do login por senha.
- E-mail verificado sem conta grava a pendência `auth_signup(kind=social)` (IP só em HMAC com `JHO_SIGNUP_IP_SECRET`, que passa a ser obrigatório para o cadastro) e manda a `/signup`, cuja tela chega na task_03 da #464.
- `/login` mostra os botões só onde o provedor está disponível (ADR-005) e redireciona quem já tem sessão; o proxy passa o endereço pedido como `next`.
- E2E: emissor OIDC falso de loopback (`tests/e2e/fake-oidc.mjs`) no `run-isolated`, que agora declara `JHO_ENV=e2e` com os desvios de teste; área `social-sign-in`.

### Alterado

- Regra 1, G01 e `docs/linkedin-policy.md` permitem OpenID Connect do LinkedIn só para autenticar, sem `w_member_social` e sem dado de perfil (ADR-003).

## pt-BR

### Novidades

- A tela de entrada pode oferecer "Continuar com Google" e "Continuar com LinkedIn" onde o login social estiver ligado. Uma conta existente é reconhecida pelo e-mail que o provedor confirma, e você recebe um aviso por e-mail quando o provedor é ligado.
- Quem já entrou e abre a tela de entrada vai direto para a sua tela.

## en

### What's new

- The sign-in page can offer "Continue with Google" and "Continue with LinkedIn" wherever social sign-in is enabled. An existing account is recognized by the email the provider confirms, and you get an email notice when the provider is linked.
- If you are already signed in, opening the sign-in page takes you straight to your page.
