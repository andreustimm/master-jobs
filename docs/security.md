# Análise de segurança

Revisão de 19/08/2026. Modelo de ameaça real deste sistema, achados com
evidência, e o que foi corrigido.

---

## Modelo de ameaça

Não é um SaaS. É uma aplicação local com autenticação exigida por padrão, que
guarda o material mais sensível de uma busca de emprego. A persistência do
funil e do score ainda assume um candidato por banco (ARCH-001/002), mesmo que
Auth já permita mais de uma conta:

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

O que **não** é ameaça relevante hoje: um invasor remoto alcançando diretamente
um serviço público. O bind continua restrito a loopback. Isolamento entre
candidatos, por outro lado, é dívida P0 antes de qualquer deploy compartilhado.

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

## O que foi verificado e está correto

| Superfície | Situação |
|---|---|
| **SQL injection** | Sem risco. Todo `sql\`\`` interpola coluna do Drizzle ou valor parametrizado. Nenhuma concatenação de string. |
| **XSS** | Sem `dangerouslySetInnerHTML` em lugar nenhum. Descrição de vaga é renderizada como texto, nunca como HTML — e ela vem de terceiro. |
| **SSRF** | `jho jobs add <url>` só busca URL que casa com um ATS conhecido (`detectJobUrl`). URL arbitrária não é buscada: vira registro manual. |
| **Segredos** | `.gitignore` cobre `.env*`, `*.token.json`, `.linkedin-session.json`, `data/` e `out/`. Nenhum segredo versionado. |
| **Banco** | `data/` ignorado. O histórico de candidaturas nunca vai para o Git. |
| **Timeout de rede** | Todo fetch tem `AbortSignal` com timeout. Fonte lenta não trava o sync. |
| **Upload de PDF** | Teto de 10 MB, e o texto extraído é tratado como texto — nunca executado nem renderizado como HTML. |
| **Escrita no funil** | Caminho único (`setApplicationStatus`), garantido por teste de arquitetura. Ingestão não escreve decisão. |
| **LinkedIn** | Nenhum código lê `li_at` nem dirige sessão autenticada. ADR 0001. |

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

**Sem criptografia em repouso.** O banco é um arquivo SQLite legível por
qualquer processo do usuário. Quem tem acesso local à conta já tem acesso a
tudo; criptografar aqui protegeria contra roubo do disco, o que o FileVault já
faz melhor.

---

## Se um dia isto for para a Vercel

Nesta ordem; autenticação e guards já existem, os itens abaixo não:

1. ARCH-001/002: `candidateId` no funil e no score, com queries escopadas.
2. `TURSO_AUTH_TOKEN` fora do repositório e rotação operacional.
3. TLS, cookies `secure` e política de origem do ambiente publicado.
4. Rate limit distribuído nas Server Actions sensíveis.
5. `Strict-Transport-Security` e revisão da CSP sem `unsafe-eval`.

---

## Rotina

```bash
pnpm jho security check   # bind, PII versionada, segredos, permissões do banco
pnpm audit                # dependências
```
