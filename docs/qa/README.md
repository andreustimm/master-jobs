# QA vivo do master-jobs

Esta é a árvore única e versionada de QA orientado a jornadas. `qa-report`
mantém personas, fluxos, cenários, charters e bugs; `qa-execution` percorre o
produto como uma pessoa real e grava vereditos e relatórios aqui.

## Entrada e execução

- Dashboard local: `http://127.0.0.1:3000`
- Login: `http://127.0.0.1:3000/login`
- Perfil público: `http://127.0.0.1:3000/p/<slug>`
- CLI pública: `rtk pnpm jho <comando>`
- Servidor de desenvolvimento: `rtk pnpm dev`
- Build com paridade local: `rtk pnpm build` e `rtk pnpm start`
- Driver de jornada: `rtk pnpm exec agent-browser <comando>`
- Instalação inicial do Chrome do driver: `rtk pnpm qa:browser:install`
- Gates automatizados: `rtk pnpm check` (inclui os conversores do tracker) e
  `rtk pnpm test:e2e` (inclui axe cumulativo WCAG 2.0/2.1/2.2 AA em oito telas)

> **Rode os dois em série, nunca ao mesmo tempo.** A suíte de browser mede tempo
> real — transições, esperas, respostas — e disputar CPU com a suíte de unidade
> vira falha que não existe. Medido em 2026-09-20, na mesma árvore:
>
> | Execução | Falhas |
> |---|---:|
> | junto com `pnpm check` | 2 |
> | máquina ainda ocupada | 2 |
> | menos carga | 1 |
> | **máquina livre** | **0** de 274 |
>
> As falhas caíam com a carga e sumiram por completo. Uma delas me custou um
> diagnóstico errado — cheguei a acusar o helper de transição de estar quebrado.
>
> **Em 2026-09-21 o helper estava mesmo errado, e a prova veio de medir a árvore
> limpa.** Numa PR, `observeNavigation` reprovava no redirect do login para o
> cockpit três execuções de três; parecia defeito da PR. Duas execuções de
> `origin/dev` **sem alteração nenhuma** deram 262/262 e depois reprovaram
> exatamente ali: a falha já existia.
>
> A causa: num redirect aceito dentro do reducer do Server Action, o overlay
> nasce no `useLayoutEffect` do observador de commit e morre no `useEffect`
> seguinte — a janela em que ele existe no DOM é de **um quadro**, e o `locator`
> do Playwright pode perdê-la inteira. Uma das execuções mostrou o estado
> intermediário: o overlay anexou e desapareceu entre `waitFor` e
> `elementHandle`.
>
> A espera passou a tolerar não encontrar o elemento, e a prova vem do
> `MutationObserver` que o próprio helper já instalava — ele registra a inserção
> mesmo depois de o elemento sair.
>
> **A lição de método:** antes de consertar uma reprovação que apareceu junto com
> a sua mudança, meça a árvore sem ela. Duas execuções de baseline custam meia
> hora e são a diferença entre consertar o defeito e consertar a coincidência.
> Aqui a primeira hipótese — de que envolver a página inteira num promise mudava
> a transmissão da árvore — era plausível, foi implementada, e estava errada.

O dashboard sempre usa loopback. Sessões autenticadas usam contas e papéis de
teste reais; não use mocks para confirmar uma jornada.

Crie contas de QA com `rtk pnpm jho auth add-user <email> --role <papéis>` e
defina a senha com `rtk pnpm jho auth set-password <email>`. O mapeamento
persona→conta e as credenciais ficam em armazenamento privado, nunca em
`docs/qa/` nem no Git.

## Tela nova não herda guarda nenhuma

Toda guarda transversal deste repositório é um **array literal de caminhos**, e há
quatro delas:

| Guarda | Onde |
|---|---|
| Vazamento de português, com cookie `en` | `tests/e2e/ui.mjs`, duas listas |
| Largura real em 375, 768 e 1024 px | `tests/e2e/ui.mjs`, `searchRoutes` |
| Varredura axe WCAG 2.2 AA | `tests/e2e/a11y.mjs`, com a contagem `N/N` no fim |

Rota nova **não entra em nenhuma** até alguém editar as quatro. Foi assim que
`/jobs/<id>/paises` viveu duas releases fora de todas, com quatro chaves de
dicionário só dela.

E o custo apareceu no primeiro uso: ao entrar, a varredura reprovou por
localização de vaga sem `data-user-content` — em **dois** lugares, um deles o
popover de detalhe, que está no DOM mesmo fechado e aparece em toda tela com
lista. Os dois existiam desde sempre e nenhuma rota varrida tinha fixture com
acento na localização.

**Ao criar tela:** acrescente o caminho às quatro listas no mesmo commit, e ajuste
a contagem final da varredura axe. Se a tela precisa de id, use uma fixture do
`setup.mjs` em vez de um id inventado.

## Uma espera frágil apaga o relatório de todos os outros cenários

`tests/e2e/ui.mjs` é um script sequencial dentro de um `try` só. Quando um passo
estoura, a exceção pula para o `catch` final, que registra
`✗ suíte concluiu sem exceção` — e tudo que vinha depois **não roda**. Em
2026-09-21 o relatório saiu `42/43` com 262 verificações escritas: um `goto` do
WebKit estourou e apagou o veredito de 219 cenários que nada tinham com ele.

Duas regras saem daí:

**Não use `networkidle` numa tela do acervo.** Ele espera 500 ms sem nenhuma
requisição, e `/jobs` tem mil vagas no corpus E2E: entre prefetch de rota do Next,
fontes e imagens da lista, o WebKit não alcança esse silêncio. Espere
`domcontentloaded` mais o elemento que o cenário realmente usa — é determinístico,
é mais rápido, e falha dizendo o que faltou. Chromium tolera; WebKit não.

**Cenário que abre navegador próprio vai dentro do seu próprio `try`.** A falha
continua sendo falha, com o diagnóstico inteiro, mas deixa de decidir o destino
dos outros. O bloco WebKit é o único assim hoje.

Se um relatório vier com muito menos verificações do que o arquivo escreve,
procure a exceção antes de acreditar no número: `N/N passaram` com `N` pequeno é
uma suíte que parou, não uma suíte que passou.

**Ajudante chamado muitas vezes precisa do mesmo tratamento.** `feedbackOf` é
chamado dezenove vezes e esperava o aviso de mutação por 20 segundos; uma falha
levava a suíte inteira. Hoje ele reprova um check nomeado e devolve leitura vazia.
A regra geral: onde uma espera se repete, a falha dela não pode ser o fim da
execução.

## Conjunto de falhas que muda a cada execução é carga, não defeito

Medido em cinco execuções seguidas da mesma árvore: WebKit, a transição suave do
perfil público, `task-04 E2E-013` e `transition E2E-016` apareceram e
desapareceram em combinações diferentes. Uma delas deu 262 de 263.

Antes de investigar um cenário como defeito, **rode duas vezes**. As execuções que
seguem um `pnpm check` completo (quatro workers mais cobertura) na mesma máquina
falham mais, e a falha cai em cenários diferentes de cada vez.

O caso do WebKit é o exemplo: estoura em `/jobs` com `networkidle`, em `/jobs` com
`domcontentloaded` e em `/candidate`, que renderiza uma fração. Passou uma vez em
cinco. Não é a rota nem o tipo de espera — e aumentar o timeout esconderia
lentidão real sem dizer nada, então ele fica isolado e visível.

## Áreas

| Código | Área |
|---|---|
| `AUTH` | Login, sessão, recuperação e autorização |
| `NAV` | Navegação, transições e recuperação entre telas |
| `PWA` | Carregamento inicial e experiência instalada/offline |
| `JOBS` | Descoberta, filtros, detalhe e explicação de vagas |
| `SRCH` | Buscas por termo salvas e trilhas-alvo |
| `PIPE` | Shortlist, candidatura e histórico do funil |
| `PROF` | Perfil do candidato e currículo |
| `SKIL` | Vocabulário e catálogo de skills |
| `MAIL` | Correspondência e sugestões de e-mail |
| `ADMN` | Administração, usuários e impersonação |
| `PUB` | Perfil público e consentimentos |
| `CLI` | Jornadas executadas pelo terminal |

Todo cenário novo usa `<AREA>-<slug>` e uma área desta lista. Adicione a área
aqui antes de criar o primeiro cenário dela.

## Cadência no fluxo

- **Targeted:** toda branch/PR com mudança percebida pelo usuário; jornadas
  tocadas mais uma canária adjacente.
- **Sanity:** depois de hotfix; jornada corrigida mais uma adjacente.
- **Smoke:** depois de deploy; 2–4 jornadas de maior valor.
- **Full:** release candidate antes da PR humana `staging → main`; todas as
  jornadas P0/P1 e todas as personas do projeto.

Cada jornada registra `priority: P0 | P1 | P2` no seu YAML durável. `P0` cobre
caminhos críticos de release, segurança, privacidade e integridade dos dados;
`P1` cobre caminhos centrais, frequentes, de recuperação ou comercialmente
importantes; `P2` cobre comportamento de apoio. A prioridade armazenada, e não
uma escolha ad hoc da sessão, define o conjunto P0/P1 do Full QA.

Formato canônico de `journeys/J-<slug>.md`:

```yaml
journey:
  id: J-<slug>
  name: <verbo e objetivo>
  priority: P0 | P1 | P2
  value_statement: <valor observável para a pessoa>
```

O restante do mapa preserva personas, entradas, ações, objetivo, estado final,
saída, abandono e integrações conforme o contrato de `qa-report`. A prioridade
é obrigatória em toda jornada nova ou atualizada.

Mudança nova cria cenário `untested`; mudança em comportamento existente
reseta seus cenários para `untested`. Refactor sem efeito observável declara
"sem mudança visível" e não cria cobertura artificial.

## Estrutura e propriedade

- `personas.md`: personas duráveis deste produto.
- `journeys/`: fluxo Mermaid e verdadeiro estado final de cada jornada.
- `scenarios/`: tracker vivo, um comportamento por arquivo.
- `charters/`: missões imutáveis e reutilizáveis de sessão.
- `bugs/`: registro global, deduplicado pelo sintoma do usuário.
- `reports/`: um relatório datado por rodada; nunca sobrescrever.
- `automation-backlog/`: intenção de futura automação, um item por arquivo.
- `templates/`: symlinks para os formatos canônicos das skills; sem cópias.

`state.csv` é visão gerada e nunca é editada ou commitada. `evidence/` é
ignorado por padrão: screenshots ficam no disco ou como artefato de CI, e o
relatório versionado referencia seus caminhos.

## Evidência

Capture checkpoints e falhas, não cada clique. Um `Pass` exige observável
confirmado por leitura independente e sobrevivendo a refresh. Vídeos, HARs,
logs extensos e dumps não entram no Git; o relatório registra onde encontrá-los.

## Como iniciar um ciclo

1. Invoque a skill `qa-report` com o argumento `docs/qa` para mapear ou
   atualizar jornadas e planejar os charters do tier.
2. Garanta suíte verde e build acessível com paridade de produção. Na primeira
   execução da máquina, rode `rtk pnpm qa:browser:install`.
3. Invoque a skill `qa-execution` com o argumento `docs/qa`; ela cria o
   relatório antes da primeira sessão e atualiza o tracker após cada sessão e
   correção.
4. Feche com a suíte completa, depois rode `deep-review` antes da PR.
