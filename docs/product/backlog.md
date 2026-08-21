# Backlog de discovery

Status conferido em 18/08/2026 contra o código, não contra a intenção. Oito
itens estavam marcados como pendentes tendo sido entregues — corrigidos nesta
revisão. Um backlog que mente sobre o próprio estado é pior que backlog nenhum,
porque orienta a próxima decisão para o lugar errado.

Contexto de produto: `vision.md` · `personas.md` · `user-stories.md`.

Captura de tudo que foi pedido na sessão de 18/08/2026, priorizado por impacto
no objetivo real: **converter posicionamento em entrevistas qualificadas**.

A priorização não é por ordem de pedido nem por facilidade. É por quanto cada
item move a agulha num funil de contratação real.

---

## Legenda

| Marca | Significado |
|---|---|
| ✅ | Pronto e commitado |
| 🔨 | Em implementação |
| 🔄 | Decisão em andamento |
| 📋 | Capturado, não iniciado |

---

## P0 — Corrigem defeito ativo que esconde vagas boas

Estes não são recursos novos. São bugs que fazem o sistema **descartar vagas
que serviriam**, e portanto custam entrevistas hoje.

### B-01 · Moeda ignorada no scoring ✅

`scoreComp()` compara o valor bruto contra um piso em USD sem olhar
`comp_currency`. O banco contém vagas em **CAD, AUD, MXN e PHP**. Uma vaga de
MXN 50.000/mês é pesada contra um piso de USD 90.000/ano como se fossem a mesma
unidade.

**Correção:** value object `Money` (amount + currency + period), conversão via
tabela de câmbio, e recusa explícita de comparar quando não há taxa — em vez de
tratar BRL como USD silenciosamente.

### B-02 · Períodos não normalizados ✅

O corpus traz cinco grafias vindas de cinco APIs: `annual`, `1 YEAR`, `year`,
`hourly`, `monthly`. O scorer só reconhecia `"hour"` e `"month"`, então:

> **Invariante:** `hourly` caía no ramo anual. **USD 100/hora era pontuado como
> USD 100/ano** e a vaga descartada como abaixo do piso. Vagas de contractor por
> hora — exatamente o modelo B2B que o candidato busca — estavam sendo
> sistematicamente eliminadas.

**Correção:** `parsePeriod()` com aliases, cobrindo hora, dia, semana, mês, ano
e projeto.

### B-03 · Frescor da vaga não é usado ✅

`postedAt` é armazenado e nunca consultado. Em recrutamento, vaga com menos de
48–72h tem taxa de resposta muito maior: poucos candidatos ainda, recrutador
engajado. Esta é a maior alavanca de resposta disponível hoje, e custa pouco.

**Proposta:** componente de frescor no score, ou no mínimo destaque de vaga nova
no `jobs list`.

### B-04 · `pick()` escolhe apelido por presença, não por conteúdo ✅

`src/core/ingest/import.ts:42`. A função percorre os apelidos de um campo e
para no **primeiro que existe** e não é `null`, `undefined` ou `""`. Um objeto
sempre passa nesse teste. Só depois `asString()` desce nele, encontra
`{ name: "  " }`, apara e devolve `null` — e aí não há mais volta, porque o
apelido seguinte já foi descartado.

O payload `{ company: { name: "  " }, employer: "Acme" }` entra como
**"Desconhecida"**, e `employer` nunca chega a ser lido. Caracterizado em
`tests/cov-ingest-import.test.ts`.

É a regra 17 um nível mais fundo: `pick()` protege contra a string vazia
literal, e não contra o valor que *vira* vazio depois de normalizado.

Está em P0 porque o efeito não é cosmético. `referralOpportunities()` casa vaga
com contato por `job.companyName` — uma vaga em empresa onde Andreus já
trabalhou, importada como "Desconhecida", **nunca aparece em `jho referrals`**.
E este caminho é justamente o das plataformas logadas (Revelo, BairesDev), que
são a fonte com empregador nomeado: a que o invariante de qualidade de fonte
diz valer mais que volume anônimo.

**Correção que o defeito pede:** `pick()` decidir sobre o valor já normalizado,
e não sobre a presença da chave. Ou o normalizador entra dentro dela, ou a
ordem se inverte — normalizar cada candidato e ficar com o primeiro que
sobreviver. A segunda forma custa mais chamadas e é a que não tem como errar de
novo.

**Fica de fora:** deduzir empresa da URL ou do domínio do e-mail.
"Desconhecida" continua sendo o último recurso legítimo quando nenhum apelido
tem conteúdo — o defeito é chegar nele com `employer: "Acme"` no payload.

---

## P1 — Mudam a qualidade do dado do funil


#### Entregue em 20/08/2026

`pick()` virou `pickAs()`: normaliza cada candidato e fica com o **primeiro que
sobrevive**, em vez de parar no primeiro que existe. É a forma que o item
recomendou, e a que não tem como errar de novo — quem decide é o valor final, não
a presença da chave.

Confirmado contra o código antigo: seis dos nove casos reprovam lá. Um teste de
caracterização que fixava o defeito foi convertido em teste da correção.

### F-01 · E-mail como fonte de dados ✅ (código completo; falta só a credencial do usuário)

> **Decisão tomada:** [ADR 0008](../adr/0008-ingestao-de-email-como-fonte-de-sourcing.md).
> O caminho é legítimo e não aciona as cláusulas da §8.2 que mordem, sob três
> travas. O acesso ao inbox é via Gmail API com escopo somente-leitura.

Três usos distintos, com valor decrescente de novidade e crescente de esforço:

**(a) Job alerts do LinkedIn.** Fecha a única lacuna declarada na ADR 0001.
Os e-mails são correspondência do próprio usuário — lê-los não toca a
plataforma nem viola a seção 8.2, ao contrário de dirigir o cookie `li_at`.

**(b) E-mails de ATS → funil por evidência.** Confirmação, convite de triagem,
agendamento, rejeição. Hoje o status é digitado de memória. Habilita três
métricas que hoje não existem:

| Métrica | Por que importa em R&S |
|---|---|
| Tempo de resposta por empresa | Processo que responde em 48h está vivo; o que some por 3 semanas provavelmente congelou a vaga |
| Ghosting explícito | Sem retorno em 10–14 dias é descarte na prática; marcar libera atenção |
| **Rejeição por estágio** | O dado mais desperdiçado numa busca |

Sobre rejeição por estágio — são **três problemas diferentes**, cada um com
correção distinta:

- Rejeição em triagem de CV → posicionamento e keywords
- Rejeição após entrevista técnica → calibragem de nível
- Rejeição na negociação → expectativa de remuneração ou modelo de contratação

Sem essa separação, o candidato só sabe "não fechou", que é quase inútil.

**(c) Recruiter inbound.** Quem procurou, por qual cargo, e se o posicionamento
está atraindo o nível certo.

### F-02 · Área do candidato dinâmica ✅

Hoje o perfil é `profile/profile.yaml`, estático e único. Precisa virar entidade
consultável e editável, explicitamente porque **pode virar produto** — ou seja,
multi-candidato.

Decisão de fronteira que precisa ser acertada: o que é por candidato (perfil,
alvos, restrições, ranges, benefícios, funil) e o que é compartilhado (corpus de
vagas, registro de empresas, taxas de câmbio). Errar essa linha é caro.

### F-04 · Fontes autenticadas: Revelo, BairesDev, marketplaces ✅ (parte automatizável)

Andreus já trabalhou via **Revelo** (MPC) e **BairesDev** (ADT Solar, Red
Ventures), e mantém conta ativa nas duas. As vagas dessas plataformas só existem
dentro da área logada — a API da Revelo devolve 401 e usa Keycloak SSO com token
em memória, sem credencial reutilizável.

Investigação completa em `docs/sources-autenticadas.md`. Caminho proposto:
leitura assistida via extensão do Chrome, com as vagas entrando por
`jho jobs add`. Nunca adapter automático sem ADR própria.

> **Invariante:** ausência de cláusula proibindo automação nos termos não é
> permissão. Vale o mesmo rigor da ADR 0001.

**Entregue (19/08):** `jho sources snippet <plataforma>` gera um extrator para
o usuário colar no console do próprio navegador, na sessão dele. Lê a página
que ele já está vendo, copia o JSON para a área de transferência, e
`jho jobs import` faz o resto — o mesmo caminho que já existia.

O extrator é genérico de propósito: heurística sobre o DOM, não seletor por
site. Seletor para uma página que este projeto não consegue abrir seria palpite
apresentado como conhecimento, e apodreceria no próximo deploy da plataforma
sem ninguém perceber. Há teste garantindo que o código gerado é JavaScript
válido e que **não contém nenhuma chamada de rede** — a premissa toda é que ele
roda na sessão autenticada do usuário, então não pode ser capaz de mandar essa
sessão para lugar nenhum.

**O que continua fora de escopo, e permanece:** adapter automático dirigindo
sessão autenticada. Exigiria ADR própria e o invariante acima diz não.

### F-03 · Referral não é rastreado ✅ implementado

`jho contacts add` registra a rede, `jho contacts seed` semeia as 14 empresas
onde Andreus já trabalhou ou entregou (o vínculo mais forte que existe, e que
estava parado no currículo), e `jho referrals` lista vagas abertas onde já há
contato. `jho track <id> applied --channel referral` finalmente alimenta a
coluna que existia sem uso.

Estado hoje: 14 empresas na rede, nenhuma com vaga aberta no acervo — o comando
reporta isso em vez de ficar em silêncio. As 30 contas-alvo da auditoria §2.2
ainda precisam ser adicionadas à mão.

---

## P2 — Ampliam o modelo de match

### M-01 · Ranges de remuneração por moeda ✅

Aceitar faixas em USD, BRL e outras, dinâmico para novas moedas.

> **Invariante de domínio:** o range em BRL **não é a conversão** do range em
> USD. Contrato em BRL carrega risco cambial e tributação diferentes, e o
> candidato pode racionalmente exigir prêmio numa moeda e não na outra. Ranges
> são declarados por moeda de forma independente; a conversão é o *fallback*
> para moedas sem range declarado, não a regra.

**Fonte de câmbio:** [Frankfurter](https://frankfurter.dev) — ECB oficial, sem
chave, sem cadastro, 30 moedas incluindo todas as que aparecem no corpus.
Fallback: `open.er-api.com` para moedas fora do ECB. Taxas cacheadas com data,
para que um score seja sempre reproduzível a partir da taxa que foi usada.

### M-02 · Modelos de engajamento ✅

Suporte a **hora, mês, ano e projeto fechado**.

Projeto é estruturalmente diferente: o valor é o total do negócio, não uma taxa.
USD 30k em 2 meses equivale a USD 180k/ano; os mesmos 30k em 12 meses ficam
abaixo do piso. Sem duração não há comparação — por isso `annualize()` de um
projeto sem duração retorna null em vez de inventar um prazo.

### M-03 · Benefícios como critério de match ✅

Cruzar o que a vaga oferece com o que o candidato exige. Flags opcionais.

Modelo proposto — cada benefício com um nível de exigência:

| Nível | Efeito no score |
|---|---|
| `required` | Ausência é bloqueio |
| `preferred` | Soma pontos |
| `nice_to_have` | Soma pouco |
| `irrelevant` | Ignorado |

Benefícios que importam para contractor B2B internacional: PTO remunerado (raro
em B2B, grande diferencial), stipend de saúde, equipamento/home office, verba de
aprendizado, equity, flexibilidade assíncrona. Irrelevantes para este perfil:
patrocínio de visto e relocação — ele quer remoto.

Detecção na vaga por padrões de texto na descrição.

**Custo:** os pesos do scorer somam 100. Adicionar benefícios exige rebalancear
e subir `SCORER_VERSION`.

### M-04 · Ordenação e filtros ✅

Ordenar por score, por valor e outros critérios; filtros compostos.

Ordenar por valor exige M-01 e M-02 resolvidos — sem moeda e período
normalizados, ordenar por remuneração produz um ranking sem sentido.

---

### UI-01 · Motion para transições e movimento ✅ (resolvido sem a dependência)

Implementar [Motion](https://motion.dev/) nas transições do sistema.

**Contexto que restringe a solução:** hoje o dashboard não envia **nenhum**
JavaScript de cliente — todas as páginas são Server Components e o estado de
filtro vive na URL. A única exceção é o editor de markdown, que é um Client
Component isolado porque um editor não tem como não ser.

Motion exige JavaScript no cliente. Então a decisão não é "usar ou não", é
**onde**:

| Abordagem | Custo | Quando faz sentido |
|---|---|---|
| CSS puro (`@starting-style`, `view-transition-name`) | zero JS | Fade de entrada, transição entre rotas |
| Motion como ilha em componentes específicos | JS só onde há movimento | Barra de score animando ao carregar, cards do funil reordenando |
| `motion` global com `LayoutGroup` | JS em toda página | Só se o movimento for identidade do produto |

**Recomendação a validar:** começar pelo View Transitions API nativo para
navegação entre rotas — que o Next 16 estabilizou e custa zero JavaScript — e
usar Motion apenas onde o movimento carrega informação: a barra de composição
do score crescendo componente a componente, e as linhas do funil reordenando
quando um status muda. Movimento decorativo em cima de uma grade de 6.000 vagas
é ruído, não polimento.

**Primeiro passo concreto:** medir. Rodar a UI atual com `view-transition-name`
nas rotas e ver se resolve, antes de adicionar dependência.

**Resultado da medição (19/08):** resolveu. Entregue com CSS nativo e **zero
dependências** — `@view-transition` para navegação, entrada escalonada nas
listas e a barra de score crescendo a partir do zero. Verificado: 50 linhas
animadas na página de vagas, nenhum byte de JavaScript de cliente adicionado.

Motion continua justificável no dia em que o funil precisar reordenar linhas
com continuidade visual — movimento que carrega informação. Aí entra como
ilha, só naquele componente. Enquanto o movimento for de entrada e de
composição, pagar um bundle por ele seria trocar a propriedade mais valiosa
desta UI por polimento.

> **Invariante a preservar:** qualquer animação deve respeitar
> `prefers-reduced-motion`. Uma grade de triagem que se move quando o usuário
> pediu que não se movesse é uma falha de acessibilidade, não um detalhe.

### UI-02 · Histórico de versões do currículo: modal, restaurar, renomear, excluir ✅

Pedido em 19/08/2026. Hoje `/candidate` lista as versões no rodapé da página,
somente leitura: rótulo, tamanho em caracteres e data. Não dá para voltar a
uma, renomear nem apagar.

**O que a lista de hoje mostra, e por que ela não serve.** Na captura enviada,
três versões carregam o rótulo `ATS EN 2026-07` e medem 8.227, 8.228 e 8.166
caracteres. Um caractere de diferença entre duas delas. O rótulo é a única
alça humana da versão e ele não distingue nada — a lista existe, mas não
responde à única pergunta que se faz a um histórico: *qual era esta?*

Isto não é problema de layout. É a razão de as três operações pedidas serem uma
tarefa só: restaurar sem saber o que se restaura é sorteio.

---

#### Decisões que a implementação precisa tomar

**1. Restaurar acrescenta, não rebobina.**

Restaurar a versão N deve gravar uma versão nova com o conteúdo de N, e não
mover o ponteiro `is_current` de volta. As duas alternativas preservam as
linhas, mas só a primeira mantém "a última linha" e "o currículo atual" como a
mesma coisa. Mover o ponteiro faz o histórico deixar de ser cronológico, e todo
código que hoje lê `history[0]` como o estado corrente passa a mentir em
silêncio — inclusive a análise de vocabulário e a de skills, que comparam o
mercado com o CV atual.

O rótulo da versão criada deve dizer de onde veio (`restaurada de ATS EN
2026-07`), senão o próximo histórico repete o problema deste.

**2. Excluir esbarra em um vínculo que hoje não existe de verdade.**

`application.cv_variant` é **texto livre**, não chave estrangeira para
`candidate_document.id`. Ou seja: o funil registra qual variante do currículo
foi enviada para cada vaga guardando o nome dela numa string solta.

A consequência para quem recruta é concreta. Antes de uma entrevista a pergunta
é *"que currículo essa empresa viu?"* — e ela precisa ser respondível meses
depois. Apagar uma versão hoje não quebra nada tecnicamente, e é justamente o
problema: o funil continua afirmando que enviou `ATS EN 2026-07` para uma vaga
enquanto esse documento não existe mais. Auditoria que aponta para o vazio é
pior que auditoria nenhuma, porque parece íntegra.

Duas correções, e a segunda é a que importa:

- Bloquear a exclusão de versão cujo rótulo apareça em `application.cv_variant`,
  explicando na interface **quais** candidaturas a prendem.
- Trocar `cv_variant` por referência ao `candidate_document.id`, com
  `ON DELETE RESTRICT`. O banco passa a garantir o que a interface só pede.

**3. A versão atual não se exclui.**

O candidato precisa ter sempre um currículo corrente: `/candidate` renderiza a
partir dele e as duas análises comparam contra ele. Excluir a atual deixaria
três telas sem chão. Regra: excluir só quem não é a atual — para trocar a
atual, restaura-se outra primeiro.

**4. Renomear é o que torna a lista utilizável.**

Não é cosmético: é a correção do defeito descrito acima. Junto disso, o rótulo
padrão no salvamento precisa nascer distinguível — data mais um sinal do que
mudou — senão a lista volta a encher de homônimos na semana seguinte.

**5. Salvar sem mudança não deveria criar versão.**

Os três `ATS EN 2026-07` provavelmente vieram de salvamentos repetidos. Comparar
o conteúdo com o da versão atual e não gravar quando forem iguais elimina a
maior fonte de lixo do histórico, e custa uma comparação de string.

**6. Comparar duas versões.**

Com 8.227 contra 8.228 caracteres, nenhuma coluna da tabela permite escolher.
Um diff por linha entre duas versões selecionadas é o que transforma a lista em
decisão. É também o que dá sentido a restaurar.

---

#### Forma

Modal, e não expansão na página: o histórico já mora no rodapé de uma página
longa, e as três operações são destrutivas ou quase — merecem foco e confirmação
explícita, não um clique perdido no meio da rolagem.

Ilha de cliente, como o editor. As ações são Server Actions sob
`candidate:write`; a de exclusão exige confirmação que nomeie a versão, porque
rótulos parecidos é exatamente o que esta tarefa existe para resolver.

**Acessibilidade:** o modal precisa de foco preso, `Escape` para fechar e
retorno do foco ao gatilho. Os botões de linha ficam sempre visíveis — apareceu
no ajuste de A11Y de 19/08 que controle que só existe no hover é controle que
não existe para quem navega por teclado.

**i18n:** todo rótulo pelo dicionário, incluindo os de confirmação. O rótulo da
versão em si é dado do usuário e leva `data-user-content`.

---

#### Entregue em 19/08/2026

Modal em `<dialog>` nativo — foco preso, `Escape` e backdrop do navegador, sem
dependência de biblioteca. Ver (renderizado e markdown cru), restaurar,
renomear e excluir, com confirmação que **nomeia** a versão.

As regras vivem em `src/core/candidate.ts` e estão travadas por 15 testes em
`tests/candidate-versions.test.ts`:

- Restaurar acrescenta; `is_current` nunca volta para trás.
- A versão atual não se exclui nem se restaura — os botões nem aparecem na
  linha dela.
- Versão citada por `application.cv_variant` não se exclui, e a recusa **nomeia
  as candidaturas** que a prendem.
- Toda operação filtra por `candidateId`: id vindo de formulário é pedido, não
  prova.
- Salvar sem mudança não cria versão. Era a fonte dos três `ATS EN 2026-07`.
- `documentHistory` desempata por `id`, porque `created_at` empata dentro do
  mesmo milissegundo e ordem instável faz clicar na linha errada.

Cada linha mostra a diferença de tamanho contra a atual: os três homônimos da
captura viraram `+672`, `+673` e `+611` caracteres. É o que torna a lista
decidível sem abrir cada uma.

#### O que ficou de fora, e por quê

**Migração de `cv_variant` para chave estrangeira.** A proteção contra excluir
uma versão que o funil diz ter enviado está na camada de aplicação, e funciona
— mas quem garante é o código, não o banco. Uma escrita por outro caminho
(script, CLI, SQL direto) passa por cima. `ON DELETE RESTRICT` fecharia isso de
vez.

> **Este parágrafo ficou desatualizado — ver M-05.** A migração foi feita nas
> 0015–0018, com chave composta `(candidate_document_id, candidate_id)` e
> `ON DELETE RESTRICT`. Quem garante agora é o banco.

**Diff entre duas versões.** Hoje se vê uma por vez. A diferença de tamanho
resolve *escolher*; um diff por linha resolveria *entender o que mudou*, que é
outra pergunta.

### UI-03 · Reconferir se a vaga ainda existe ✅

Pedido em 19/08/2026. Vaga não é permanente: o link expira, a empresa fecha a
posição, o quadro remove o anúncio. Nada disso chegava até aqui sozinho — a
sincronização só sabe o que a fonte ainda lista, e **várias fontes continuam
listando anúncio morto**.

**Medido ao ligar:** 300 conferidas, 35 mortas. Todas do Lever — **16% dos
links** entre os melhores ranqueados devolviam 404 enquanto a API os dava como
abertos. O Lever é a maior fonte do acervo (4.357 vagas abertas). Um em cada
seis cliques ia para o vazio.

#### Como ficou

Dois caminhos alimentam a **mesma** fila:

- **Botão** no detalhe da vaga, para quem está olhando e quer saber agora.
  Enfileira e volta; sondar dentro do clique penduraria a página pelo tempo de
  rede de um site de terceiro — e é justamente no link morto que ele demora
  mais, até o timeout.
- **`jho jobs recheck queue`**, que enfileira as há mais tempo sem conferência.

Uma fila só porque o trabalho é idêntico e a diferença é apenas prioridade. Duas
significariam dois backoffs, dois lugares para um claim vazar, e a chance de as
duas discordarem sobre o que um 403 prova.

Tabela `verify_task`, no mesmo padrão de `scrape_task` (ADR 0009): claim atômico
por `UPDATE ... RETURNING`, backoff, e recuperação de claim abandonado.
Separada de `scrape_task` porque o ciclo de vida é outro — captura acontece uma
vez, reconferência **se repete**.

Colunas novas em `job`: `checked_at`, `check_status`, `check_code`. Guardar
quando foi a última conferência é o que torna a varredura progressiva: o lote
antigo ordenava por fit e reconferia as mesmas 200 para sempre, sem nunca
alcançar a cauda.

**`alive` reabre uma vaga fechada.** Sem isso, um 404 transitório sumiria com
ela para sempre.

#### Agendado em 21/08/2026

`.github/workflows/varredura.yml`. Nada foi instalado na máquina de ninguém —
era essa a objeção que deixou o item aberto —, e o disparo mora no mesmo lugar
que já roda os testes.

Roda contra **produção**, todo dia às 06:00 UTC, e faz a varredura inteira:
buscar (`jobs sync`), capturar descrição (`scrape queue` + `run`) e reconferir
(`jobs recheck queue` + `run`).

**Por que não a rota da Vercel, que já existia.** `/api/cron/recheck` processa
25 vagas por execução, porque o teto de função no plano gratuito é de 30
segundos. Contadas as elegíveis — abertas, com URL, fit ≥ 55 — são **427**, o
que dá um ciclo de ~17 dias contra a meta de 7 declarada no próprio
`enqueueStale`. A rota entrega menos da metade do que promete, e não por
defeito: por teto. Um runner do GitHub tem 6 horas por job. Ela continua no ar
como rede de segurança.

E a **busca** nunca teve onde rodar na Vercel: `jobs sync` e `scrape run` não têm
rota de API. Até aqui, achar vaga nova dependia de alguém abrir o laptop.

O passo final confere `jho sources list`, porque `syncAll` não aborta quando uma
fonte quebra — decisão certa, e cujo efeito colateral é a falha ficar silenciosa
até alguém olhar. Uma fonte fora é aviso; mais da metade é erro, porque aí a
causa é comum.

#### O que ficou de fora

**Status da vaga além de aberto/fechado.** Hoje o veredito é vivo, morto ou sem
resposta. "Pausada", "preenchida" e afins exigiriam ler a página, não só o
código HTTP — outro problema.

### UI-04 · Cadastro de vaga por recrutador, com rótulo de origem ✅

#### Entregue em 20/08/2026

`/jobs/new`, chamando o mesmo `addManualDescriptionJob` da CLI — a interface é
adaptador, não segunda implementação. `recruiter` entrou em
`MANUAL_SOURCE_KINDS`, e o rótulo deriva de `source.kind` na leitura, via
`jobOrigin()`.

`web` fica sem rótulo de propósito: é a maioria esmagadora do acervo, e marcar
o comum faz o incomum desaparecer no meio.

**Dois ajustes que o teste em browser forçou:**

A atribuição virou melhor esforço. Uma chave estrangeira que não resolve
derrubava o cadastro inteiro e a pessoa perdia o que digitou — e o caso não é
hipotético, o modo aberto sintetiza sessão com `userId: 0`, que não é linha
nenhuma em `auth_user`. Vaga sem atribuição é um campo vazio; vaga não
cadastrada é trabalho perdido.

A vaga é pontuada na hora, para todos os candidatos. A ingestão em lote só
invalida e deixa o cálculo para `jho jobs score`, o que é certo para milhares
vindos do sync — mas aqui alguém acabou de digitar e vai procurar: sem score ela
não aparece em lista nenhuma e a pessoa conclui que falhou.

**Fica de fora, como o texto acima previa:** recrutador editar vaga alheia,
direcionar vaga a um candidato (precisa de F-05) e moderação por admin.

### AUTH-01 · Autenticação e autorização ✅

Detalhamento completo em [`task-auth.md`](task-auth.md).

Pré-requisito de deploy, multi-candidato e do painel de admin do catálogo. Hoje
o dashboard não tem autenticação — defensável em loopback para um usuário, e foi
exatamente o que transformou um bind errado em vazamento do currículo inteiro na
rede local (ver `docs/security.md`).

A parte que costuma ser feita errado e está explícita nos critérios de aceite:
**escopo por candidato precisa nascer da sessão e atravessar até a query**.
Filtrar na UI é cosmético — uma Server Action com id trocado devolve o dado de
outra pessoa.

Entra por porta, como todo módulo (regra 4): `IdentityProvider` absorve link
mágico hoje e OAuth depois; `SessionStore` é tabela agora e Redis quando houver
mais de um processo. A decisão de permissão é função pura `can(session, action,
resource)`, que é onde bug de autorização mora e onde teste exaustivo é barato.

**Entregue (19/08).** `src/contexts/auth/` com domínio puro, duas portas, casos
de uso e infra Drizzle. 33 testes.

Decisões que valem registrar:

- **Sem senha em lugar nenhum.** Link mágico de uso único e curto. Não há o que
  guardar, o que vazar, nem o que reaproveitar de outro site.
- **Só hash, nunca o token.** Vale para sessão e para link. Cópia do banco não
  pode ser cópia das credenciais de todo mundo — mesma razão da regra 13.
- **Logout revoga no servidor.** Cookie que o cliente apaga continua válido
  para quem copiou.
- **Conta desabilitada perde acesso na hora**, não no vencimento da sessão.
- **Admin não lê o CV de candidato.** Curar o catálogo global não é ser
  superusuário; juntar os dois é como "admin" vira "lê a pretensão salarial de
  todo mundo".
- **`single-user` é modo de verdade**, não gambiarra. Login contra si mesmo em
  loopback é teatro, e teatro que irrita acaba desligado. O guard roda igual
  nos dois modos, então o caminho multiusuário não é um ramo que ninguém
  exercita.

**O que o teste de arquitetura trava:** toda Server Action tem guard, nenhuma
aceita `candidateId` da própria entrada, e a política não importa banco, cookie
nem Next.

### AUTH-02 · Tela de administração de usuários ✅

Pedido em 20/08/2026, na sequência dos três papéis. `UserDirectory` está
declarada em `src/contexts/auth/ports.ts` com oito métodos — `list`, `find`,
`create`, `updateRoles`, `setDisabled`, `linkedCandidates`, `linkCandidate`,
`unlinkCandidate` — e é a **única porta do contexto sem adapter**. As outras
quatro (`SessionStore`, `IdentityProvider`, `AuthRepository`,
`PasswordVerifier`) já têm a sua em `infra/`.

**Contexto que restringe a solução.** A parte difícil já foi decidida e está
travada por teste: `admin:access`, `user:manage` e `user:impersonate` exigem
papel admin; `ADMIN_ACTIONS` é negado **em bloco** quando
`session.impersonatedBy !== null`, antes de olhar papel nenhum, justamente
para o caso admin-assume-admin; e `auth_session.impersonated_by` existe no
schema. O modelo está inteiro e a instalação não tem como exercitá-lo — hoje
conta se cria pela CLI e papel se troca por SQL. É a distância entre a
política estar certa e a política estar em uso.

---

#### Decisões que a implementação precisa tomar

**1. Assumir identidade cria sessão nova; não muta a existente.**

`startImpersonation` insere uma linha em `auth_session` com
`impersonated_by = <id do admin>` e troca o cookie para ela. Mutar a sessão do
admin apagaria o caminho de volta: sair da identidade emprestada precisa
restaurar um estado anterior, e uma sessão mutada não tem estado anterior
guardado em lugar nenhum. Também separa as revogações — derrubar a emprestada
não pode derrubar a do admin, e vice-versa.

A consequência a aceitar de olhos abertos: como o sistema guarda **hash** de
token e nunca o token (AUTH-01), `stopImpersonation` não tem como devolver o
cookie antigo. Ele revoga a emprestada e emite uma sessão nova para o admin.
O admin perde a sessão original ao voltar. É o preço de não guardar
credencial recuperável, e é o lado certo do trade-off.

**2. `AUTH_EVENTS` precisa de dois kinds novos, e a coluna não vai avisar.**

A lista hoje tem seis (`login`, `login_failed`, `logout`, `session_expired`,
`denied`, `role_changed`) e nenhum descreve impersonação. `auth_event.kind` é
`text` livre: gravar um kind fora da constante **funciona**, e é exatamente
assim que um registro passa a mentir por omissão — a auditoria continua
parecendo completa. `impersonation_started` e `impersonation_ended` entram na
constante, com `detail` nomeando o alvo, e o par abre-fecha é o que torna a
sessão emprestada auditável: sem o fim, não se sabe até quando durou.

**3. A tela mostra `UserSummary` e nada além dele.**

O tipo já decidiu o recorte: id, e-mail, papéis, `candidateId`, `disabledAt`,
`createdAt` e `hasPassword` — booleano de propósito, dizendo que existe senha
sem dizer nada sobre ela. E a linha do usuário **não pode virar atalho para o
perfil**: a política nega `candidate:read` a admin de propósito, com o
comentário explicando que curar a instalação não é ser superusuário. O
caminho até o dado privado é assumir a identidade, e assumir deixa registro.
Um link "ver currículo" na tela de admin desmontaria o desenho inteiro.

**4. Desabilitar revoga na hora, ou a garantia de AUTH-01 é falsa.**

`setDisabled(userId, true)` sem `revokeAllFor(userId)` deixa a sessão viva até
vencer — e AUTH-01 entregou explicitamente "conta desabilitada perde acesso na
hora, não no vencimento da sessão". As duas operações andam juntas no caso de
uso, não na tela: quem chamar a porta por outro caminho precisa da mesma
garantia.

**5. Banner de sessão emprestada: persistente, no layout, sem como dispensar.**

Derivado de `session.impersonatedBy`, em toda página, nomeando o alvo e com o
botão de sair. Não é enfeite de segurança: um admin que esquece que está
emprestado escreve como outra pessoa, e a única coisa que separa auditoria de
falsificação é o operador saber em nome de quem age. Estado de cliente
dispensável (um "×" que some) reintroduz exatamente o esquecimento que o
banner existe para impedir.

**6. Navegação de admin condicionada por `can()`, não por papel lido no JSX.**

O item de nav aparece sob `admin:access`. Ler `session.roles.includes("admin")`
dentro do componente cria uma segunda decisão de permissão fora de
`policy.ts`, que é a origem do bug clássico: a nav esconde e a rota deixa
entrar. E o rótulo vem do dicionário — regra 9, procurando a chave existente
antes de criar (`nav.appearance` já existia sem uso quando foi procurada).

**7. O último admin não se desabilita nem perde o papel.**

`updateRoles` removendo `admin` do único admin restante deixa a instalação sem
quem administre, e o conserto é SQL na mão. A recusa mora no caso de uso e não
no formulário, porque a CLI chama a mesma porta.

---

#### O que fica de fora, e por quê

**Convite por e-mail para a conta criada.** Depende de F-05. Até lá o admin
cria a conta e entrega o acesso pelo caminho que já existe — `jho auth login`
imprimindo o link no terminal, o que só serve para quem tem o terminal. É
justamente essa limitação que faz F-05 vir logo em seguida.

**Papéis customizados e permissão granular.** `ROLES` é uma tupla fechada de
três de propósito: cada papel novo multiplica os casos de `can()`, que é onde
bug de autorização vira vazamento. Papel novo entra por decisão, não por
formulário.

**Navegar a auditoria pela interface.** `auth_event` é gravado e consultável
por SQL. Uma tela de log é útil e é outra tarefa — inclusive porque precisa
decidir retenção, e retenção de registro de acesso é decisão de política.

#### Entregue em 20/08/2026

`/admin/users` lista contas, cria, edita papéis, desabilita e assume identidade.
Adapter `drizzleUserDirectory`, casos de uso `startImpersonation` /
`stopImpersonation` gravando em `auth_event`, banner de sessão emprestada e item
de menu só para admin de sessão própria.

**Duas portas dos fundos fechadas durante a implementação**, ambas apontadas
pelos testes de arquitetura e nenhuma óbvia ao escrever:

1. **Admin vinculando recrutador a candidato.** Bastaria vincular a si mesmo
   como recrutador para ler qualquer currículo, desviando da impersonação
   auditada. Criar vínculo saiu da administração: é ação do candidato, que
   consente. Admin só **revoga**, e por id do vínculo — assim nenhuma tela de
   administração passa id de candidato adiante.
2. **Admin criando conta apontada para um candidato existente.** Mesmo efeito
   por outro caminho: criar a conta, entrar nela, ler tudo. Agora conta com
   papel de candidato provisiona um candidato PRÓPRIO, com slug derivado do
   e-mail.

**Um defeito de segurança que só o browser pegou:** `impersonated_by` não estava
no INSERT da sessão. A política estava correta e o dado que ela lê nunca
chegava, então a sessão emprestada era indistinguível de uma normal — sem
banner, com menu de administração e com poder de admin. `tests/auth-session.test.ts`
cobre o campo agora.

`requirePage` passou a responder **403** em vez de deixar a exceção subir como
500: negação que parece crash mostra stack em desenvolvimento e não distingue
"não pode" de "quebrou".

Rejeitar o rebaixamento ou a desabilitação do último admin ativo é regra
explícita — sem ela a recuperação seria SQL na mão.

### AUTH-03 · Visibilidade do perfil na área do candidato ✅

#### Entregue em 20/08/2026

Cartão no topo de `/candidate`, acima do currículo: é a decisão que governa tudo
o que vem depois, e enterrá-la no rodapé produziria o pior caso — alguém que
tornou o perfil público sem perceber e não tem motivo para rolar até lá.

O aviso do que "público" significa fica **sempre** visível, não só quando a
opção está marcada: quem já está público precisa lê-lo mais do que quem está
prestes a ficar. E a lista do que nunca aparece — e-mail, telefone, funil,
candidaturas — está na tela, não só na documentação.

`setVisibility` valida contra a lista antes de gravar. A coluna é texto e a
política decide com base nela: gravar `"publico"` com erro de grafia deixaria o
perfil num estado que nenhum ramo reconhece, e o padrão de negar salvaria por
acaso e não por desenho.

O e2e vai e volta ao estado original — um teste que deixa o perfil mais exposto
do que encontrou é pior que teste nenhum.

**De quebra, um defeito na própria suíte:** o e2e rodava com uma conta só, que é
admin e candidato ao mesmo tempo. Sem uma segunda conta não havia quem assumir, e
a verificação de impersonação passava por falta de alvo em vez de por funcionar.
O `setup.mjs` agora semeia contas por papel — candidato puro, recrutador sem
vínculo e um alvo dedicado —, que é o primeiro passo do E-06.

### AUTH-04 · Página pública de portfólio ✅

#### Entregue em 20/08/2026

`/p/[slug]`, e as sete decisões do texto acima foram seguidas.

`publicProfile()` monta o objeto por **lista de permissão** e a página não tem
acesso ao registro do candidato — não é disciplina, é o tipo dizendo não. O
teste afirma o conjunto exato de chaves por IGUALDADE, e não por "não contém":
"não contém e-mail" passaria com um campo novo que ninguém previu; o conjunto
exato falha na hora em que alguém acrescenta coluna ao schema, que é exatamente
quando se quer ser avisado.

Segundo consentimento (`candidate.public_cv`) para o texto do currículo, e ele
só vale enquanto o perfil for público — quem marcou o CV e depois voltou para
privado não fica com consentimento pendurado, pronto para reabrir sozinho.

404 para perfil não público, `noindex, nofollow` sempre, e só skills
**confirmadas**. Verificado de um contexto anônimo de verdade: privado 404,
público 200 sem e-mail e sem currículo, e volta a 404 ao fechar.

**Ficou de fora:** limite de requisição por IP e resposta cacheada (decisão 7).
A rota abre uma consulta ao banco por requisição sem conta para limitar, e um
varredor de slugs custa pouco. Item próprio no backlog.

### F-05 · Resend para e-mail transacional e recuperação de senha ✅ (código completo; falta a credencial do usuário)

#### Entregue em 20/08/2026

Porta `Mailer`, adapter Resend, e queda para o terminal quando não há chave —
como o link mágico já fazia. **Ausência de chave não é erro:** falhar o cadastro
de conta porque não há provedor de e-mail configurado transformaria um detalhe
de infraestrutura em bloqueio de produto.

As duas variáveis são necessárias. Só a chave, sem remetente, não configura
nada: o Resend recusa envio sem `from` de domínio verificado, e descobrir isso
na hora do envio seria tarde.

**Três disciplinas no fluxo de recuperação, e nenhuma é opcional:**

A resposta nunca diz se o endereço existe — mesma URL, mesmo texto, redigido
como "se existir uma conta com esse endereço". Um formulário que responde "não
encontramos esta conta" é um oráculo de enumeração aberto ao mundo. Verificado
no browser, de contexto anônimo: as duas respostas são idênticas byte a byte, e
o token só é gerado para a conta que existe.

O token vale uma hora — não os quinze minutos do link de login, porque quem
esqueceu a senha costuma buscar o e-mail em outro dispositivo — serve uma vez,
e é queimado antes de a senha nova ser gravada. Token inexistente, expirado e
usado dão a mesma resposta: cada distinção é pista para quem adivinha.

Trocar a senha derruba **todas** as sessões. Quem recupera a senha costuma
fazê-lo por suspeitar de acesso indevido; manter as antigas devolveria o acesso
a quem já estava dentro.

**Dois detalhes que o teste forçou:** o erro do provedor não carrega o
destinatário (o corpo do Resend cita o e-mail; só o status sobe), e a tela
confere o token **antes** de mostrar o campo de senha — senão a pessoa digita
a senha nova e só então descobre que o link morreu.

**A credencial é sua.** `RESEND_API_KEY` e `RESEND_FROM` em `.env.example`;
nenhum agente pode gerá-las.

### E-01 · Arquitetura hexagonal, DDD, monolito modular ✅

Decisão em andamento por painel de propostas independentes e julgamento por
múltiplas lentes. Saída: `docs/adr/0007`.

Restrição que elimina a maioria dos frameworks de DDD: **só sintaxe TypeScript
apagável** — sem decorators, sem containers de DI convencionais.

### E-02 · Análise estatística do matching ✅

Medir a qualidade do match em vez de assumir que os pesos estão certos:

- Distribuição e percentis de score; onde está o joelho da curva de corte
- Poder discriminante de cada componente — algum é redundante?
- **TF-IDF do corpus de alto fit contra o perfil**, para descobrir keywords que
  faltam em `profile.yaml`. É o item mais acionável desta lista: o mercado diz
  quais termos importam, em vez de o candidato adivinhar.
- Distribuição salarial por cluster, como base de negociação
- Quando houver resultado de candidatura: o score prediz avanço no funil?

### E-03 · Submissão autônoma por agentes ✅ decidido (ADR 0010) — preparar sim, enviar não

O cadastro por URL (✅ `jho jobs add`) é o primeiro degrau. Submissão automática
exige preencher formulários de ATS, o que reabre questões de termos de uso por
plataforma — avaliar caso a caso, com o mesmo rigor da ADR 0001.

**Decisão (ADR 0010): preparar é automatizado, enviar é do usuário.**

O argumento não é técnico. Este produto foi construído sobre a medição de que o
gargalo é a decisão, não o envio. Automatizar o envio antes de a triagem estar
calibrada acelera o gargalo errado — é o que a categoria de auto-appliers faz,
e é por isso que a taxa de resposta deles desaba. Some-se que `jho stats` mostra
poder estatístico nulo no funil: submeter automaticamente hoje seria automatizar
um critério que ninguém verificou.

**Entregue:** `jho prep <id>` monta o dossiê — bloqueadores primeiro, rede na
empresa, evidências do perfil cujo vocabulário aparece naquele anúncio, lacuna
de vocabulário daquela vaga, e os requisitos declarados. Ataca o custo real:
uma boa candidatura leva de 40 a 90 minutos, e a maior parte é remontar contexto
que o sistema já tem. Preparar é reversível e não representa ninguém.

**Reavaliar quando:** ≥30 candidaturas com desfecho, plataforma cujos termos
permitam por escrito, e aprovação explícita por vaga. Faltando qualquer uma, a
resposta segue sendo não.

### E-04 · Scraper por perfil do candidato ✅

Encaixa como mais um adapter da porta de fontes — o domínio não muda.

> **Invariante:** raspar career pages próprias e sites cujo `robots.txt`
> permite é território tranquilo. O LinkedIn continua fora, e com os job alerts
> por e-mail (F-01a) não há necessidade de cruzar esse limite.

**Entregue (19/08):** adapter `careers`, mais uma implementação da porta de
fontes — o domínio não mudou, como previsto. `handle` é a URL da listagem,
`label` é o empregador. `robots.txt` verificado antes de cada requisição, tanto
da listagem quanto de cada vaga.

Vagas são encontradas pela **forma da URL**, não por seletor de CSS: cada site
nomeia sua marcação de um jeito, e seletor para página que não podemos abrir
apodrece no próximo deploy. O texto da âncora é dividido em título e local,
porque link de career page costuma embrulhar cargo, escritório e "Read more"
no mesmo elemento — e "Account Executive London Read more" não casa com cluster
nenhum, zerando a nota por motivo de formatação.

**Resultado que confirma a tese do acervo:**

| Fonte | Vagas | Fit médio |
|---|---:|---:|
| **careers:vercel** | 40 | **50,4** |
| careers:anthropic | 40 | 43,2 |
| lever:jobgether (anônima) | ~4.500 | 38,4 |
| himalayas | ~1.200 | 32,7 |

Empregador nomeado tem o melhor fit médio do acervo inteiro.

**Limite honesto:** só listagem renderizada no servidor. Página que monta a
lista no navegador devolve zero e diz isso, sugerindo `jho sources snippet`.

---

### E-05 · Estrutura de documentação do CompozyOS: epic, PRD, techspec, ADR ✅

#### Entregue em 20/08/2026 — opção 2, com a jornada junto

A decisão está em **[ADR 0011](../adr/0011-fronteira-compozyos-e-docs.md)**:
conviver por fronteira, e a fronteira é o **ciclo de vida**. `.compozy/tasks/`
guarda o que nasce e morre com a feature; `docs/` guarda o que sobrevive a ela.

O argumento que fechou a questão é o que este próprio item levantou: **qualquer
resposta é uma ADR, e o CompozyOS não teria onde guardá-la.** Isso não é
retórica — é a demonstração de que os dois gêneros têm ciclo de vida diferente.

A opção 3 ("não adotar, rodar uma jornada primeiro") foi seguida pela metade e
deliberadamente: a ADR vem **acompanhada** da primeira jornada, feita numa
feature pequena e genuinamente pendente — o limite de requisição que a AUTH-04
deixou de fora. O que aquela recomendação evita é decidir no escuro, não decidir.

**A jornada, em `.compozy/tasks/perfil-publico-limite/`:** `_spec.md` com parte
de produto e parte técnica, `_tests.md` com dez casos numerados, `_tasks.md` com
o grafo — e cada caso caindo em exatamente uma tarefa. Os testes carregam o
identificador do contrato, para contrato e teste não divergirem em silêncio.

**O ciclo achou o que era para achar.** Sem proxy, `clientKey` devolve
`"sem-proxy"` para todo mundo e o balde é um só: a rajada de verificação
derrubou quatro checagens do portfólio com 429. Não é defeito do teste — é a
limitação real da degradação conservadora, agora escrita no `_spec.md` com a
combinação a evitar (exposto direto, sem proxy à frente).

Escrever o contrato **antes** mudou o resultado: UI-02 e UI-03 tiveram o "o que
ficou de fora" redigido depois da entrega; aqui o atrito foi registrado enquanto
acontecia.

**Migrar tudo continua rejeitado**, com os números no ADR: 63 referências a
`docs/adr` em 23 arquivos, incluindo as regras invioláveis de `CLAUDE.md`, e um
`context-map.md` que `pnpm check` abre por caminho literal.

Um teste de fitness novo mantém o índice de ADRs honesto — ele listava seis de
dez, e as quatro faltantes eram justamente as citadas como invariantes.

### E-06 · Cenários de teste por papel, ponta a ponta ✅

#### Entregue em 20/08/2026

O corte proposto foi seguido: a matriz de permissão **não** foi reproduzida em
browser. Ela já está em teste puro, e repeti-la aqui custaria um login e uma
navegação por combinação que hoje leva microssegundos.

O que entrou é percurso: contas por papel semeadas pela mesma API que o operador
usa, e para cada uma o que deve abrir e o que deve negar. Mais o caso da conta
desabilitada, que não entra nem com a senha certa.

**O defeito que este item previu existia mesmo.** Verificado antes de corrigir:

    recrutador   login->/   / =403   /jobs=403   /compare=403
    candidato    login->/   / =200   /jobs=200   /compare=200

Um recrutador entrava com a senha certa e recebia 403 em toda tela. Duas causas
somadas: `passwordLoginAction` mandava todo mundo para `/`, e `/jobs` guardava
com escopo de candidato embora a política conceda `job:read` aos três papéis.
Cada metade estava correta sozinha — e é por isso que nenhum teste puro a via.

Corrigido decidindo, não congelando: `/jobs` passou a guardar por `job:read`, e
`listBoard`/`countBoard`/`boardFacets` aceitam escopo nulo. Nota de aderência e
estado de candidatura continuam por candidato — são COLUNAS, e voltam nulas para
quem não tem escopo. O predicado é `1 = 0` explícito, e não um id sentinela: um
`-1` faria o mesmo e mentiria sobre a intenção.

O login passou a mandar cada papel para uma tela que é dele. E `/jobs` saiu da
lista de páginas com guarda de candidato no teste de arquitetura, com o motivo
escrito lá — a lista fixava o defeito como especificação.

Confirmado que o cenário detecta a volta do defeito: com o redirect antigo, ele
reprova com "caiu em /, esperado /jobs".

### UI-05 · Transformar o dashboard em PWA ✅

#### Entregue em 20/08/2026

Desenho replicado do `contas_casal`: caches versionados por tipo, estratégia por
tipo, limpeza das versões antigas no `activate`, lista de exclusão explícita e
versão injetada a partir do `package.json`.

**A decisão central foi respondida assim: não existe `pages-` nem `api-`, e a
ausência É a política.** O `contas_casal` cacheia página autenticada porque tem
a contrapartida — uma fronteira de sessão offline que apaga Dexie, Cache
Storage, fila de uploads e outbox como operação observável, recusando renderizar
a próxima conta se qualquer etapa falhar. Copiar o cache sem copiar essa máquina
seria copiar o risco sem a mitigação. E o argumento levantado neste item é ainda
mais forte: **limpar no logout não fecha o buraco**, porque `logoutAction` não
roda em sessão vencida, aba fechada ou aparelho perdido.

Cacheia `static-` (JS, CSS, fontes, ícones, manifest) e `shell-` (`/login`,
`/offline`). Mais nada. `/p/` está na exclusão apesar de público: é público por
escolha do candidato, e a escolha pode ser revogada — uma cópia em disco não
obedeceria à revogação.

**Uma melhoria sobre o original.** Lá, o `prebuild` injeta a versão e o
`postbuild` devolve o placeholder; funciona porque a Vercel fotografa o
artefato. Com `next start` lendo `public/` do disco, restaurar antes de servir
entregaria `CACHE_VERSION = "__APP_VERSION__"` literal, e todo cache se chamaria
`static-__APP_VERSION__` — nenhum deploy invalidaria nada. Aqui
`scripts/sw-template.js` é a fonte e `public/sw.js` é gerado e ignorado pelo git.

**O achado sobre `start_url` estava certo.** Um manifest não varia por papel, e
com `start_url: "/"` o recrutador abriria o app instalado em 403 — a E-06 voltando
pela porta do manifest. Corrigido onde a causa estava: `/` agora REDIRECIONA
quem não tem escopo de candidato, em vez de negar. Verificado por papel no e2e.

Ícones gerados sem dependência (`scripts/make-icons.mjs` escreve o PNG chunk a
chunk), com variante `maskable` na zona segura de 80%.

### B-05 · `runFetchStage` ultrapassa o `--limit` com concorrência ✅

`src/core/scrape/fetcher.ts:180`. O worker testa `result.processed >= limit`,
**depois** faz `await queue.claim(...)`, e só então incrementa. Entre o teste e
o incremento há um `await`, e com N workers todos podem passar pelo teste no
mesmo tick: até **N−1 tarefas além do limite** são capturadas.

O padrão é `concurrency: 4`, então `--limit 300` pode virar 303 requisições a
sites de terceiros. Não é catastrófico, e é exatamente o tipo de erro que fica
anos sem ser notado porque o número está quase certo: o operador pede um lote e
o relatório volta com um total que ele não pediu.

**Correção:** reservar antes do `await` — incrementar `processed` no momento do
teste e devolver a reserva se o `claim` vier vazio. Contador só é confiável
quando teste e reserva acontecem sem `await` no meio.

**Fica de fora:** semáforo ou mutex de verdade. É um contador em memória, num
processo só; a reserva otimista basta.


#### Entregue em 20/08/2026

A reserva do slot passou a acontecer de forma **síncrona**, antes do `await` do
`claim` — e é isso que a torna atômica, porque o laço de eventos não interrompe
código síncrono. O contador de reservas é separado de `processed`: a reserva é
devolvida quando a fila esvazia, senão um worker que não achou nada consumiria
um slot e a execução seguinte pararia antes do limite pedido.

O teste afirma também que a RESERVA para, e não só a contagem: `claim` a mais
seria trabalho extra contra site de terceiro mesmo com o número certo no fim.
Confirmado que reprova com o código antigo.

### M-05 · `application.cv_variant` como chave estrangeira ✅ (já estava feito quando foi cadastrado)

Levantado no fim de UI-02 como o que faltava, virou item próprio em 20/08/2026
— e **conferido contra o código, já está entregue**, de forma mais forte do que
a proposta.

As migrações `0015_expand` → `0016_backfill` → `0017_contract` →
`0018_enforce_candidate_document_ownership` fizeram o ciclo inteiro: coluna
nova, resolução dos rótulos antigos, remoção de `cv_variant`, e **reconstrução
da tabela** — porque `ALTER TABLE ... ADD ... REFERENCES` no SQLite aceita a
cláusula `ON DELETE` e a ignora, a mesma armadilha registrada no CLAUDE.md e o
motivo do `0025_fix_auth_user_fk_on_delete.sql`.

A chave que ficou é **composta**: `(candidate_document_id, candidate_id)` →
`candidate_document(id, candidate_id)`, com `ON DELETE RESTRICT`. Garante mais
do que se pediu — além de impedir apagar uma versão que o funil diz ter
enviado, impede apontar para o documento de **outro** candidato. E
`src/core/candidate.ts:331` já lê `application.candidateDocumentId`, não o
rótulo.

O detalhe de 0016 vale guardar: rótulo ambíguo ou sem dono exato ficou **nulo**,
com o comentário dizendo por quê — "no document is better than a fabricated
audit trail". É a regra 8 aplicada a migração.

**O que este item corrige de fato:** o cabeçalho de UI-02 e o "o que ficou de
fora" dele, que ainda descreviam a migração como pendente. Anotado lá.

### E-07 · `auth_event.user_id` perde a atribuição ao apagar a conta ✅

`src/core/db/schema.ts:1018` declara `ON DELETE SET NULL`. Quando este item foi
escrito não existia exclusão de conta — `setDisabled` desabilitava, e nenhum
caminho apagava `auth_user`. Era uma decisão tomada por antecipação, e tomada
para o lado errado.

> **A antecipação se pagou.** AUTH-05 trouxe a exclusão em 21/08/2026, e o teste
> `cov-auth-nome-e-exclusao` confirma no banco o que este item resolveu antes de
> precisar: depois de apagar a conta, `user_id` fica nulo e o `email` continua
> lá. Sem a correção de `record()`, a auditoria teria ficado íntegra na aparência
> e vazia no conteúdo.

No dia em que houver exclusão, as linhas históricas continuam existindo e param
de dizer **quem**. Numa tabela cuja razão de existir é provar exatamente isso —
quem entrou, quem falhou, quem assumiu a identidade de quem — a auditoria fica
íntegra na aparência e vazia no conteúdo.

Amortece um pouco: a linha guarda `email` denormalizado. Mas `record()` grava
`input.email ?? null`, ou seja, é opcional e depende de quem chamou. Não é
garantia, é acaso.

**A decisão não é técnica, é de política:** `RESTRICT` (não se apaga conta com
histórico), `SET NULL` com `email` **obrigatório** na escrita, ou anonimização
explícita que registre que houve anonimização. As três são defensáveis; a atual
é a única que perde o dado sem dizer que perdeu. E pertence à mesma decisão de
retenção que AUTH-02 adiou ao recusar a tela de log.


#### Entregue em 20/08/2026

Escolhida a segunda das três opções: **`SET NULL` com o e-mail resolvido na
escrita**. `record()` agora busca o endereço quando recebeu `userId` sem
`email` — antes era opcional e dependia de quem chamou lembrar, ou seja, não era
garantia, era acaso.

`RESTRICT` foi considerado e recusado: tornaria impossível apagar qualquer conta
que já tenha entrado uma vez — todas —, e um pedido legítimo de exclusão
passaria a esbarrar na auditoria. Preservar o nome custa uma consulta; impedir a
exclusão custa um direito.

O e-mail informado pelo chamador é respeitado sem consulta: tentativa em
endereço desconhecido grava o endereço TENTADO, e sobrescrevê-lo apagaria a
informação que o evento existe para registrar.

### UI-06 · `externalUrl` devolve booleano e o nome promete URL ✅

`src/contexts/matching/app/manual-comparison.ts:188` —
`externalUrl: isPublicJobUrl(detail.job.url)`. O consumidor de hoje
(`app/compare/page.tsx:90`) trata como sinalizador, e funciona.

O problema é o nome. `href={detail.externalUrl}` compila, passa por qualquer
revisão apressada, e gera `href="true"` — um link para uma rota inexistente do
próprio dashboard. Há teste em `tests/cov-matching-manual-comparison.test.ts`
com um comentário avisando que o nome é armadilha, o que **congela a armadilha**
em vez de removê-la.

`publicPostingUrl()` já existe em `src/core/job-url.ts`, devolve a URL ou
`null`, e é o que `src/core/report/markdown.ts` usa. A correção é trocar o campo
por ele: `null` é falsy, então todo consumidor que hoje escreve `externalUrl &&`
segue funcionando, e quem escrever `href=` passa a receber uma URL de verdade.


#### Entregue em 20/08/2026

`externalUrl` passou a devolver a URL ou `null`, via `publicPostingUrl()`. `null`
continua sendo falso, então quem usava como bandeira não muda de comportamento —
e `app/compare/page.tsx` agora usa o próprio campo no `href`, em vez de voltar a
`detail.job.url`.

### UI-07 · A auditoria de skills registra quando, nunca por quem ✅

`candidate_skill.audited_by` é escrita (`drizzle-adapters.ts:165`) e **não
existe** em `CandidateSkillView` (`src/contexts/skills/domain/types.ts:73`), que
expõe `auditedAt` e para por aí. O dado entra no banco e não tem por onde sair.

E já há duas procedências distintas na mesma coluna: a tela grava `by: "self"`
(`app/candidate/skills/actions.ts:20`) e a CLI não passa nada, deixando `null`.
Duas origens gravadas, nenhuma leitura que as distinga.

Importa porque skill confirmada alimenta o match e o portfólio público — AUTH-04
só publica skill **confirmada**. "Quem confirmou" é a diferença entre uma
afirmação do candidato e uma leitura automática, e é a pergunta que aparece
quando alguém questiona o perfil.

**Decisão que vem junto:** expor `auditedBy` na view é uma linha; o que precisa
ser decidido é o **vocabulário** da coluna — hoje `"self"` e `null`, sem
constante que os liste, do mesmo jeito que `auth_event.kind` era texto livre
antes de AUTH-02. Fechar a lista antes de a tela ler é o que evita repetir
aquele achado.


#### Entregue em 20/08/2026

`auditedBy` entrou em `CandidateSkillView` e na consulta, e a badge da skill
confirmada mostra quem confirmou no `title`. A coluna sempre foi escrita e nunca
lida.

Com três papéis e impersonação, "confirmada" sem autor é afirmação de
experiência sem responsável — e é justamente a afirmação que a regra 6 existe
para o sistema nunca fazer sozinho.

### E-08 · Cobertura de `src/cli.ts`, hoje em zero ✅

2.696 linhas, 1.238 statements descobertos, 0%. O CLAUDE.md anuncia "97,6%
(fora do CLI)", e o parêntese faz bastante trabalho.

**O argumento para deixar como está é bom.** `cli.ts` é fiação do Commander
sobre funções que já têm teste exaustivo; testar o wrapper mede uma biblioteca
de terceiros. Teste de CLI é lento, acoplado a texto de saída, e quebra quando
alguém melhora uma mensagem — vira pressão para congelar a interface no formato
de hoje, que é o mesmo defeito que E-06 encontrou numa lista de exceções.

**O argumento do outro lado é mais forte do que parece.** É a superfície que o
operador usa todo dia, e é a única onde parte das operações existe — nem tudo
que a CLI faz tem tela. Um `pnpm check` verde com 0% ali é um verde que não diz
nada sobre o caminho mais usado do sistema. E E-06 acabou de demonstrar o gênero
de defeito que só a composição revela: cada metade correta, o conjunto quebrado,
nenhum teste puro vendo.

**Corte proposto, a validar:** cobrir os comandos que **escrevem** — `track`,
`jobs add`, `jobs import`, `cv set`, `auth set-password`, `mail accept/dismiss`,
`skills confirm/reject` — porque efeito colateral errado não volta atrás, e o
funil é o único dado que um sync não reconstrói (regra 2). Deixar de fora os que
só imprimem — `list`, `show`, `stats`, `pipeline`, `report` —, cujo teste seria
asserir texto. Meta de cobertura declarada **para o arquivo**, em vez de um
número global que o esconde.

**Fica de fora:** perseguir 100%. O objetivo é que nenhum comando que grava
esteja sem uma passada, não que a métrica fique bonita.

---

## Ordem de execução proposta

A lista anterior foi retirada quando o último item dela foi entregue. Esta
cobre o que está aberto em 20/08/2026, e ordena por risco, não por esforço.

1. **B-04** — `pick()` por presença. É P0 porque perde o nome do empregador
   justamente na fonte que o nomeia, e vaga sem empresa não casa com contato:
   sai do `jho referrals` sem que ninguém perceba. Correção contida em um
   arquivo, com o teste de caracterização já escrito.
2. **UI-06** — `externalUrl`. Troca de uma expressão por `publicPostingUrl()`,
   compatível com todos os consumidores atuais, e desarma um `href="true"`
   antes de alguém escrevê-lo. É a melhor razão entre risco e custo da lista.
3. **B-05** — `--limit` ultrapassado. Reserva antes do `await`. Pequeno, e do
   tipo que fica anos sem ser notado porque o número está quase certo.
4. **UI-07** — `auditedBy`. Depende de fechar o vocabulário da coluna primeiro;
   a leitura em si é uma linha.
5. **E-07** — chave estrangeira do `auth_event`. Não é urgente porque exclusão
   de conta não existe, e é **por isso** que agora é barato: decidir antes de
   haver linha para migrar. Anda junto com a decisão de retenção que AUTH-02
   adiou.
6. **E-08** — cobertura do `cli.ts`. Precisa do corte acordado antes de virar
   trabalho; sem ele vira perseguição de métrica.
7. **UI-05** — PWA. Por último de propósito, e não por falta de valor: enquanto
   a regra 12 mantiver o bind em loopback e não houver deploy com HTTPS, o
   celular não alcança o dashboard e a parte instalável não tem onde ser usada.
   O que dá para adiantar — manifest, ícones, `theme-color` — é pequeno e cabe
   junto do deploy. A decisão sobre cache deve ser escrita **antes** de existir
   qualquer service worker, não depois.

**M-05** não entra na ordem: conferido contra o código, já estava entregue nas
migrações 0015–0018.


#### Entregue em 20/08/2026

`src/cli.ts` de 0% para **39,3%** de statements, com 110 testes. O corte foi o
que este item propôs: parsing de opções, validação de argumento, comandos que
ESCREVEM e código de saída em falha. Ficaram de fora os que só imprimem
relatório — asserir texto formatado congela a interface no formato de hoje — e
os que só chegam à escrita depois de rede, já cobertos contra a mesma porta HTTP
em outros arquivos.

**O número global CAI de 97,5% para 83,5%, e isso é o esperado.** Sem estes
testes o `cli.ts` nunca era carregado e nem entrava no denominador. É exatamente
o motivo pelo qual este item pedia meta declarada por arquivo, e não número
global. Fora do CLI a cobertura continua em 97,7%.

`cli.ts` não exporta nada e termina em `program.parseAsync(process.argv)`:
importá-lo executa a CLI com o argv do vitest. A bancada contorna com uma
subclasse do `Command` real que captura o `program` e chama `exitOverride()` —
sem isso, argumento inválido mata o worker. Subprocesso seria mais fiel e daria
0% para sempre, porque a cobertura V8 instrumenta o worker e não os filhos.

**Refatoração mínima que dispensaria a bancada, anotada e não feita:** exportar
`buildProgram()` e proteger o entrypoint com uma guarda. Dez linhas, e o mock de
`commander` desapareceria.

#### Três defeitos que a cobertura revelou

**`jho auth add-user` estava quebrado para o primeiro acesso** — o default de
`--role` era `owner`, papel que saiu do vocabulário na renomeação. O comando que
a regra 14 manda rodar e que `/login` mostra para quem não tem conta falhava com
"Papel inválido: owner". E a derivação `roles.includes("owner")` virou código
morto: toda conta nascia sem `candidateId`, inclusive uma de papel candidato.
Corrigido, com teste de consistência entre CLAUDE.md, `/login` e `ROLES`.

**`jho track --channel` era aceito e descartado** — a coluna existe, o funil a
renderiza, o CLAUDE.md documenta o comando e o `jho prep` imprime essa linha como
próximo passo, e nada escrevia nela. Referral é ~7% dos candidatos e ~40% das
contratações: sem o campo, o funil não mede a alavanca que o próprio produto diz
ser a mais forte. Agora grava — inclusive quando o status não muda, porque canal
é propriedade da candidatura e não da transição, e um `track` sem a flag não
apaga o que já estava lá.

**`jho tasks done --status` não valida e id inexistente diz que deu certo** —
caracterizado, não corrigido na ocasião. Virou o item **B-07**, entregue.



### AUTH-05 · Nome da conta, edição em modal e exclusão de usuário ✅

Três lacunas da tela de administração, pedidas juntas: não havia como alterar os
dados de uma conta depois de criada, não havia como apagá-la, e o topo do sistema
tratava a pessoa pelo e-mail.

**Nome completo.** Coluna `full_name` anulável em `auth_user` — e não
`not null default ''`, porque string vazia mentiria dizendo que alguém
preencheu, e a interface precisa distinguir "sem nome" de "nome em branco" para
saber quando cair para o e-mail. O nome atravessa `Identity` e `Session` até o
`session-badge`, e o e-mail permanece na sessão justamente para ser a queda.

Essa travessia é o que quase deu errado: declarar o campo como obrigatório no
tipo fez o TypeScript apontar **quatro `select` de produção** que não traziam a
coluna — resolvedor de sessão, link mágico, senha e identidade. Sem o campo no
tipo, cada um devolveria `undefined` em silêncio e o nome nunca apareceria.

**Edição em modal.** Popover nativo, mesmo padrão do modal de vaga: zero
JavaScript enviado, a página segue Server Component. Substituiu o formulário de
papéis embutido na linha — com e-mail e nome entrando, seriam três campos
abertos vezes o número de contas. `setRolesAction` saiu junto, porque Server
Action pública sem consumidor é endpoint que ninguém olha.

**Exclusão.** Confirmação própria, com o que sobrevive escrito ANTES do botão —
quem lê depois de clicar já não tem escolha. Duas recusas antes de qualquer
escrita: a própria conta não (derrubaria a sessão que executa a ação; desabilitar
é o que se quer ali, e é reversível), e o último admin não (sem admin ninguém
cria conta nem desfaz nada).

O que sobrevive é decisão das chaves estrangeiras, e cada uma foi conferida com
teste: sessão e token de login caem em cascata, porque não podem valer para
conta que não existe; `auth_event` e a atribuição de vaga viram nulo, porque
auditoria e vaga são fato ocorrido; e o candidato **não** é apagado — conta e
candidato são coisas distintas, e levar o currículo junto seria dano colateral
silencioso.

Fecha o ciclo de **E-07**, que previu esta exclusão e preparou a auditoria para
ela um dia antes.

#### O que ficou de fora

A verificação visual da modal abrindo. A extensão do Chrome não estava conectada
e abrir janela à parte atrapalharia quem pediu; a marcação renderizada foi
conferida por HTTP, e o padrão de popover é o mesmo do modal de vaga, que já
funciona.

### B-06 · `Number(id)` sem validação vaza o SQL, ou finge que escreveu ✅

Onze comandos convertiam o id posicional com `Number(id)` e entregavam o
resultado à consulta sem olhar. `Number("abc")` é `NaN`, e `NaN` chega ao driver
como bind inválido.

Os que **consultam** — `jobs show`, `analyze`, `prep` — estouravam um
`DrizzleQueryError` cujo `message` é o SELECT inteiro, impresso em vermelho no
terminal de quem só errou o id. Pior: o ramo educado (`No job with id abc`,
código 1) ficava logo abaixo da consulta e nunca era alcançado, porque a exceção
acontecia antes.

Os que só **escrevem** — `engage done`, `engage skip`, `skills confirm`,
`skills reject`, `mail accept`, `mail dismiss`, `track` — falhavam pior, em
silêncio: `where id = NaN` não casa com linha nenhuma, então o comando terminava
com código zero sem ter feito coisa alguma.

#### Entregue em 21/08/2026

Um guard só, `idNumerico(bruto, oQue)`, aplicado nos onze pontos antes de abrir
conexão com o banco — id inválido não precisa de banco. Inteiro e positivo,
porque todo id do sistema é `integer primary key autoincrement`, que começa em 1:
aceitar `"1.5"` ou `"-3"` só adiaria a mesma confusão para dentro da consulta.

O teste que caracterizava o defeito em `cov-cli-relatorios-acervo` dizia "no dia
em que a validação entrar, este é o teste que reprova". Entrou, reprovou, e agora
afirma a correção — incluindo que nem `select` nem `Failed query` aparecem na
saída.

### B-07 · `jho tasks done` aceita status inventado e mente sobre id inexistente ✅

Dois defeitos no mesmo comando, que só dividiam a linha.

O vocabulário da coluna (`todo | doing | done | skipped`) existia **apenas como
comentário** ao lado de `positioningTask.status` em `schema.ts`, e comentário não
valida nada: `--status feito` gravava `feito`. O item então sumia das duas
listagens — o filtro padrão esconde `done` e `skipped`, e um estado desconhecido
não é nenhum dos dois nem volta a ser `todo`. O plano perdia a tarefa em
silêncio, que é o pior desfecho possível para uma ferramenta de plano.

E `jho tasks done PT-9999` imprimia `✓ PT-9999 → done` e saía com zero: `update
... where id = ?` que não casa com linha nenhuma é sucesso para o SQL. Quem
digitou o id errado seguia acreditando que fechou a tarefa.

#### Entregue em 21/08/2026

`POSITIONING_STATUSES` e `positioningStatus()` em `src/core/positioning/plan.ts`,
ao lado do plano que os usa — mesmo formato de `APPLICATION_STATUSES`. O texto
de ajuda da flag passou a derivar da constante, em vez de repetir a lista. O
`update` ganhou `returning`, e zero linhas alteradas viraram código 1 com o
comando que lista os ids válidos.

### B-08 · `jho dossiers` sem destino espalha arquivo pelo diretório atual ✅

Sem `--out` e sem `JHO_VAULT_PATH`, o comando caía em `<cwd>/out/vagas`. O
problema não era o caminho: era ser **relativo a de onde a pessoa rodou**. Rodar
de outro diretório espalhava dezenas de markdowns num lugar que ninguém procura
depois, sem aviso, e o `mkdir` acontecia antes de qualquer verificação — então a
pasta nascia mesmo quando nenhum dossiê era gerado.

O `jho report`, dez linhas acima no mesmo arquivo, já resolvia o mesmo dilema do
jeito certo: sem destino, imprime no stdout em vez de escolher um.

#### Entregue em 21/08/2026

Recusa com código 1, nomeando as duas saídas (`--out` ou `JHO_VAULT_PATH`).
Imprimir não serviria aqui, porque a saída é um arquivo por vaga. É a regra 13
aplicada onde ela ainda não estava: a omissão precisa ser a opção segura.


### M-06 · O score não é recalculado para quem assume outra identidade 🔨

Revisão pedida em 21/08/2026: *"ao logar como outro usuário o score deve ser
recalculado baseado no perfil atual dele"*. Conferido contra o banco, não contra
a intenção.

**O que está certo.** `job_score` tem chave `(candidate_id, job_id)`. O board usa
`leftJoin` escopado ao candidato da sessão, então ninguém vê score de outro — o
isolamento existe. `scoreAll` grava o `profileHash` junto e **recalcula quando o
hash muda**, que é exatamente o mecanismo pedido; há teste provando dois
candidatos com perfis diferentes recebendo `fit` diferente para a mesma vaga.

**O que não está.** Três buracos, e o primeiro tranca os outros:

1. **Nenhum caminho de produção grava perfil de candidato.**
   `setMatchingProfile` só é chamado em teste. A tabela
   `candidate_matching_profile` está vazia, e todos caem no `profile.yaml`
   global. "O perfil atual dele" não existe como dado.
2. **`scoreAll` só é chamado pela CLI, sempre com `activeCandidateId()`** — o
   candidato padrão. No banco: 8.768 scores, **todos do candidato 1**; os outros
   dois têm zero.
3. **Assumir a identidade não dispara nada.** O efeito visível é board sem
   ranking, e não ranking errado — o `leftJoin` protege disso.

**Decisão de 21/08/2026: derivar do currículo.** Ao entrar, candidato com perfil
pontua com ele; sem perfil e com CV, deriva do CV, salva e pontua; sem CV, board
sem ranking e convite a subir um. `extractSkills` já faz a extração contra o
catálogo, com `confidence` derivada de onde e quantas vezes — nunca de opinião de
modelo.

O que um currículo **não** diz, e portanto continua herdado até alguém editar:
autorização de trabalho, regiões aceitáveis, modelo de contrato e faixa salarial.
São preferência e restrição, não histórico.

#### Pré-requisito entregue em 21/08/2026

A gravação em lote. `scoreAll` percorria as vagas com um `await` por linha:
contra o SQLite local é imperceptível, contra a Turso são 8.768 idas e voltas
HTTP **em série**. Pontuar um candidato novo no carregamento da página era
impossível, e a varredura diária pagava esse custo todo dia. Agora vai de cem em
cem — 88 requisições em vez de 8.768.

Sem isso, qualquer desenho de "pontua ao entrar" seria uma página que trava por
minutos.

#### O que falta

Derivar o perfil do CV, e decidir o gatilho. Pontuar no carregamento continua
sendo a opção errada mesmo em lote; o sistema já tem fila (`verify_task`,
`scrape_task`) e a varredura diária já roda — pontuar todo candidato ali, com uma
ação explícita para quem acabou de subir currículo, é o caminho que não faz
ninguém esperar.

### B-09 · `verifyLogin > limits per address` falha de forma intermitente 📋

Observado em 21/08/2026, durante a instalação da skill `deep-review`. Não é
regressão dessa mudança — apareceu numa execução da suíte que não tocava
autenticação.

**Medido, não suposto:**

| | |
|---|---|
| Suíte completa | 1 falha em ~3 execuções |
| `tests/password.test.ts` isolado | 0 falhas em 5 execuções |

Passar isolado e falhar em conjunto aponta para contenção ou estado
compartilhado, não para lógica errada. O caso cria um segundo usuário, esgota as
tentativas de `eu@test`, e afirma que `outro@test` ainda entra — ou seja, que o
limite é por endereço e não global.

Duas hipóteses, nenhuma verificada:

1. **Contenção de CPU.** `verifyLogin` chama `scrypt`, que é caro de propósito.
   Sob a suíte inteira em paralelo, o laço de `MAX_ATTEMPTS` tentativas pode
   atravessar a fronteira da janela deslizante e mudar o que o limite enxerga.
2. **Estado compartilhado entre arquivos.** `createRateLimiter` guarda os
   contadores na memória do processo (ADR 0009). Workers do Vitest reusam
   processo, e um contador que sobreviva de outro arquivo de teste alcançaria
   este caso.

Importa mais do que o número sugere: um teste de limite de autenticação que
falha às vezes ensina a ignorar falha de CI, que é o começo de deixar passar a
falha verdadeira.
