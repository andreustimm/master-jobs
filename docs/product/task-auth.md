# AUTH-01 · Autenticação e autorização

**Status:** 📋 planejado · criado em 19/08/2026
**Prioridade:** alta — é pré-requisito de qualquer coisa fora do `localhost`

---

## Por que agora

Hoje o dashboard **não tem autenticação nenhuma**. Isso é defensável enquanto
ele roda em `127.0.0.1` para um usuário — uma tela de login contra si mesmo é
teatro. Mas a análise de segurança encontrou o custo real dessa aposta: o
servidor estava fazendo bind em `0.0.0.0` e qualquer pessoa na mesma rede lia
o currículo completo e **alterava o funil**. O bind foi corrigido; a ausência de
autenticação continua sendo o que torna esse tipo de erro catastrófico em vez de
constrangedor.

Três coisas já decididas empurram para cá:

1. **A modelagem já é multi-candidato.** `candidate`, `candidate_document` e
   `candidate_skill` existem com chave por candidato desde a F-02. O escopo por
   candidato **não é enforçado em nenhuma query** — hoje isso não importa porque
   só há uma pessoa; no dia em que houver duas, é vazamento.
2. **Deploy está no roadmap.** Qualquer URL pública sem auth é acesso total.
3. **O catálogo de skills prevê um admin** (persona P4), e "administrado pelo
   admin" só significa algo se existir a noção de quem é admin.

---

## Escopo

### Autenticação — quem é você

- [ ] Sessão por cookie assinado, `httpOnly` + `secure` + `sameSite=lax`
- [ ] Login por e-mail com link mágico (sem senha para guardar, sem senha para
      vazar) **ou** OAuth com um provedor
- [ ] Logout que invalida a sessão no servidor, não só apaga o cookie
- [ ] Rotação de sessão no login, contra fixação
- [ ] Modo `single-user` explícito: quando ligado, o sistema segue como hoje —
      um `.env` diz "sou eu, em loopback" e nada muda para quem roda local

> **Restrição herdada:** o projeto não guarda senha. Se for e-mail, é link
> mágico; se for OAuth, é o provedor. A regra 13 já proíbe chave de API no
> banco, e senha tem o mesmo problema com juros.

### Autorização — o que você pode

- [ ] Papéis: `owner` (o candidato), `admin` (curadoria do catálogo global)
- [ ] **Escopo por candidato enforçado na camada de dados**, não na UI
- [ ] Toda Server Action valida sessão antes de qualquer efeito
- [ ] Rota de admin separada e negada por padrão

> **A parte que importa e costuma ser feita errado:** filtrar por candidato na
> UI é cosmético. Se `boardJobs()` aceita um `candidateId` que o chamador
> escolhe, uma Server Action com o id trocado devolve os dados de outra pessoa.
> O escopo tem que nascer da sessão e atravessar até a query, e é isso que um
> teste de arquitetura precisa garantir.

### Auditoria

- [ ] `auth_event`: login, logout, falha, troca de papel
- [ ] Nunca registrar token, cookie ou chave — regra 13

---

## Como encaixa na arquitetura

Regra 4: **entra por porta.**

```
src/contexts/auth/
  domain/       sessão, papel, decisão de permissão — puro, testável sem banco
  ports.ts      SessionStore · IdentityProvider
  app/          login, logout, autorizar
  infra/        Drizzle + cookie
  index.ts      composição
```

`IdentityProvider` é a porta que absorve variação real: link mágico hoje,
OAuth depois, SSO se um dia virar produto. `SessionStore` é tabela agora,
Redis/Upstash quando houver mais de um processo — o mesmo desenho da ADR 0009.

A **decisão de permissão é função pura**: `can(session, action, resource)`.
É o que permite testar exaustivamente a matriz de papéis sem subir servidor,
e é onde bug de autorização de fato mora.

---

## Critérios de aceite

- [ ] Requisição sem sessão a qualquer rota que não seja login → 401/redirect
- [ ] Server Action sem sessão falha **antes** de qualquer efeito colateral
- [ ] Candidato A não alcança dado de B por nenhum caminho — incluindo id
      forjado em Server Action, e há teste tentando exatamente isso
- [ ] Rodar local em modo single-user continua sem pedir login
- [ ] `jho security check` ganha verificação de auth para deploy
- [ ] Nenhum segredo em log

---

## Fora de escopo

Registro público de usuários, recuperação de senha (não há senha), 2FA,
convites e times. Nada disso tem usuário hoje, e a ADR 0007 rejeita porta e
tabela que existem por antecipação.

---

## Dependência

Bloqueia: deploy, multi-candidato, painel de admin do catálogo.
Não bloqueia: nada do uso local atual.

## Ordem sugerida

1. Contexto `auth/` com domínio puro e `can()` testado
2. `SessionStore` + cookie assinado
3. Guarda nas Server Actions
4. Escopo por candidato na camada de dados, com teste de tentativa de acesso
   cruzado
5. Papel `admin` e rota separada
6. Modo single-user, para o uso local não regredir
