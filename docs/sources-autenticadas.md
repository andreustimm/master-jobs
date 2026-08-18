# Fontes autenticadas

Todas as 12 fontes do `config/sources.yaml` são públicas e sem autenticação.
Este documento cobre a categoria que **não** cabe lá: plataformas onde as vagas
só existem dentro da área logada do candidato.

> **Invariante:** nenhuma fonte autenticada vira adapter automático sem uma ADR
> própria avaliando termos de uso e risco de conta, do mesmo modo que a
> [ADR 0001](adr/0001-nao-fazer-scraping-do-linkedin.md) fez com o LinkedIn.

---

## Revelo — investigado em 2026-08-18

Andreus já trabalhou via Revelo (MPC — Mobile Price Card, EUA), então tem conta
ativa. URL das vagas:
`https://app.careers.revelo.com/#/international/positions/<uuid>`

### O que a investigação encontrou

| Item | Resultado |
|---|---|
| Tipo de página | SPA Vue com hash routing — o HTML inicial não contém vaga alguma |
| Base da API | `https://api.careers.revelo.com/central_candidates_frontend` |
| `/international/positions` | **HTTP 401** |
| Autenticação | Keycloak SSO em `sso.revelo.com/auth/` (o bundle usa `tokenParsed`, padrão do `keycloak-js`) |
| Onde o token vive | Em memória. O `localStorage` guarda apenas chaves do Google Tag Manager |

Rotas extraídas do bundle `app.3eef534e.js`:

```
positions/${id}
positions/${id}/apply
positions/applied
positions/recommended
```

### O que isso significa

`recommended` e `applied` deixam claro que **não é um job board** — é um feed
personalizado por candidato. Duas consequências:

1. **Não existe adapter público possível.** Não é uma questão de achar o
   endpoint certo; o conteúdo não existe fora da sessão autenticada.
2. **Não há credencial reutilizável.** O token é JWT de sessão obtido via SSO e
   mantido em memória. Não há cookie de longa duração para um cliente headless
   reaproveitar — e persistir credencial de SSO seria exatamente o tipo de
   decisão que a ADR 0001 recusou.

### Como importar hoje

`jho jobs import` existe exatamente para isto. Você autentica, copia o payload
que a própria página já buscou, e o sistema faz o resto:

1. Abra a área de vagas da Revelo logado.
2. DevTools (F12) → aba **Network** → filtre por `central_candidates_frontend`.
3. Recarregue a página. Clique na requisição de `positions` → **Response** →
   botão direito → *Copy response*.
4. Salve num arquivo, por exemplo `~/revelo.json`.

```bash
# confira o que foi reconhecido antes de gravar
pnpm jho jobs import ~/revelo.json \
  --source revelo --label "Revelo (international)" \
  --base-url "https://app.careers.revelo.com/#/international/positions" \
  --dry-run

# grave
pnpm jho jobs import ~/revelo.json --source revelo --label "Revelo (international)" \
  --base-url "https://app.careers.revelo.com/#/international/positions"
```

O parser não assume o formato da Revelo. Procura os nomes de campo que essas
APIs de fato usam (`title`/`name`/`position`, `company`/`employer`, objetos
aninhados como `{ company: { name } }`), aceita camelCase e snake_case, e ao
final **lista os campos que não soube mapear** — se aparecerem coisas úteis como
`englishLevel` ou `seniorityLevel`, é sinal de que vale estender o mapeamento.

A fonte é criada **desabilitada**: `jobs sync` nunca vai tentar buscá-la, porque
não há nada público para buscar.

Validado ponta a ponta com um payload no formato da Revelo: uma vaga
"Remote - LATAM" a USD 13.000/mês pontuou 78,8 no cluster `architect`,
reconhecendo o período mensal; uma "Remote - US" recebeu bloqueio automático
de *Local work authorization required*.

### Por que não automatizamos o navegador

### Caminho recomendado: leitura assistida

O mesmo padrão da fila de engajamento do LinkedIn — o humano autentica, o agente
lê o que a página já carregou:

1. Andreus abre a área da Revelo na sessão dele, já logado.
2. O agente usa a extensão do Chrome (`mcp__claude-in-chrome__*`) para ler a
   resposta da API que a própria página buscou, via `read_network_requests`
   filtrando por `central_candidates_frontend`.
3. As vagas entram pelo caminho manual que já existe: `jho jobs add <url>`,
   com `--company` e `--description`.

O que isso **não** faz, deliberadamente: não guarda token, não automatiza login,
não roda sem o humano presente, e não se candidata.

### Ainda em aberto

Os termos de uso da Revelo ([revelo.com.br/termos-de-uso](https://www.revelo.com.br/termos-de-uso),
[rvlo.vc/termos](https://rvlo.vc/termos)) cobrem cadastro, conta única e coleta
de dados, mas **não encontrei cláusula explícita sobre automação ou scraping**.
Ausência de proibição não é permissão: antes de qualquer coisa além de leitura
assistida, ler os termos na íntegra e registrar a decisão numa ADR.

---

## Outras plataformas na mesma categoria

Investigadas de forma rasa; nenhuma tem adapter e nenhuma deve ganhar um sem
o mesmo escrutínio.

| Plataforma | Situação |
|---|---|
| LinkedIn | Coberto pela [ADR 0001](adr/0001-nao-fazer-scraping-do-linkedin.md). Job alerts por e-mail são o caminho legítimo — ver `docs/product/backlog.md`, item F-01a |
| BairesDev | `applicants.bairesdev.com/openings` exige login. Andreus já passou por 26 processos por lá; o mapeamento de clientes está em `LinkedIn/vagas_agosto_2026.md` |
| Toptal, Turing, Andela, A.Team | Marketplaces com área logada. Nenhum avaliado ainda |
| Workday, Gem, Loxo | Aparecem no acervo como hosts não coletáveis; `detect.ts` os reconhece e avisa em vez de falhar em silêncio |
