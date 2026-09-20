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
| Toptal, Andela, A.Team, Arc.dev, Lemon.io, Gun.io | Marketplaces com área logada. Nenhum avaliado a fundo; entram como vitrine, não como fonte |
| Turing | Board próprio no Greenhouse, público — cadastrada em `config/sources.yaml`. São as vagas do time interno, não os contratos do marketplace |
| Workday, Gem, Loxo | Aparecem no acervo como hosts não coletáveis; `detect.ts` os reconhece e avisa em vez de falhar em silêncio |

---

## Vitrines de outsourcing e staff augmentation — sondado em 2026-09-20

Andreus já trabalhou por três delas (Revelo, BairesDev, WillDom), e essa
categoria funciona ao contrário do resto do acervo. Elas vendem time nearshore
para empresa americana; para o candidato, o produto é o **perfil**: cadastra
uma vez, passa pela avaliação, e a demanda chega. Em vez de candidatar-se a
cada vaga, a candidatura é o cadastro — o que muda o que este sistema tem a
fazer por elas.

### O que a sondagem encontrou

Treze plataformas testadas contra os ATS que já sabemos ler — Greenhouse, Lever
e Ashby — mais leitura do HTML das páginas de carreira:

| Resultado | Plataformas |
|---|---|
| Board público legível | **Turing** (Greenhouse, 21 vagas — time interno, maioria presencial nos EUA) |
| Página de carreira é SPA, sem assinatura de ATS no HTML | Jobsity, TECLA, BEON.tech, Nearsure, VanHack, Strider, Talently, Index.dev, BairesDev |
| Recusa requisição que não é navegador | Howdy (429), WillDom (403) |
| Exige login para ver vaga | Revelo (documentado acima), BairesDev |

Conclusão sem rodeio: **não há adapter a escrever aqui.** Onde a listagem não é
pública, ingerir exigiria dirigir sessão autenticada — o que a invariante deste
documento proíbe sem ADR própria, pelas mesmas razões da
[ADR 0001](adr/0001-nao-fazer-scraping-do-linkedin.md). A via é a vitrine.

### Prioridade, por evidência e não por marketing

1. **Histórico ativo** — Revelo, BairesDev, WillDom. Conta existe e já rendeu
   processo; o trabalho é refrescar perfil, taxa e disponibilidade.
2. **LATAM → EUA, senioridade alta, inglês** — Strider, TECLA, Jobsity,
   BEON.tech, Nearsure, Howdy, VanHack, Talently, Index.dev.
3. **Marketplace global por hora** — Toptal, Turing, Arc.dev, Lemon.io, Gun.io.
   Braintrust já é fonte do acervo, com elegibilidade por país estruturada.

### O que o perfil precisa dizer, em todas elas igual

- **Cargo da trilha principal**, no vocabulário que o mercado escreve — é o que
  `jho skills gap` mostra, comparando o CV com as descrições do acervo.
- **Piso em USD, mensal e por hora.** Mensal 5.000 e o equivalente horário; sem
  isso a plataforma oferece o que a média dela paga.
- **Remoto B2B e sem autorização de trabalho nos EUA, dito de frente.** Parece
  contraintuitivo anunciar a restrição; ela economiza o funil dos dois lados, e
  é a mesma regra que o scorer aplica ao bloquear "W2 on-site".
- **Sobreposição de fuso**, em horas, não em adjetivo.
- **Um único texto de currículo.** `jho cv set` guarda a fonte da verdade;
  divergência entre plataformas é o que faz recrutador desconfiar do perfil.

### Cadência que mantém a vitrine viva

Vitrine ranqueia por atividade recente: perfil parado sai do filtro padrão de
quem busca. Uma vez por mês, em cada plataforma do tier 1 e 2: confirmar
disponibilidade, revisar a taxa e acrescentar uma entrega recente. É trabalho
humano, e o sistema entra no registro — não no envio (regra 13, ADR 0010).

### Como medir se vale a pena

Cada plataforma é um canal, e canal é coluna do funil:

```bash
jho contacts add "Strider" -c Strider -k company     # a plataforma como conta-alvo
jho track <id> applied --channel agency              # direct | ats | referral | recruiter | agency
```

Com o canal preenchido, `jho stats` separa a taxa de resposta por canal. O
próprio relatório avisa que abaixo de ~30 candidaturas a comparação entre
grupos é ruído: até lá o número serve para não esquecer onde a candidatura
entrou, não para decidir plataforma.

### Recrutador no LinkedIn, e o limite

Post de recrutador freelance é fonte real de vaga, e ainda assim não vira
coletor aqui: ler feed ou busca do LinkedIn logado é exatamente o que a
[ADR 0001](adr/0001-nao-fazer-scraping-do-linkedin.md) proíbe, e a conta é o
principal ativo de posicionamento. O que é legítimo, e já tem caminho:

- **Job alert por e-mail** do LinkedIn e das próprias plataformas —
  [ADR 0008](adr/0008-ingestao-de-email-como-fonte-de-sourcing.md); o pipeline de e-mail extrai a
  vaga e sugere, sem decidir.
- **Contato assistido:** o sistema monta o dossiê (`jho prep <id>`) e guarda o
  contato (`jho contacts add "Nome" -k recruiter`); quem escreve é o usuário.
