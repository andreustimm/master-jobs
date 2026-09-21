# Execução de QA — interface em inglês na jornada do quadro filtrado

- **Data:** 2026-09-21
- **Escopo:** branch — o oitavo e último cenário sem veredito da jornada
  `J-trust-the-filtered-board`
- **Ambiente:** `tests/e2e/run-isolated.mjs --manual` — build de produção,
  PostgreSQL isolado provisionado na hora, `JHO_AUTH_MODE=secure`, autenticação
  real por senha
- **Suíte automatizada antes da sessão:** `pnpm exec tsc --noEmit` → `exit=0`

## Matriz

| Carta | Persona | Jornada | Tour | Cenário | Veredito |
|---|---|---|---|---|---|
| CH-recruiter-english-board | Recrutadora convidada | J-trust-the-filtered-board | Configuration Tour | JOBS-english-keeps-posting-data | **Pass**, depois de correção |

**Desvio de processo, declarado:** a carta foi escrita **depois** da caminhada,
não antes. O cenário existia e dizia o que conferir; o que faltava era a carta, e
eu percorri a jornada antes de notar a ausência. Registro porque a ordem importa
— carta antes serve para escolher o tour por risco, e escrevê-la depois é
racionalizar a escolha que já foi feita. Ela vale para as próximas execuções.

## O que foi percorrido

Como a recrutadora, em inglês: entrada em `/login` com senha real, quadro
filtrado pelo empregador `Country Fixture Lab` (o grupo de fixtures de país,
acrescentado ao ambiente manual na sessão anterior), vaga aberta a partir da
lista, e o hub de países do grupo.

A caminhada usou a interface pública por HTTP com o cookie de sessão real. Neste
repositório o estado de filtro é contrato de URL, então pedir a rota **é**
interagir com a tela; não houve mock, endpoint interno nem leitura de banco para
decidir o resultado. O motivo de não ter sido por cliques está registrado em
memória e continua valendo: o `agent-browser` perde o cookie entre invocações de
processo, e encadear a jornada inteira numa invocação só dá login, mas não dá
navegação estável depois dele.

## Achado

A lista **não** mostra a localização em texto — o agrupamento por país a
substituiu por bandeiras, com `title="Brazil · 2 postings"`. Isso é correto, e
significa que o texto do anúncio que o cenário pede mora em outras duas telas: o
hub e o detalhe.

O hub passou de primeira: `São Paulo, State of São Paulo, Brazil` intacto, dentro
de `data-user-content`, nenhum rótulo em português. Ele já está nas duas
varreduras de inglês.

O detalhe reprovou. Com `jho_locale=en`, o HTML servido de `/jobs/4` trazia
`← vagas`, `Ver vaga na origem` e `visto em` — duas ocorrências de cada, na
marcação e no payload do RSC. Três outros literais no mesmo arquivo apareceriam
nos ramos condicionais correspondentes: `fechada`, `Aplicar →` e
`de 100 · cluster`.

Detalhe do diagnóstico que vale guardar: na mesma medição, **zero** valores do
dicionário português foram detectados fora de `data-user-content` além de
`← vagas`, que já era `jobCountries.back`. Os dois critérios da guarda só
reprovam texto acentuado ou já presente no dicionário: `Ver vaga na origem` e
`visto em` não são nenhum dos dois, e passariam mesmo com a rota na lista. A
lista decide o que é medido; o que impede literal de JSX é a regra 9.

`docs/qa/bugs/BUG-20260921-job-detail-labels-untranslated.md` tem a causa e por
que ela sobreviveu: as duas metades do problema se protegiam. Sem
`data-user-content` no dado do acervo, a rota não podia entrar na varredura de
acento; fora da varredura, ninguém veria os rótulos.

## Correção e reteste

A correção cabe dentro do governador do ciclo: seis chaves na seção `jobDetail`
dos dois dicionários, seis literais trocados por `t(...)`, `data-user-content` em
três campos que vêm do acervo, e a rota acrescentada às duas varreduras de
inglês em `tests/e2e/ui.mjs` — na publicação de São Paulo, `/jobs/904000103`,
depois da revisão profunda (ver *Adendo*). A única mudança de comportamento é a
visível: a tela passa a falar inglês.

A prova de regressão são as próprias varreduras: tirar a marca reprova pelo
acento do acervo, e devolver `← vagas` reprova pelo dicionário. Um literal sem
acento e fora do dicionário não reprovaria.

Reteste no mesmo caminho que produziu o vermelho, com o ambiente reconstruído:

| Medição | Antes | Depois |
|---|---:|---:|
| `← vagas` em `/jobs/4` com locale `en` | 2 | 0 |
| `Ver vaga na origem` | 2 | 0 |
| `visto em` | 2 | 0 |
| `← jobs` / `View job at the source` / `first seen` | 0 | 2 cada |
| `São Paulo, State of São Paulo, Brazil` preservado | sim | sim |
| valores do dicionário pt-BR fora de `data-user-content` | 0 | 0 |

Confirmações que o veredito exige:

- **Sobrevive a refresh:** duas recargas seguidas, inglês 2, português 0,
  anúncio 2.
- **Caminho de leitura independente:** o hub `/jobs/2/paises` mostra a mesma
  localização acentuada intacta, vindo de outra página e outra consulta.
- **Sem correção excessiva:** com `jho_locale=pt-BR`, os três textos voltam em
  português e a localização segue intacta — a tela portuguesa não mudou.

## As outras duas guardas, medidas antes de entrar

A regra do repositório manda acrescentar rota nova às quatro listas no mesmo
commit. Cumpri-la por simetria seria arriscar trocar um defeito de i18n por uma
reprovação de acessibilidade ou de largura dentro do mesmo conserto, então a
rota foi medida primeiro, no ambiente de paridade:

| Guarda | `/jobs/4` |
|---|---|
| Excesso horizontal em 375 px | 0 px |
| Excesso horizontal em 768 px | 0 px |
| Excesso horizontal em 1024 px | 0 px |
| axe WCAG 2.2 AA em 1280 px | 0 violações |

Passou nas duas, então entrou nas quatro listas — `searchRoutes` em
`tests/e2e/ui.mjs` e a varredura axe de `tests/e2e/a11y.mjs`, cuja contagem final
vai de `9/9` para `10/10`. Se tivesse reprovado, a rota entraria só nas duas
varreduras de português e a reprovação viraria achado com correção própria.

## Texto acentuado que permanece, e por quê

A verificação acusa três trechos acentuados fora de `data-user-content` nas três
rotas, e os três são legítimos:

- `Português` — o rótulo da própria opção no seletor de idioma. Traduzi-lo
  derrotaria o seletor.
- Duas frases inglesas com `résumé`, que é palavra acentuada em inglês.

Fica escrito porque a próxima pessoa a ler a saída da verificação vai encontrar os
mesmos três e precisa saber que não são dívida.

## O tracker não materializava, e ninguém sabia

Achado de tabela, não de tela, e achado por acidente: ao conferir o esquema para
escrever o veredito deste cenário, escrevi `retest_status: verified` — valor que
não existe no enum. Rodar o materializador para me corrigir mostrou que a árvore
**inteira** reprovava: **15 erros em 15 arquivos**, e `docs/qa/state.csv` não
podia ser gerado.

| Classe | Arquivos | O que era |
|---|---:|---|
| `retest_status: verified` | 8 | valor inexistente; o enum é `pass` |
| `retest_status: pass` com `qa_status` não-`pass` | 4 | a superfície mudou depois do reteste e só metade do par foi zerada |
| `qa_status: pass` sem `evidence` | 3 | veredito sem prova apontada |
| `fix_status: fixed` sem `fix_commits` | 2 | correção afirmada sem SHA |
| `qa_status: blocked` | 2 | valor inexistente; o enum é `blocked-verify` |

Dois desses eram meus, da sessão anterior desta jornada (`qa_status: blocked`), e
dois eram desta sessão. O resto vinha de ciclos anteriores. Nenhum era visível:
**o validador só roda quando alguém materializa a visão, e a visão é ignorada
pelo git** — então o único jeito de o erro aparecer é alguém rodar o script de
propósito. Oito arquivos com o mesmo valor inventado mostram que ninguém rodou.

Correções aplicadas, todas conformes ao esquema:

- `verified` → `pass` nos oito.
- `blocked` → `blocked-verify` nos dois.
- Nos quatro em que a superfície mudou depois do reteste, `retest_status` passa
  a `pending` — "corrigido, ainda não re-percorrido". O veredito antigo não
  vale mais, e a história continua no relatório que `last_report` aponta. A
  primeira versão deste reparo deixou o campo vazio, que no esquema quer dizer
  "reteste dispensado"; a revisão profunda corrigiu, e estendeu o `pending` aos
  outros dois cenários com a mesma forma (`JOBS-work-mode-mobile` e
  `SRCH-mobile-layout`).
- `evidence` preenchido com o relatório que produziu o veredito nos três.
- `fix_commits` preenchido com `4ef5e79; 3ff3f1f` nos dois do
  `BUG-20260919-mobile-searches-overflow`, recuperados da PR #125.

Depois: `56 scenarios` e zero erros.

**A lição de processo:** um validador que só roda sob demanda não é validador. O
contrato do tracker vale exatamente enquanto alguém o executa, e oito ocorrências
do mesmo erro são a medida de há quanto tempo ninguém executava.

## Decisões para um humano

Uma: **o validador do tracker deveria entrar num gate?** Ele é barato (menos de um
segundo) e acabou de achar 15 registros inválidos que estavam passando há
semanas. As opções e a recomendação:

1. **Entrar no `pnpm check`** (recomendado) — o gate que já é obrigatório, e onde
   nenhum registro inválido sobrevive a um commit. Custo: Python no caminho do
   `check`, o que já é verdade por causa do `test:qa-skills`.
2. Entrar só no CI — pega antes da PR, mas deixa o commit local passar.
3. Deixar sob demanda — mantém o custo em zero e o contrato em promessa; é o
   estado que produziu estes 15.

Não decidi sozinho porque muda o que reprova um commit de todo mundo, e essa
escolha é do dono do repositório.

## Status final

Oitavo cenário da jornada fechado como **Pass**. Um defeito de impacto
Trust-Damage encontrado e corrigido, registrado como
`BUG-20260921-job-detail-labels-untranslated`.

A jornada `J-trust-the-filtered-board` tem doze cenários e fica em **oito Pass**
(`JOBS-pay-filter`, `JOBS-score-range`, `JOBS-english-keeps-posting-data`,
`JOBS-cockpit-count-matches-list`, `JOBS-group-repeated-countries`,
`JOBS-anonymous-employer-never-groups`, `JOBS-employer-filter`,
`JOBS-hide-already-sent`) e **quatro bloqueados** — dois por natureza
(`JOBS-filter-fields-follow-url` e `JOBS-source-multi-select`, que pedem arrastar
controle de faixa e clicar em multi-seleção) e dois porque o driver não conclui
navegação por clique (`JOBS-country-hub`,
`JOBS-group-canonical-survives-filter`). **Nenhum permanece `untested`.**

Este relatório não afirma que a varredura de inglês cobre o produto inteiro. Ela
cobre treze rotas em duas listas literais, e três defeitos já foram achados
exatamente na rota que acabava de entrar nele. O gate que falta é o `pnpm
test:e2e` não rodar no CI, o que mantém essa varredura fora de qualquer PR.

## Adendo — revisão profunda da PR #170

A `/deep-review` da PR devolveu `FIX_BEFORE_SHIP` e achou três coisas que esta
sessão afirmou sem ter observado:

- **Dois rótulos ficaram fora do inventário.** `casadas:` e `ausentes:`, no
  cartão de score, continuavam em português. A recrutadora não vê o cartão, a
  fixture das varreduras tinha palavras-chave vazias e nenhum dos dois textos é
  acentuado ou valor do dicionário — as três provas eram cegas para eles.
  Corrigidos com as chaves que `/compare` já usava.
- **A fixture varrida não tinha acento.** `/jobs/904000101` é a publicação
  holandesa do grupo; tirar `data-user-content` não reprovaria nada ali. As
  quatro listas passam a usar `/jobs/904000103` (São Paulo), com palavras-chave
  para renderizar o cartão.
- **A medição axe foi feita como recrutadora; a varredura roda como dono.** O
  dono vê o formulário de funil, cujo `<select>` não tinha nome acessível
  (`select-name`, WCAG 2 A) — o `10/10` desta sessão nunca foi observado. O
  `select` ganhou `aria-label`, e a contagem passou a valer quando a suíte
  E2E rodou com a correção.
