## Técnico

### Adicionado

- Formas de entrar da conta (#464, task_04): `domain/methods.ts` (puro: `canDisconnect`, `methodsView`), serviço `app/account-methods.ts` (listar, desligar provedor, primeira senha, aviso por e-mail) e store em `infra/drizzle-identities.ts`. Desligar confere o último método numa transação com `auth_user` travada (`FOR UPDATE`): dois desligamentos simultâneos não deixam a conta sem porta.
- Ação `account:manage-methods` na política: ligar/desligar provedor e definir a primeira senha da própria conta; nega sessão emprestada. O início do vínculo (`intent=link`) passa a exigi-la.
- `/account`: lista senha, Google e LinkedIn com data de vínculo, último uso, origem e "não disponível aqui"; conectar (GET `/login/oauth/<provedor>?intent=link`), desligar com o aviso de religação, primeira senha para conta sem senha e as versões dos termos aceitos. Server Actions `disconnectProviderAction` e `setOwnPasswordAction`, com `guard` antes de qualquer efeito.
- `/admin/users`: provedores e senha por conta e `adminDisconnectProviderAction` (`user:manage`), com a mesma proteção do último método; o evento `identity_unlinked` nomeia o admin. Não há caminho para ligar provedor em conta alheia.
- CLI: `jho auth methods <email>` e `jho auth unlink <email> <provider>` (sem `link`).
- Aviso por e-mail em todo vínculo e desvínculo (automático, manual, admin, CLI); falha vira `email_send_failed` (`provider_linked`/`provider_unlinked`).
- E2E: área `account-methods` (E2E-016 a E2E-021, 375 px) e E2E-030 na área `password-reset`, lendo o link do sink de e-mail.

### Alterado

- A recuperação de senha usa o construtor localizado `recoveryEmail`, no idioma da conta ou, sem ele, no da tela do pedido; G17/G18 seguem iguais.

## pt-BR

### Novidades

- Em Minha conta, a seção "Formas de entrar" mostra se a conta tem senha e se o Google e o LinkedIn estão ligados, com a data do vínculo e do último uso. Dá para conectar ou desligar cada provedor; a última forma de entrar nunca pode ser desligada.
- Conta que entra só pelo Google ou pelo LinkedIn pode definir uma senha na própria tela da conta.
- Você recebe um e-mail sempre que um provedor é ligado ou desligado da sua conta.
- O e-mail de recuperação de senha chega no seu idioma.

## en

### What's new

- In My account, the "Sign-in methods" section shows whether the account has a password and whether Google and LinkedIn are connected, with the connection and last-use dates. You can connect or disconnect each provider; the last way to sign in can never be removed.
- An account that signs in only with Google or LinkedIn can set a password on the account page.
- You get an email whenever a provider is connected to or disconnected from your account.
- The password-recovery email arrives in your language.
