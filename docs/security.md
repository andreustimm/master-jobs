# Análise de segurança

Revisão de 19/08/2026. Modelo de ameaça real deste sistema, achados com
evidência, e o que foi corrigido.

---

## Modelo de ameaça

Não é um SaaS. É uma aplicação local, de um usuário, sem autenticação, que
guarda o material mais sensível de uma busca de emprego:

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

O que **não** é ameaça relevante hoje: multi-tenancy, escalonamento de
privilégio, exfiltração por invasor remoto. Não há servidor exposto nem
segundo usuário.

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
nasce da sessão em vez de vir da entrada. O modo `single-user` mantém o uso
local sem login, e o guard é o mesmo código nos dois modos — o caminho
multiusuário não é um ramo que ninguém exercita. Ver AUTH-01.

**Fluxo verificado ponta a ponta em 19/08**, com `JHO_AUTH_MODE=multi`: sem
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

Nesta ordem, e nada disso está feito:

1. Autenticação de verdade — hoje qualquer URL pública é acesso total.
2. `TURSO_AUTH_TOKEN` fora do repositório.
3. Escopo por candidato em toda query (a coluna existe; o filtro não é enforçado).
4. Rate limit nas Server Actions.
5. `Strict-Transport-Security` e revisão da CSP sem `unsafe-eval`.

---

## Rotina

```bash
pnpm jho security check   # bind, PII versionada, segredos, permissões do banco
pnpm audit                # dependências
```
