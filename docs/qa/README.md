# QA vivo do master-jobs

Esta é a árvore única e versionada de QA orientado a jornadas. `qa-report`
mantém personas, fluxos, cenários, charters e bugs; `qa-execution` percorre o
produto como uma pessoa real e grava vereditos e relatórios aqui.

## Entrada e execução

- Dashboard local: `http://127.0.0.1:3000`
- Login: `http://127.0.0.1:3000/login`
- Perfil público: `http://127.0.0.1:3000/p/<slug>`
- CLI pública: `rtk pnpm jho <comando>`
- CLI de tarefas: `rtk pnpm tasks <comando>`; piloto e pré-condições na
  [jornada de coordenação da entrega](journeys/J-coordinate-task-delivery.md)
- Servidor de desenvolvimento: `rtk pnpm dev`
- Build com paridade local: `rtk pnpm build` e `rtk pnpm start`
- Driver de jornada: `rtk pnpm exec agent-browser <comando>`
- Instalação inicial do Chrome do driver: `rtk pnpm qa:browser:install`
- Gates automatizados: `rtk pnpm check` (inclui os conversores do tracker) e
  `rtk pnpm test:e2e` (inclui axe cumulativo WCAG 2.0/2.1/2.2 AA nas telas de
  `AXE_SWEEP`, em `tests/e2e/routes.mjs`). O que cada um cobre no CI e o que
  fica só para a jornada está em [O que o CI prova](#o-que-o-ci-prova-e-o-que-só-a-jornada-prova).

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
> **Medido de novo em 2026-09-21, e o padrão se repetiu com outros cenários.**
> Seis execuções da mesma árvore, depois que a suíte deixou de abortar:
>
> | Execução | Falhas |
> |---|---|
> | 1 (após `pnpm check`) | WebKit, perfil público, task-04, E2E-011 |
> | 2 (após `pnpm check`) | WebKit, perfil público, task-04, abort |
> | 3 | só o abort — WebKit e perfil público **passaram** |
> | 4 | só WebKit — **262 de 263** |
> | 5 | WebKit, perfil público, task-04, e `transition E2E-016` |
> | 6 | WebKit, perfil público, task-04 — 261 de 264 |
>
> `transition E2E-016` passou nas quatro primeiras e reprovou na quinta, sem
> nenhuma mudança entre elas. **Conjunto de falhas que muda a cada execução é
> carga.** E o WebKit é o caso extremo: estoura em `/jobs` com `networkidle`, em
> `/jobs` com `domcontentloaded` e em `/candidate`, que renderiza uma fração —
> passou uma vez em seis. Não é a rota nem o tipo de espera, e aumentar o timeout
> esconderia lentidão real sem dizer nada.
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

## Tela nova não herda guarda nenhuma — agora reprova

As guardas transversais do navegador eram **arrays literais de caminhos**,
espalhados por `ui.mjs` e `a11y.mjs`, e rota nova não entrava em nenhum até
alguém lembrar. Foi assim que `/jobs/<id>/paises` viveu duas releases fora de
todas, e `/jobs/<id>` — **a tela mais aberta do produto** — serviu `← vagas`,
`Ver vaga na origem` e `visto em` em português com a interface em inglês desde
que existe.

Desde a #202 as listas moram em `tests/e2e/routes.mjs`, e as varreduras as
importam:

| Guarda | Lista |
|---|---|
| Vazamento de português, cookie `en`, como dono | `ENGLISH_OWNER_SWEEP` |
| Vazamento de português, sem sessão | `ENGLISH_ANONYMOUS_SWEEP` |
| Vazamento de português depois de criar trilhas | `ENGLISH_SEARCHES_SWEEP` |
| Largura de 320 a 1024 px e conteúdo cortado | `OVERFLOW_SWEEP` |
| Largura em 375, 768 e 1024 px com as trilhas | `OVERFLOW_SEARCHES_SWEEP` |
| axe WCAG 2.2 AA a 1280 px | `AXE_SWEEP` |

`tests/e2e-route-coverage.test.ts`, dentro do `pnpm check`, cruza a união
dessas listas com o inventário de páginas de `tests/support/entry-inventory.ts`
— o mesmo que decide autorização. **Página nova que não entra em nenhuma lista
nem em `UNMEASURED_PAGES` reprova.** Exceção precisa de motivo, precisa apontar
para página que existe, e sai quando a página passa a ser medida. Hoje ficam
fora, com o porquê escrito: a fixture `/transition-test`, as duas telas de
recrutador e `/p/[slug]`.

E as varreduras deixaram de aprovar o login no lugar da tela pedida:
`gotoMeasured` confere resposta 2xx e **destino igual ao pedido**. Uma sessão
que caísse no meio da suíte mandava toda rota privada para `/login`, e a
varredura media o login — sem estouro e sem português — e passava.

O que continua valendo, e o teste não substitui:

- **A lista decide o que é medido, e os critérios decidem o que reprova.**
  Numa rota listada, literal de JSX só reprova se tiver acento ou já for valor
  do dicionário português: `Ver vaga na origem` e `visto em` passariam com a
  rota na lista. A defesa continua sendo o texto vir do dicionário.
- **A rota não pode entrar sem `data-user-content`** nos campos que vêm do
  acervo: o acento deles é legítimo e reprovaria. E a marca só fica provada se a
  fixture varrida tiver acento — por isso a tela de detalhe é varrida em
  `/jobs/904000103` (São Paulo), não na publicação holandesa do mesmo grupo.
- Rota com id usa fixture do `setup.mjs`, nunca id inventado; `{track}` e
  `{term}` são trocados pelo id criado durante a suíte.
- **Meça antes de acrescentar.** Rota que reprova em largura ou axe ao entrar é
  achado com correção própria, não parte do conserto de i18n.

**`retest_status: pending` também vale para bug `verified`** quando a
superfície que o reteste conferiu mudou depois dele: o veredito antigo não vale
mais, e vazio diria "reteste dispensado". Assim `rg 'retest_status: pending'`
lista todo reteste devido, qualquer que seja o status do bug.

## O que o CI prova e o que só a jornada prova

São perguntas diferentes, e nenhuma das quatro camadas responde a da outra.

| Camada | Onde roda | O que prova | O que não prova |
|---|---|---|---|
| `pnpm check` (Vitest, cobertura, inventário de rotas) | jobs `contratos`, `testes` e `cobertura`, obrigatórios via `qualidade` | regra pura, contrato de banco, autorização de toda entrada, que toda página tem varredura ou exceção | que a tela renderiza, cabe ou fala inglês |
| Fronteira PWA (`pnpm test:pwa-browser`) | job `pwa-browser`, obrigatório via `qualidade` | service worker sem nada autenticado, num Chromium real | o resto da interface |
| `pnpm test:e2e` (`ui.mjs` + `a11y.mjs`) | job `e2e-navegador`, **ainda não obrigatório** | build de produção, PostgreSQL descartável, login real por papel; as varreduras de `routes.mjs`; temas, contraste do editor, WebKit no histórico de novidades | que uma pessoa consegue cumprir o objetivo; texto literal sem acento; telas em `UNMEASURED_PAGES` |
| QA de jornada (`qa-execution`) | só local, com gente ou agente dirigindo | que a persona chega ao estado final pela interface pública, e que ele sobrevive a refresh e a leitura independente | nada que o CI já reprova — ela não substitui nenhuma das linhas acima |

O job `e2e-navegador` roda em todo PR e push das três branches, sem segredo
nenhum: o próprio harness sobe um `postgres:17` descartável no loopback do
runner, com senha aleatória, e `database-guard.mjs` recusa qualquer outro banco.
O build descartável também não recebe nenhum `.env*` além do molde
`.env.example` — antes, um checkout com `.env.production` levava a configuração
de produção para o servidor do E2E. Dado de produção nunca entra na fixture: a
fixture é o `setup.mjs`.

**Ele ainda não é obrigatório** — é a única exceção registrada ao agregador
`qualidade` (`NON_BLOCKING_CI_JOBS` em `scripts/release/promotion-ci.ts`,
reexportada como `NON_BLOCKING_JOBS` em `tests/support/ci-workflow.ts`), não roda
na chamada da promoção nem no `workflow_dispatch` que ela faz em `staging`, e
a promoção ignora o resultado dele no CI de push de `dev`: vermelho ou ainda
rodando, ele não barra nada (#303). Torná-lo obrigatório espera a
medição de instabilidade da #202: um portão que reprova por carga ensina a
reexecutar até passar, e isso é pior do que não ter portão.

## Uma espera frágil apaga o relatório de todos os outros cenários

`tests/e2e/ui.mjs` é um script sequencial dentro de um `try` só. Quando um passo
estoura, a exceção pula para o `catch` final, que registra
`✗ suíte concluiu sem exceção` — e tudo que vinha depois **não roda**. Em
2026-09-21 o relatório saiu `42/43` com 262 verificações escritas: um `goto` do
WebKit estourou e apagou o veredito de 219 cenários que nada tinham com ele.

Duas regras saem daí:

**Não use `networkidle` numa tela do acervo.** Ele espera 500 ms sem nenhuma
requisição, e `/jobs` tem mil vagas no corpus E2E: entre prefetch de rota do Next,
fontes e imagens da lista, esse silêncio pode nunca chegar. Espere
`domcontentloaded` mais o elemento que o cenário realmente usa — é determinístico,
é mais rápido, e falha dizendo o que faltou.

A regra vale por si, mas **não era a causa do caso do WebKit**: trocar por
`domcontentloaded` não resolveu, e apontar o cenário para `/candidate` também não.
Registrado aqui para o próximo não repetir a tentativa — ver a segunda tabela em
*Entrada e execução*.

**Cenário que abre navegador ou contexto próprio vai dentro do seu próprio `try`.**
A falha continua sendo falha, com o diagnóstico inteiro, mas deixa de decidir o
destino dos outros. Hoje são dois: o bloco do WebKit e a navegação para o perfil
público, que além do `try` tem recuperação por `goto` — porque o que vem depois
dela são asserções de vazamento de dado, e verificação de segurança não pode ficar
sem resposta porque uma navegação de cliente não chegou.

Se um relatório vier com muito menos verificações do que o arquivo escreve,
procure a exceção antes de acreditar no número: `N/N passaram` com `N` pequeno é
uma suíte que parou, não uma suíte que passou.

**Texto do servidor visível não prova documento hidratado.** Um redirect de
Route Handler (o `/login/callback`) às vezes vira navegação de documento em vez
da suave; o alerta da tela nova chega no HTML e fica visível antes da
hidratação, e um `router.push` disparado nessa janela morre sem erro — o
roteador do Next só cria a fila de ações logo antes do `hydrateRoot`. Foi a
instabilidade da transição para `/p/` (#303): 20 s de espera sem nenhuma
requisição ao perfil. Depois de uma fase que pode trocar o documento, espere a
fibra do React no nó da tela (`__reactFiber$…`) antes do próximo `push`, e use
`pushOn`, que falha quando o roteador não existe, em vez de `?.` que engole.

**Ajudante chamado muitas vezes precisa do mesmo tratamento.** `feedbackOf` é
chamado dezenove vezes e esperava o aviso de mutação por 20 segundos; uma falha
levava a suíte inteira. Hoje ele reprova um check nomeado e devolve leitura vazia.
A regra geral: onde uma espera se repete, a falha dela não pode ser o fim da
execução.

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

`state.csv` é visão gerada e nunca é editada ou commitada. Quem a gera é
`pnpm check:qa-tracker`, que também valida cada cenário contra o esquema e roda
dentro do `pnpm check` e do CI — cenário com enum inventado, `pass` sem
evidência ou `fixed` sem `fix_commits` reprova o gate local e a PR; nenhum hook
o roda no commit. Antes de entrar no gate, o
validador só rodava sob demanda, e a primeira execução em semanas achou 15
registros inválidos. `evidence/` é
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
