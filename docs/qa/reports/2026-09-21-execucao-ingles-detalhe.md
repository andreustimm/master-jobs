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
dicionário português foram detectados fora de `data-user-content`. Os dois
critérios da guarda medem coisas diferentes — o critério do dicionário pega
tradução mal feita, e literal de JSX não é valor do dicionário, então quem pega
literal é a rota estar na lista. Uma medição limpa pelo primeiro critério não diz
nada sobre o segundo.

`docs/qa/bugs/BUG-20260921-job-detail-labels-untranslated.md` tem a causa e por
que ela sobreviveu: as duas metades do problema se protegiam. Sem
`data-user-content` no dado do acervo, a rota não podia entrar na varredura de
acento; fora da varredura, ninguém veria os rótulos.

## Correção e reteste

A correção cabe dentro do governador do ciclo: seis chaves na seção `jobDetail`
dos dois dicionários, seis literais trocados por `t(...)`, `data-user-content` em
três campos que vêm do acervo, e `/jobs/904000101` acrescentada às duas
varreduras de inglês em `tests/e2e/ui.mjs`. Nenhuma mudança de comportamento.

A prova de regressão são as próprias varreduras, e ela é de dois lados: sem a
correção a rota reprova pelo rótulo em português **e** pelo acento sem marca.

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

## Decisões para um humano

Nenhuma. A correção é mecânica, coberta e sem efeito em produção além do texto.

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
cobre onze rotas de um array literal, e três defeitos já foram achados
exatamente na rota que acabava de entrar nele. O gate que falta é o `pnpm
test:e2e` não rodar no CI, o que mantém essa varredura fora de qualquer PR.
