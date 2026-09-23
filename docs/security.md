# Análise de segurança

Revisão de 19/08/2026. Modelo de ameaça real deste sistema, achados com
evidência, e o que foi corrigido.

---

## Modelo de ameaça

Não é um SaaS aberto ao público, mas também não é mais só local. Roda em dois
modelos, os dois com autenticação exigida por omissão:

- **Local:** CLI e dashboard em `127.0.0.1`, PostgreSQL em Docker. O bind em
  loopback é defesa em profundidade da máquina, não a única barreira.
- **Hospedado:** `jobs.mastertimm.com.br` na Vercel, com PostgreSQL do Supabase
  (schema `production`); `dev` e `staging` usam só dados sintéticos, atrás do
  SSO da Vercel. Detalhes em [`engineering/deploy.md`](engineering/deploy.md).

As regras normativas deste domínio estão em
[`engineering/rules/security.md`](engineering/rules/security.md); este documento
guarda o modelo de ameaça, os achados e sua história. O sistema guarda o
material mais sensível de uma busca de emprego:

| Ativo | Por que importa |
|---|---|
| CV completo | Nome, telefone, e-mail, histórico profissional |
| Funil de candidaturas | Onde a pessoa se candidatou e foi rejeitada |
| `profile.yaml` | Piso salarial, alvo, e o que aceita |
| Conta do LinkedIn | Principal ativo de posicionamento |

**O adversário plausível não é um invasor remoto sofisticado.** São três
cenários mundanos:

1. Alguém na mesma rede — coworking, café, Wi-Fi de casa compartilhado.
2. O repositório virando público com dado pessoal dentro.
3. Um empregador correlacionando candidaturas por vazamento de referrer.
4. Cookie forjado/revogado ou papel administrativo alcançando CV e funil.

Com a implantação hospedada, um visitante remoto alcança o serviço público: a
defesa é a autenticação por omissão, a guarda em toda entrada, a lista de
permissão do perfil público e o isolamento por candidato no escopo da sessão
(ver [`engineering/rules/security.md`](engineering/rules/security.md)). O bind
em loopback continua valendo para os scripts locais.

---

## Achado 1 — Dashboard exposto na rede local 🔴 **corrigido**

**O mais sério, e era explorável.** `next dev` faz bind em `0.0.0.0` por
padrão. Confirmado em execução:

```
$ lsof -nP -iTCP -sTCP:LISTEN | grep 3000
node  12663 andreus  13u  IPv6  TCP *:3000 (LISTEN)      ← todas as interfaces

$ curl http://192.168.50.170:3000/candidate
200 · ANDREUS JARTA TIMM · andreus.timm@gmail · 98827-1204
```

Qualquer pessoa na mesma rede lia o CV inteiro. E como as Server Actions não
têm autenticação, também **alterava o funil** — o único dado do sistema que um
novo sync não reconstrói.

**Correção:** bind explícito em loopback.

```json
"dev":   "next dev --turbopack --hostname 127.0.0.1",
"start": "next start --hostname 127.0.0.1"
```

**Verificado:** `127.0.0.1:3000` responde 200; `192.168.50.170:3000` é
recusado. Travado por teste de regressão em `tests/security.test.ts` — um
`--hostname` removido por engano volta vermelho.

---

## Achado 2 — Sem cabeçalhos de segurança 🟡 **corrigido**

Nenhum cabeçalho definido. Sem CSP, o dashboard podia ser embutido em iframe, e
um `Referer` completo era enviado ao clicar numa vaga — o empregador via o
caminho da página de origem.

> **Correção posterior, 19/08:** a CSP escrita aqui bloqueava o Google Fonts —
> `style-src` sem `fonts.googleapis.com` e `font-src` sem `fonts.gstatic.com`.
> A fonte do DESIGN.md nunca carregava e a aplicação inteira caía no fallback
> do sistema, sem nenhum sinal fora do console do navegador. As duas origens
> foram liberadas. Lição registrada: **CSP quebra em silêncio** — só um browser
> de verdade reporta, e é por isso que `pnpm test:e2e` existe.

**Correção:** `next.config.ts` passa a definir CSP, `X-Frame-Options: DENY`,
`nosniff`, `Referrer-Policy: no-referrer` e `Permissions-Policy`. O
`form-action 'self'` é o que impede um formulário injetado de postar o CV para
fora. É defesa em profundidade: o controle real é o bind, mas estes cabeçalhos
são a camada que sobrevive a alguém publicar isto num servidor.

---

## Achado 3 — esbuild vulnerável via drizzle-kit 🟡 **corrigido**

`GHSA-67mh-4wv8-2f99` (moderado): esbuild ≤0.24.2 permite que qualquer site
converse com o dev server do esbuild e leia a resposta. Chegava por
`drizzle-kit > @esbuild-kit/esm-loader`, apenas em desenvolvimento.

**Correção:** override para `>=0.25.0`. `pnpm audit` agora limpo.

---

## Achado 4 — PII versionada em `profile.yaml` 🟠 **aceito, com trava**

`profile/profile.yaml` está sob versionamento e contém telefone e e-mail
pessoal. Hoje o repositório é local e privado, então o risco é nulo.

**Vira crítico no minuto em que houver repositório remoto** — e isso está no
plano, para registrar `mvp` como submódulo. Git não esquece: publicar e depois
remover não resolve, o dado fica no histórico.

**Ação antes de publicar** (não executada, porque publicar é decisão do
usuário): mover contato para `.env`, ou tornar o repositório privado de forma
deliberada e documentada. `jho security check` avisa.

---

## Achado 5 — Conta convidada com o candidato do dono 🔴 **corrigido (hotfix)**

Em produção, a conta `auth_user` 3 apontava para o candidato 1 (`default`, o do
dono). Qualquer sessão dela — login direto ou admin assumindo a identidade —
abria `/candidate`, `/candidate/skills`, `/candidate/vocabulary`, trilhas,
buscas, funil e exportação com os dados do dono, e as ações de escrita
(visibilidade, versões de CV, skills, trilhas, funil) os alteravam. Não havia
fallback no código de leitura: a sessão confiava em `auth_user.candidate_id`, e
nada impedia duas contas de apontarem para o mesmo candidato.

Três caminhos gravavam esse vínculo:

- `tests/e2e/setup.mjs` roda `seedOwner({ email: E2E_EMAIL, force: true })`
  sem conferir o banco. Rodado fora do banco isolado, com `E2E_EMAIL` real,
  ligava a conta ao candidato `default` e redefinia a senha a cada execução —
  e `ui.mjs` trocava a visibilidade e salvava versões de CV nesse candidato.
- `seedOwner` com um e-mail diferente do dono fazia o mesmo.
- `jho auth add-user` com o papel `candidate` (o padrão) usava
  `syncCandidateFromProfile()` — o candidato do dono — e aceitava
  `--candidate <id>`.

A correção:

- **Leitura:** um candidato pertence à conta **mais antiga** que aponta para
  ele (`ownedCandidateId` em `src/contexts/auth/infra/drizzle-store.ts`). As
  posteriores recebem `candidateId = null` nos três caminhos que montam
  identidade — sessão, senha e link —, e `candidateScope` nega (403). Vale para
  o dado já gravado, sem migração.
- **Escrita:** `claimOwnCandidate` (`src/contexts/auth/app/accounts.ts`) é o
  único caminho de candidato para conta nova, na CLI e em `/admin/users`, e
  sempre cria candidato novo: nunca reaproveita slug existente, nem o de conta
  apagada, cujo currículo continua lá. `add-user` só dá o candidato do perfil à
  primeira conta da instalação (tabela vazia), nunca troca
  vínculo gravado e perdeu
  `--candidate`. `seedOwner` recusa um segundo e-mail sobre o candidato do dono.
- **E2E:** `tests/e2e/database-guard.mjs` recusa o setup se qualquer URL de
  banco que `src/core/db/config.ts` consulta (`DATABASE_URL`,
  `DATABASE_MIGRATION_URL`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`) sair do
  loopback, e `E2E_EMAIL` que não seja `@local.test`.
- **Estrutural:** a migration `0009` cria o índice único parcial
  `auth_user_candidate_idx`.
- **Dono do perfil:** `isOwner` passou a ser o candidato padrão de slug
  `default` (o de menor id só desempata instalação sem ele).
  `ensureCandidate` marcava `is_default` em todo candidato que criava, e o
  convidado de `/admin/users` era pontuado com o `profile.yaml` do dono.

**Ordem em produção.** A migração é manual (`migrate.yml`) e falha se houver
duplicata. Antes de aplicá-la, a consulta abaixo precisa voltar vazia:

```sql
select candidate_id, count(*) from production.auth_user
where candidate_id is not null group by candidate_id having count(*) > 1;
```

A limpeza segue a mesma regra da leitura — o candidato fica com a conta de
menor id, e as posteriores perdem o vínculo:

```sql
update production.auth_user u set candidate_id = null
where candidate_id is not null
  and exists (select 1 from production.auth_user e
              where e.candidate_id = u.candidate_id and e.id < u.id);
```

Enquanto a conta errada resolvia para o candidato do dono, ela podia vincular
recrutadores a ele. Confira também os vínculos e remova os que o dono não criou:

```sql
select id, recruiter_user_id, created_by, created_at
from production.recruiter_candidate
where candidate_id = (select id from production.candidate where slug = 'default');
```

O deploy do código pode vir antes da limpeza: a leitura já nega o candidato às
contas posteriores. Depois da limpeza, `jho auth add-user <email> --role
candidate` dá à conta desvinculada um candidato próprio.

---

## O que foi verificado e está correto

| Superfície | Situação |
|---|---|
| **SQL injection** | Sem risco. Todo `sql\`\`` interpola coluna do Drizzle ou valor parametrizado. Nenhuma concatenação de string. |
| **XSS** | Sem `dangerouslySetInnerHTML` em lugar nenhum. Descrição de vaga é renderizada como texto, nunca como HTML — e ela vem de terceiro. |
| **SSRF** | `jho jobs add <url>` só busca URL que casa com um ATS conhecido (`detectJobUrl`). URL arbitrária não é buscada: vira registro manual. Toda URL de vaga buscada passa por `safeRemoteFetch`, que recusa rede privada, DNS misto e redirect para qualquer um dos dois. |
| **Segredos** | `.gitignore` cobre `.env*`, `*.token.json`, `.linkedin-session.json`, `data/` e `out/`. Nenhum segredo versionado. |
| **Banco** | `data/` ignorado. O histórico de candidaturas nunca vai para o Git. |
| **Timeout de rede** | Todo fetch tem `AbortSignal` com timeout. Fonte lenta não trava o sync. |
| **Upload de PDF** | Teto de 10 MB, e o texto extraído é tratado como texto — nunca executado nem renderizado como HTML. |
| **Escrita no funil** | Caminho único (`setApplicationStatus`), garantido por teste de arquitetura. Ingestão não escreve decisão. |
| **LinkedIn** | Nenhum código lê `li_at` nem dirige sessão autenticada. ADR 0001. O transporte de URL de vaga recusa o domínio do LinkedIn em cada salto de redirect, antes do DNS — ver `docs/linkedin-policy.md` §5.1. |
| **Sentry (erro e trace)** | Única saída de dado para terceiro por padrão, e só do servidor. Erro, transação e span passam por peneiras puras de lista de permissão (`scrubEvent`, `scrubTransaction`, `scrubSpan` em `src/core/observability.ts`): sem query string, cookie, IP, corpo, usuário nem texto de SQL. A organização no Sentry tem a limpeza do lado do servidor **desligada** (`dataScrubber: false`, `scrubIPAddresses: false`), então essas peneiras são a única defesa — teste que as remove reprova. Detalhe em `docs/engineering/deploy.md#relato-de-erro`. |

---

## Minha conta (`/account`) — o que a própria conta muda

A tela existe para qualquer papel e age sempre sobre `session.userId`; nenhum
id vem da URL nem do formulário (`account:read` para ver, `account:write` para
mudar, em `src/contexts/auth/domain/policy.ts`).

- **Trocar a senha exige a senha atual.** Sem ela, um cookie roubado viraria
  posse permanente da conta. Conta que entra só por link não define a primeira
  senha por aqui — usa a recuperação.
- **Limite de tentativas: 5 por conta em 15 minutos**, certas ou erradas. A
  tentativa é gravada em `auth_event` (`password_change_attempt`) ANTES de ser
  contada, então uma rajada concorrente não passa junta pelo limite. Senha nova
  fraca e confirmação diferente não consomem tentativa.
- **Hash gravado ilegível nega**, pelo mesmo `verifyPassword` do login.
- **Trocar derruba TODAS as sessões da conta**, inclusive a de quem pediu, e
  abre uma sessão nova para esse navegador. Na prática "as outras caem e eu
  continuo dentro", e um cookie copiado antes da troca também morre. Fica
  registrado `password_changed` com o número de sessões encerradas.
- **Sessão emprestada não escreve na conta do alvo** — nem senha, nem nome,
  mesmo quando o alvo é admin. A política nega `account:write` por
  `impersonatedBy !== null` antes de olhar papel, e a composição
  (`changePasswordForSession`, `renameForSession`) nega de novo. A tela abre
  para leitura, sem formulário.
- **Nome de exibição** é editável e registra `profile_updated`.

**Decisão: troca de e-mail fica só com admin (`/admin/users`).** O e-mail é o
login e o destino da recuperação de senha. Trocá-lo pela própria sessão sem
confirmar a posse do endereço novo deixaria quem roubou uma sessão desviar a
recuperação para si e tomar a conta de vez. A confirmação por e-mail depende do
Resend ativo em produção (#237), que ainda é pendência do dono; quando existir,
a troca pela própria conta pode entrar com link de confirmação enviado ao
endereço NOVO e aviso ao antigo.

---

## Riscos aceitos conscientemente

**Autenticação exigida por omissão** — ✅ **19/08.** O padrão era `single-user`,
que sintetizava uma sessão e deixava currículo, funil e o export CSV inteiro
acessíveis a qualquer requisição que alcançasse o servidor. Invertido: nada
responde sem sessão, e o modo aberto precisa ser pedido com
`JHO_AUTH_MODE=open`. Verificado: `/`, `/jobs`, `/candidate`, `/pipeline`,
`/referrals` e `/api/export` respondem 307 para `/login` sem sessão.

**Server Actions sem autenticação** — ✅ **resolvido em 19/08.** Toda Server
Action passa por `guard(...)` antes de qualquer efeito, e o escopo por candidato
nasce da sessão em vez de vir da entrada. O modo aberto é somente opt-in por
`JHO_AUTH_MODE=open`; o guard permanece no mesmo caminho. Ver AUTH-01.

**Toda entrada tem política, e a desconhecida reprova** — ✅ **22/09 (#197).**
O teste de autorização lia só arquivos `*actions.ts` e `export async function`;
`logoutAction` ficava de fora pelo nome do arquivo. O inventário em
`tests/support/entry-inventory.ts` descobre pela semântica do Next: toda
`page.*` e `route.*` sob `app/`, cada método HTTP exportado, todo export de
módulo com a diretiva `"use server"` em qualquer forma (`export const`,
`export { a as b }`, `export default`) e diretiva inline. Cada uma precisa de
política em `tests/architecture.test.ts` — o guarda literal da página, o
guarda como PRIMEIRO `await` da action sem efeito antes dele, ou uma exceção
registrada com justificativa. Exceção órfã também reprova.

As exceções, e o que substitui a sessão em cada uma:

| Entrada | O que protege |
|---|---|
| `passwordLoginAction` | limite de tentativas e resposta idêntica para conta inexistente |
| `requestResetAction`, `submitResetAction` | resposta uniforme; token de uso único queimado antes de gravar |
| `logoutAction`, `stopImpersonatingAction` | só revogam/restauram o que está no próprio cookie |
| `setLocaleAction`, `setAppearanceAction` | preferência de interface em cookie próprio, sem dado de ninguém |
| `/login`, `/login/forgot`, `/login/reset` | pré-sessão; `/login` só pergunta se existe alguma conta |
| `/login/callback` | link mágico de uso único |
| `/api/cron/recheck` | `CRON_SECRET` em tempo constante; 503 sem ele |
| `/p/[slug]` | lista de permissão de `publicProfile()`, 404 para não público, limite por IP |

`tests/entry-denial.test.ts` prova a NEGAÇÃO, não só a presença: chama cada
action descoberta com o `app/auth.ts` real contra PostgreSQL de teste, sem
cookie, com cookie forjado, sessão expirada, revogada e conta desabilitada, e
exige recusa sem nenhuma escrita no banco, cookie, revalidação, `after()` ou
rede. Também chama tudo com ids da vítima numa sessão válida de outro
candidato e de um recrutador vinculado, e as ações de administração com sessão
emprestada — o dado da vítima fica idêntico byte a byte.

O limite é declarado: a descoberta é léxica, sem compilador, e nas páginas o
inventário prova a PRESENÇA do guarda; a ordem das leituras de página é
coberta pelos cenários por papel de `pnpm test:e2e`.

**Modo aberto só na máquina local** — ✅ **22/09 (#197).** A proibição de
`JHO_AUTH_MODE=open` em produção era só documental; agora é do código.
`openModeActive()` (`src/contexts/auth/domain/open-mode.ts`) exige o pedido E
um ambiente local: nenhum `VERCEL`, e `JHO_ENV` e `VERCEL_ENV` ausentes ou
iguais a `local` — as duas são conferidas, sem precedência. Produção, preview, staging, dev e valor
desconhecido ignoram o pedido e continuam exigindo login. Sessão e `proxy.ts`
chamam a mesma função; nenhum outro arquivo lê a variável.

**O consentimento do CV não publica o que nunca sai** — ✅ **22/09 (#197).**
`publicProfile()` passa o texto por `publicCvText()` (`src/core/public-cv.ts`):
e-mail (o cadastrado e qualquer endereço), telefone com código de país ou DDD
entre parênteses e o bloco inteiro (parágrafo, item ou tabela entre linhas em
branco; a seção, quando é título) que traz rótulo de pretensão salarial ou
palavra de remuneração perto de um valor são retirados.
Detecção por padrão, com limite escrito no arquivo e travado em teste: valor
sem rótulo e telefone sem marca passam. Não é sanitização perfeita.

**Fluxo verificado ponta a ponta em 19/08**, no modo autenticado padrão: sem
sessão o cabeçalho oferece entrar; o link de uso único resgata em
`/login/callback` e grava o cookie `httpOnly`; a sessão passa a aparecer no
cabeçalho; **o mesmo link recusa o segundo uso**; e o logout revoga no servidor,
deixando o cookie antigo inválido.

**Conta nova cria o próprio candidato** — ✅ **22/09 (#234).** Depois do
incidente em que uma conta de seed apontava para o candidato do dono, contas de
papel candidato sem candidato recebiam 403 em `/candidate` e não tinham saída.
Agora elas veem "Criar meu perfil". A ação `candidate:create` só passa para
papel candidato, sem candidato, com sessão própria — sessão emprestada é negada,
porque criar o perfil é decisão da pessoa, não do admin que assume a
identidade. O formulário não carrega id nenhum: a conta é a da sessão e o
candidato é sempre uma linha nova, privada, com a identidade digitada — nunca a
do `profile.yaml`. As demais páginas de candidato continuam negando 403 para
quem não tem candidato.

**Endereço público escolhido pelo candidato** — ✅ **22/09 (#235).** `/p/`
lê `public_slug`, nunca o `slug` interno, e continua passando por
`publicProfile()` — lista de permissão, 404 para perfil não público em qualquer
endereço. Trocar o endereço faz o antigo responder 404 sem redirecionar (ADR
0024): redirecionar contaria a quem guardou o link antigo qual é o novo.
Reservados cobrem toda rota de primeiro nível do app e os prefixos que o
cadastro pelo admin (`user-`) e o setup do e2e (`e2e-`) reaproveitam pelo slug.
Candidato de slug `user-<e-mail>` nasce sem endereço público: copiar o slug
publicaria o e-mail.

**O e-mail não é nome público** — ✅ **22/09 (QA da 1.22.0).** `jho auth
add-user` gravava o e-mail como nome do candidato, e `/p/<endereço>` o
publicava como título assim que o perfil ficava Público. A lista de permissão
escolhia colunas, e `name` é coluna permitida. Três camadas agora: a CLI dá o
nome de exibição da conta ou nenhum; `publicProfile()` confere o valor de nome,
headline, localização e links por `containsContact()` e esvazia o que traz
e-mail ou telefone, venha de onde vier; e a pessoa edita o nome em `/candidate`.
A migração `0014` limpa os nomes já gravados. Detecção por padrão, com o mesmo
limite declarado de `publicCvText()`, mais sequência de dez dígitos.

**Sem criptografia em repouso feita por este código.** Localmente, o
PostgreSQL em Docker é legível por quem tem acesso à conta da máquina;
criptografar aqui protegeria contra roubo do disco, o que o FileVault já faz
melhor. Em produção, o armazenamento é do Supabase, e a criptografia em repouso
é responsabilidade do provedor, não deste repositório.

---

## Implantação hospedada: o que já vale e o que falta

A lista abaixo substitui o antigo "Se um dia isto for para a Vercel", escrito
quando o banco ainda era SQLite/Turso. O que ela previa, na situação de hoje:

1. **Escopo por candidato** no funil e no score: `application.candidate_id` é
   obrigatório e o escopo nasce da sessão (ver `data-model.md` e a regra 15).
2. **Credencial do banco fora do repositório:** variáveis Sensitive na Vercel;
   o antigo `TURSO_AUTH_TOKEN` não se aplica mais.
3. **Cookies de sessão** `httpOnly`, `sameSite=lax` e `secure` em produção;
   TLS do banco por lista de permissão de `sslmode`.
4. **Rate limit distribuído: pendente.** O limitador é em memória e vale por
   instância na Vercel ([`engineering/deploy.md`](engineering/deploy.md), "O
   limite de requisição vira por instância").
5. **CSP:** produção já não usa `unsafe-eval`; `Strict-Transport-Security`
   explícito no `next.config.ts` continua pendente de revisão.
6. **Proteção remota: aplicada em `main`/Production, parcial em `dev`/`staging`**
   (issue [#196](https://github.com/andreustimm/master-jobs/issues/196), desde
   22/09/2026). `dev` e `staging` recusam exclusão e force-push, mas ainda não
   exigem PR nem CI no remoto — ver
   [`engineering/github-protections.md`](engineering/github-protections.md).

---

## Rotina

```bash
pnpm jho security check   # bind, PII versionada, segredos, permissões do banco
pnpm audit                # dependências
```
