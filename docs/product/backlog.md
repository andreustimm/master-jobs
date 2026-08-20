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

---

## P1 — Mudam a qualidade do dado do funil

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

### UI-02 · Histórico de versões do currículo: modal, restaurar, renomear, excluir ✅ (falta a migração de `cv_variant`)

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

**Diff entre duas versões.** Hoje se vê uma por vez. A diferença de tamanho
resolve *escolher*; um diff por linha resolveria *entender o que mudou*, que é
outra pergunta.

### UI-03 · Reconferir se a vaga ainda existe ✅ (falta agendar o periódico)

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

#### O que ficou de fora

**Agendar o periódico.** Os comandos existem e funcionam; falta decidir quem os
dispara. Não instalei nada no sistema do usuário — um `cron` ou `launchd`
criado sem pedir é efeito colateral fora do escopo. A receita:

```
0 7 * * *  cd <repo> && pnpm jho jobs recheck queue --limit 300
15 7 * * * cd <repo> && pnpm jho jobs recheck run --delay 300
```

**Status da vaga além de aberto/fechado.** Hoje o veredito é vivo, morto ou sem
resposta. "Pausada", "preenchida" e afins exigiriam ler a página, não só o
código HTTP — outro problema.

### UI-04 · Cadastro de vaga por recrutador, com rótulo de origem 📋

Pedido em 20/08/2026, junto da entrega dos três papéis. `can()` já concede
`job:write` a admin, candidato e recrutador — e o comentário daquele case já
antecipa esta tarefa: *"a origem de cada uma fica registrada na `source`, para
a tela poder dizer de onde veio"*. A permissão existe e não há por onde
exercê-la: o dashboard não tem formulário de cadastro, só a CLI tem
(`jho jobs add <url>` e `jho jobs import`), e a lista de vagas não diz de onde
nenhuma delas veio.

**Contexto que restringe a solução.** `src/core/sources/types.ts` já separa o
que sincroniza do que não sincroniza: doze `FETCHABLE_SOURCE_KINDS` contra um
único `MANUAL_SOURCE_KINDS`, e `SourceConfig.kind` aceita apenas o primeiro
grupo — um kind manual não entra em `sources.yaml` nem aparece em
`jho sources list` com "última sincronização: nunca" como se fosse defeito.
`job.posted_by_user_id` já existe, referencia `auth_user` e o comentário dele
já diz o que ele **não** é: atribuição (qual recrutador ofereceu), não rótulo.

---

#### Decisões que a implementação precisa tomar

**1. O rótulo deriva de `source.kind` em tempo de leitura. Sempre.**

A alternativa — uma coluna `origin` em `job`, escrita no cadastro — é mais
rápida de consultar e começa a divergir na primeira reclassificação de fonte.
O projeto já pagou por esse erro: `application.cv_variant` guarda o nome da
variante numa string solta em vez de apontar para `candidate_document.id`, e o
resultado é um funil que afirma ter enviado um documento que não existe mais
(UI-02). Vínculo que não é vínculo mente com cara de íntegro. Aqui o dado
canônico é a `source`, e o rótulo é uma função dela.

**2. `recruiter` como `MANUAL_SOURCE_KIND` novo, e não mais um `manual`.**

Hoje `jho jobs add` e `jho jobs import` caem os dois em `manual`, com
`ensureImportSource` criando `manual:<host>`. Se a vaga do recrutador também
for `manual`, o rótulo deixa de distinguir "eu colei esta URL" de "um
recrutador ofereceu isto" — e a distinção é a razão de existir da tarefa. Vaga
com um recrutador identificado do outro lado se lê mais como referral do que
como anúncio: há contraparte humana, canal de resposta e um interlocutor a
quem perguntar. É informação de triagem, não de catálogo.

O custo é baixo e vale registrar por que: kind novo em `MANUAL_SOURCE_KINDS`
não força migração de dado nenhum (as vagas antigas seguem `manual`), não
entra no union de configuração e não toca o registry de adapters, porque não
há nada a buscar.

**3. O formulário resolve antes de perguntar.**

`src/core/ingest/manual.ts` já resolve uma URL pelo ATS e só cai no caminho
`manual` quando não consegue. O formulário deve chamar esse mesmo caminho —
URL primeiro, campos à mão apenas para o que não voltou. Reimplementar a
resolução dentro da Server Action quebraria a invariante de que a UI é
adaptador sobre as mesmas APIs públicas que a CLI usa, e produziria duas
versões da mesma normalização divergindo em silêncio.

**4. `posted_by_user_id` vem da sessão, e o formulário não o menciona.**

Regra 15 na letra: id em FormData é pedido, não prova. A ação obtém o usuário
de `guard("job:write")` e ignora qualquer campo homônimo que chegue.

**5. Vaga cadastrada à mão pontua com o que tem, e o que falta vale neutro.**

Um recrutador cola título, empresa e faixa; descrição completa quase nunca vem.
Regra 8: ausência de descrição não é ausência de benefício, e `benefits` em
texto curto vale 0,5 sem gerar bloqueador. Rebaixar a vaga porque o formulário
foi curto seria pontuar a digitação, não o emprego.

---

#### O que fica de fora, e por quê

**Recrutador editar vaga que não cadastrou.** `job:write` é permissão de
escrita no acervo global, que é compartilhado — não é posse. Edição
retroativa por outro papel exigiria decidir precedência entre o que a fonte
diz e o que a pessoa digitou, e isso é outra tarefa.

**Oferecer a vaga a um candidato específico.** O vínculo recrutador→candidato
já existe em `recruiter_candidate`, mas direcionar uma vaga a alguém cria
notificação, e notificação sem canal de envio (F-05) não sai do banco.

**Moderação por admin.** Fila de aprovação só faz sentido com volume vindo de
fora e com mais de um recrutador. Antes disso é cerimônia.

## P3 — Estrutura e futuro

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

### F-05 · Resend para e-mail transacional e recuperação de senha 📋

**Contexto que restringe a solução.** O sistema não envia e-mail — nenhum.
`magicLink.begin()` grava o hash do token e devolve o token cru ao chamador;
quem entrega é `jho auth login <email>`, que **imprime a URL no terminal**.
Isso funciona para uma pessoa no próprio computador e para mais ninguém: um
candidato ou recrutador cadastrado por um admin (AUTH-02) não tem terminal,
não tem repositório e não tem como receber o link. Enquanto for assim, a tela
de administração cria contas que não conseguem entrar.

Do outro lado do sistema já existe e-mail, e ele não serve aqui: F-01 lê a
caixa do usuário pela API do Gmail, com escopo somente leitura, e
`src/core/mail/` é parser MIME, classificador e extrator de job alert — tudo
ingestão. Envio é a direção oposta e não compartilha nada com aquilo. Colocá-lo
dentro do contexto de correspondência faria o contexto que **lê** passar a
escrever para fora.

---

#### Decisões que a implementação precisa tomar

**1. Porta `Mailer`, adapter Resend, adapter de console.**

Regra 4 com variação real: Resend hoje, SMTP ou SES depois, e um adapter que
só imprime — usado em desenvolvimento e nos testes, e que preserva o
comportamento de hoje como caso legítimo em vez de gambiarra. A porta é
mínima (destinatário, assunto, corpo, resultado); o domínio não aprende o que
é bounce nem o que é webhook.

**2. A chave de API é do usuário, e o agente não pode gerá-la.**

`RESEND_API_KEY` entra como **nome de variável de ambiente**, no padrão que
`jho llm add-provider --key-env` já usa. Regra 16: o banco guarda o nome,
jamais a chave — banco é copiado e versionado em backup, e chave dentro dele
viaja junto. Registrado aqui de forma explícita porque é o tipo de passo que
um agente "resolveria" sozinho: nenhum agente cria conta no Resend, aceita
termos em nome do usuário nem emite credencial. O que o sistema faz é dizer
qual variável falta.

**3. "Esqueci minha senha" reusa o link mágico. Não é um token novo.**

`auth_login_token` já é de uso único, hashado, com expiração e consumo atômico
— o `UPDATE ... RETURNING` que impede duas redenções simultâneas de ganharem
as duas. Um segundo tipo de token com o mesmo ciclo de vida seria uma segunda
chance de errar a mesma coisa. O fluxo é entrar pelo link e cair na tela de
definir senha, que já existe como `setPassword`.

**4. A resposta é idêntica exista ou não a conta.**

`magicLink.complete()` já devolve null tanto para token inválido quanto para
endereço desconhecido, de propósito. O formulário de recuperação mantém a
postura: sempre "se houver conta para este endereço, o e-mail saiu". Uma
mensagem "e-mail não encontrado" transforma o formulário em oráculo de quem
tem conta na instalação — e num produto de busca de emprego, saber quem está
procurando já é informação sensível.

**5. Falha de envio não vira sucesso silencioso nem denuncia o destinatário.**

A entrega é assíncrona por natureza: o provedor aceita agora e devolve bounce
depois. O erro é registrado em `auth_event` e visível ao admin em AUTH-02; ao
anônimo, a mesma frase neutra de sempre. Se precisar de retentativa, o padrão
da casa é tabela e não broker (ADR 0009) — uma `mail_task` no molde de
`scrape_task` e `verify_task`, com claim atômico e backoff.

**6. Limite de tentativas: o que existe protege a outra ponta.**

`MAX_ATTEMPTS = 8` em `WINDOW_MINUTES = 15` conta `login_failed` em
`auth_event` e protege a **verificação** de senha. Pedir recuperação não falha
nunca, então nada é contado — sem limite próprio, o formulário vira gerador de
e-mail contra qualquer endereço que o atacante escolher, saindo do domínio do
usuário e queimando a reputação dele. Contar por endereço **e** por origem, e
a recusa devolve a mesma frase neutra da decisão 4: um limite que responde
"muitas tentativas" só para endereços existentes é o oráculo de volta.

**7. Domínio verificado é pré-requisito, não detalhe de configuração.**

Resend exige SPF e DKIM no domínio remetente; enviar de domínio não verificado
cai em spam, e o usuário conclui que o produto não envia e-mail. O remetente é
configuração dele, e `jho security check` é o lugar natural para conferir que
a variável existe antes de a primeira recuperação ser pedida — o comando já
faz autoverificação de bind, segredo e permissão.

---

#### O que fica de fora, e por quê

**E-mail periódico com vagas ou relatório.** É outro produto e outro
consentimento. `jho report` escreve markdown no vault; empurrar isso para a
caixa de entrada muda a relação com o usuário e merece decisão própria.

**Webhooks de bounce e reclamação.** Exigem endpoint público recebendo POST de
terceiro, com verificação de assinatura — superfície nova numa instalação que
até aqui só abre uma rota anônima (AUTH-04), e sob escrutínio.

**Template HTML.** Texto simples atravessa qualquer cliente, não carrega pixel
de rastreio e não tem como quebrar layout. Um e-mail transacional que só
precisa carregar um link não ganha nada com o resto.

**Enviar candidatura por e-mail.** Regra 13. Ter um `Mailer` não muda a
decisão da ADR 0010 — se muda, é sinal de que a trava era técnica quando
deveria ser de produto.

---

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

### E-05 · Estrutura de documentação do CompozyOS: epic, PRD, techspec, ADR 📋

Pedido em 20/08/2026: *"O ideal é utilizarmos a estrutura do compozy para os
epics, prd, techspec, adrs, etc."*

O repositório já tem um pé no CompozyOS — `compozy/loops/job-sweep.yaml` está
escrito e validado contra o daemon 0.3, e `docs/engineering/COMPOZY-OS.md`
documenta o ciclo inteiro contra a instalação real desta máquina. Mas esse pé é
de **automação**: um Loop em YAML que sincroniza, pontua e propõe triagem. O que
se pede aqui é outra coisa — adotar a **forma dos documentos**. As duas decisões
são independentes, e confundi-las faria a segunda entrar de carona na primeira
sem nunca ter sido discutida.

#### O que a estrutura do CompozyOS de fato oferece

Segundo o `COMPOZY-OS.md` (§4 e §5), a `cy-create-spec` produz, em
`.compozy/tasks/<slug>/`:

| Arquivo | Conteúdo |
|---|---|
| `_spec.md` | Spec unificado — parte de produto **e** parte técnica no mesmo arquivo |
| `_user_stories.md` | Catálogo de histórias |
| `_tests.md` | Contrato de testes |
| `_dx.md` | Contrato de experiência de desenvolvimento |
| `_uiux.md` | Mapa de mudança de UI, para feature com interface |

A `cy-create-tasks` acrescenta `_tasks.md` (o grafo) e `task_01.md …
task_NN.md`, com a garantia de que **cada caso de `_tests.md` cai em exatamente
uma tarefa** — é o que impede caso órfão e caso contado duas vezes. As rodadas
de revisão viram `reviews-NNN/`.

Confrontando isso com o que foi pedido, quatro palavras e três destinos
diferentes:

- **PRD e techspec** existem, mas **fundidos** num `_spec.md` só. A 0.2 tinha
  `cy-create-prd` e `cy-create-techspec` separadas; a 0.3 juntou as duas e
  acrescentou `_dx.md` e `_uiux.md`, que não existiam. Quem pede "PRD e
  techspec" recebe um arquivo, não dois.
- **Epic não é um artefato.** A unidade é o `<slug>`, que é uma feature com
  spec e tarefas. Agrupar slugs num tema maior é convenção de nome de
  diretório, não estrutura que a ferramenta conheça ou verifique.
- **ADR não existe.** Nenhuma das dez skills produz ADR, e nenhum dos arquivos
  do spec guarda decisão com as alternativas descartadas. É a lacuna que mais
  pesa aqui, porque é justamente o gênero que este repositório mais usa: dez
  ADRs, uma delas com 1.112 linhas.

A assimetria é a chave. O CompozyOS documenta **trabalho em execução**, com
começo, meio e entrega. `docs/adr/` documenta **decisão que sobrevive à
entrega** — e sobrevive de propósito, para que ninguém proponha reverter sem ler
por que foi assim. `vision.md` e `personas.md` não pertencem a slug nenhum, e o
`backlog.md` — este arquivo — é a fila que decide qual slug nasce em seguida.
São gêneros com ciclo de vida diferente, e é aí que a decisão se decide.

#### A decisão central, que não é minha

Três respostas possíveis, e nenhuma está tomada:

**1. Migrar tudo.** `docs/product/` e `docs/adr/` viram artefatos do CompozyOS.
Uma estrutura só, uma ferramenta só, e nada de decidir toda vez onde escrever.
Custa reescrever ADR como spec — gênero que ela não é — e aceitar que decisão
estrutural passe a morar dentro do diretório de uma feature que um dia acaba.

**2. Conviver por fronteira.** O CompozyOS manda no ciclo de uma feature
(`_spec.md`, `_tests.md`, `_tasks.md`, `reviews-NNN/`); `docs/` continua dono do
que atravessa features — ADR, visão, personas, backlog, mapa de contextos. O
item do backlog vira o insumo do `/cy-create-spec`, e a ADR que a feature
eventualmente produzir volta para `docs/adr/`. Custa manter duas convenções e
escrever explicitamente qual vale para quê; sem isso a fronteira apodrece na
terceira feature e passa a haver dois lugares plausíveis para a mesma coisa.

**3. Não adotar agora.** Rodar a primeira jornada do §10 numa feature pequena e
decidir depois, com um ciclo completo de evidência em vez de leitura de doc.

O próprio `COMPOZY-OS.md` recomenda a terceira como precondição das outras duas:
*"o objetivo da primeira jornada não é entregar a feature: é descobrir onde o
ciclo atrita com este repositório"*. Decidir a forma de toda a documentação
antes de a ferramenta ter fechado um ciclo aqui é decidir no escuro.

Vale registrar a ironia, que é útil e não decorativa: **qualquer que seja a
resposta, ela é uma ADR** — a 0011. E o CompozyOS não tem onde guardá-la. Isso
já é, por si só, um argumento sobre onde a fronteira cai.

#### Custo de migração, em números

- **51 arquivos `.md`** em `docs/`. `docs/adr/` tem 10 (a 0007 sozinha tem 1.112
  linhas) e `docs/product/` tem 6, somando cerca de 1.400 linhas entre backlog,
  user stories, visão e personas.
- **63 referências** a `docs/adr` ou `adr/00NN` espalhadas por **23 arquivos** —
  incluindo `CLAUDE.md` e `AGENTS.md`, que todo agente lê no começo de toda
  sessão e cujas regras invioláveis citam `docs/adr/0001`, `0008`, `0009` e
  `0010` por caminho. Mover os arquivos sem reescrever esses ponteiros produz o
  pior estado possível: a regra continua escrita e a justificativa dela some.
- A tabela de ADRs em `docs/README.md` lista **0001 a 0006** — seis de dez.
  Índice mantido à mão já apodreceu uma vez aqui, e uma migração multiplica as
  tabelas a manter em vez de reduzi-las.
- `tests/architecture.test.ts` abre `docs/engineering/context-map.md` **por
  caminho literal**, em dois testes: um exige uma linha `| <contexto> |` para
  cada diretório de `src/contexts/`, o outro compara o marcador
  `<!-- schema-table-count: 29 -->` com a contagem de `sqliteTable` em
  `src/core/db/schema.ts`. Mover ou renomear esse arquivo derruba `pnpm check`.
  Aqui documentação não é decoração — parte dela é teste de fitness, e mexer
  nela é mexer em código.

Do outro lado, o ganho é real e merece ser nomeado para a proposta não parecer
frívola: hoje um item deste backlog não tem contrato de testes, não tem grafo de
tarefas com dependência declarada, e não tem `/cy-final-verify` exigindo
evidência fresca antes de alguém dizer "pronto". UI-02 e UI-03 tiveram o "o que
ficou de fora" escrito à mão **depois** da entrega; um `_tasks.md` derivado de
`_tests.md` teria dito isso antes, e o backlog já foi pego mentindo sobre o
próprio estado em oito itens numa revisão só.

#### O risco de acoplar a documentação a uma beta

A versão instalada é **0.3.0-beta.17**. O `COMPOZY-OS.md` registra que a
extension `dev-cycle` 0.3.1 está em `error`, superada pela `spec-cycle` 0.4.1, e
que `cy03 status` reporta `degraded`. Mais grave para esta decisão: a §4 lista
**três pontos em que o `MIGRATION_GUIDE.md` oficial diverge da máquina** — e nos
três a máquina venceu. Um deles é exatamente o formato em jogo aqui: o guia
afirma que PRD e techspec "não têm sucessor", quando na prática a
`cy-create-spec` entrega os dois fundidos.

A divergência não é só entre documentação e máquina; é entre gerações no mesmo
laptop. As skills carregadas numa sessão de agente vêm de `~/.claude/skills` e
são as da **0.2** — `cy-create-prd` e `cy-create-techspec` separadas, sem
`cy-create-spec` —, enquanto o daemon 0.3 espera o formato unificado. Um agente
que rode a skill local hoje produz forma diferente da que a ferramenta consome.

O que isso significa em concreto: uma release menor pode renomear `_spec.md`,
fundir outro par de arquivos ou mudar `.compozy/tasks/` de lugar, e o
repositório herda a mudança em toda a documentação de uma vez.

A mitigação existe e vale registrar, porque muda o tamanho do risco: os
artefatos são **Markdown puro**. Ler não depende de daemon, de licença nem de
rede — se o CompozyOS sumir amanhã, os arquivos continuam abrindo. O que se
compra da beta é a **convenção**, não o acesso. Isso rebaixa o risco de "perder
a documentação" para "ficar com uma convenção órfã", que é sobrevivível. Não
elimina, porém, o custo de reescrever 63 ponteiros duas vezes se a convenção
mudar no meio do caminho.

#### O que fica de fora

**Agendar automação.** `cy03 automation` e o `job-sweep.yaml` são outro assunto,
já descrito em `compozy/README.md` como fase 2. Este item é sobre forma de
documento, não sobre quem dispara a varredura.

**`auto_commit`.** Segue `false` pela razão já registrada no `COMPOZY-OS.md`: as
mensagens de commit deste repositório carregam o porquê de cada decisão, e
commit automático produz mensagem genérica — perde exatamente o que torna o
histórico utilizável meses depois.

**Migração retroativa.** Mesmo que a resposta seja "migrar tudo", reescrever as
dez ADRs existentes é decisão separada de adotar o formato daqui para a frente.
Documento antigo que ninguém vai reler não paga a própria migração.

**Versionar `.compozy/tasks/`.** Hoje só `.compozy/workspace.toml` está no git.
O §7 do `COMPOZY-OS.md` recomenda versionar as tarefas e ignorar apenas o
runtime — mas isso passa a colocar spec e rodada de revisão no histórico do
repositório, e essa consequência precisa ser querida, não herdada junto com o
resto.

### E-06 · Cenários de teste por papel, ponta a ponta 📋

Pedido em 20/08/2026: *"crie cenarios de testes para todos os tipos de
usuários, simulando todos os cenarios possíveis."*

"Todos os cenários possíveis" são dois conjuntos com custos que diferem em
ordem de grandeza, e tratá-los como um só é o erro que este item existe para
evitar. **A matriz de decisão já está coberta; o percurso não está coberto de
jeito nenhum.**

**O que já existe, e existe bem.** `tests/auth-policy.test.ts` afirma 28 casos
sobre papel × ação × posse × visibilidade, vários deles varrendo `ACTIONS` e
`ADMIN_ACTIONS` inteiros em laço — o número de combinações asseridas é bem
maior que o número de testes. `tests/impersonation.test.ts` acrescenta 10 sobre
assumir identidade: cadeia negada, alvo desabilitado, alvo inexistente, assumir
a si mesmo, TTL de uma hora, registro de início e de fim, revogação no
servidor. Isso é barato porque `can()` é função pura: nada de banco, servidor
nem browser. Reproduzir essa matriz em Playwright seria testar a **mesma**
função através de seis camadas de framework, mais devagar e cobrindo menos —
uma combinação que hoje custa microssegundos passaria a custar um login e uma
navegação. Este item não deve encostar nisso.

**O que não existe: percurso por papel.** `tests/e2e/ui.mjs` faz cerca de 60
verificações em browser, todas com **uma conta só** — `e2e@local.test`, criada
por `seedOwner`, que grava `roles: ["admin", "candidate"]` fixo no código e
vincula ao candidato do `profile.yaml`. Toda a suíte roda como esse usuário
composto. Não há cenário de recrutador nenhum, nem de candidato sem admin, nem
de admin sem candidato, nem de conta desabilitada, nem de conta sem senha.

**E o vazio já esconde um defeito de composição.** Onze páginas guardam com
`requireOwnCandidatePage("candidate:read")` — inclusive `/` e `/jobs` — e esse
guarda chama `forbidden()` quando `session.candidateId` é `null`. Um recrutador
não tem `candidateId`; um admin puro também não. Como `passwordLoginAction`
sempre redireciona para `/`, os dois entram com a senha certa e **caem em 403 na
primeira tela**. A política diz o contrário: `job:read` e `job:write` são
permitidos aos três papéis. A política está certa e a composição não a respeita
— e nenhum teste puro pode ver isso, porque cada metade está correta sozinha.
Só um browser entrando como recrutador vê.

Não é acidente esquecido: `tests/architecture.test.ts` **fixa** esse guarda por
caminho literal, em "uses candidate-scoped page guards wherever funnel or CV
data is read", e `/jobs` está na lista porque a listagem carrega fit score e
estado de candidatura junto. O acervo global sem o escoramento do candidato não
existe como tela. Ou seja: o recrutador não tem superfície, e isso precisa ser
**decidido**, não descoberto por um teste que congele o estado atual como
especificação.

---

#### Decisões que a implementação precisa tomar

**1. As contas semeadas, e por que `seedOwner` não serve para criá-las.**

`seedOwner` tem `const roles: Role[] = ["admin", "candidate"]` embutido e amarra
ao candidato do perfil — ele existe para a conta do dono, e mudá-lo para aceitar
papel arbitrário seria mexer no caminho de instalação por causa de teste. As
contas extras entram pela porta de diretório (`jho auth add-user --role`), que é
a **mesma** API que o operador usa. Fixture escrita por `INSERT` à mão testa um
estado que o produto talvez não saiba produzir.

| Conta | Papéis | Vínculo | Existe para provar |
|---|---|---|---|
| `e2e@local.test` | admin + candidate | candidato do perfil | o percurso já coberto; não muda |
| `admin@e2e.local` | admin | nenhum | administra a instalação e **não** lê currículo alheio |
| `cand@e2e.local` | candidate | candidato próprio | percurso do candidato sem poder nenhum de admin |
| `rec-vinc@e2e.local` | recruiter | vinculado a um candidato | lê quem acompanha; não edita nem move funil |
| `rec-solto@e2e.local` | recruiter | nenhum | 403 em dado privado; vê o que é global |
| `off@e2e.local` | candidate | — | `disabledAt` preenchido: não entra |
| `sem-senha@e2e.local` | candidate | — | sem hash: não entra, e a tela não diz por quê |

O `rec-vinc` precisa de um **segundo** candidato para acompanhar, senão
"recrutador vinculado" e "candidato dono" olham a mesma linha e o teste deixa
de distinguir posse de vínculo — que é exatamente a distinção em jogo.

**2. O que cada conta vê, e o que recebe 403.** A tabela abaixo é o alvo, não o
estado atual — as três colunas da direita hoje são 403 em tudo, pela razão da
seção anterior:

| Rota | admin puro | candidato puro | recrutador vinculado | recrutador solto |
|---|---|---|---|---|
| `/` cockpit | a decidir | 200 | a decidir | a decidir |
| `/jobs`, `/jobs/[id]` | a decidir | 200 | 200 sem fit alheio | 200 sem fit alheio |
| `/candidate*` | 403 | 200 (o próprio) | 200 leitura de quem acompanha | 403 |
| `/pipeline` | 403 | 200 | 403 | 403 |
| `/referrals` | 403 | 200 | 403 | 403 |
| `/compare` | 403 | 200 | 403 | 403 |
| `/admin/users` | 200 | 403 | 403 | 403 |
| `/api/export` | 403 | 200 (só o próprio) | 403 | 403 |

As células "a decidir" são o conteúdo real deste item. Escrever o cenário antes
de decidi-las produz teste de caracterização — que passa a defender o defeito.

**3. Conta desabilitada e conta sem senha são indistinguíveis na tela, de
propósito.** `verifyLogin` devolve `{ ok: false, reason: "invalid" }` para os
quatro motivos — conta inexistente, sem senha, desabilitada e senha errada — e
grava o motivo verdadeiro só em `auth_event.detail`, para o operador. Enumerar
conta pela mensagem de erro é o vazamento clássico, e a defesa está escrita.
Consequência direta para o teste: **o oráculo desses dois cenários é o
`auth_event`, não a tela**, e portanto eles não precisam de browser. O que
merece uma checagem em browser é o inverso — que a mensagem renderizada seja
**idêntica** nos quatro casos, porque a divergência nasceria de um mapa de erro
bem-intencionado na página, que é código de UI.

Detalhe operacional que morde: o limite é de 8 tentativas falhas em 15 minutos e
o `setup.mjs` hoje limpa `login_failed` **apenas** de `EMAIL`. Quatro logins
falhos de propósito em contas novas, somados entre execuções, bloqueiam a suíte
com uma proteção que funcionou. A limpeza tem de cobrir todas as contas
semeadas.

**4. Impersonação é o único cenário que exige duas identidades no mesmo
browser.** Entrar como admin, assumir um candidato, e verificar: a faixa de
sessão emprestada aparece; `/admin/users` responde **403 renderizado** e não
stack trace — o comentário em `app/auth.ts:100-104` registra que esse bug
apareceu exatamente aí; sair devolve à identidade original; e o token some do
servidor, não só do navegador. A decisão já é provada em teste puro. O que só o
browser prova é a troca de cookie, o caminho de volta e a **forma** da negativa.

**5. Cobertura alvo do projeto: >95%, definida em 20/08/2026.** Hoje esse número
**não é mensurável**: `vitest.config.ts` não tem bloco `coverage`,
`@vitest/coverage-v8` não está instalado e não existe limiar que reprove. 637
testes em 54 arquivos mais ~60 checagens em browser é volume, e volume sem
instrumento não responde a única pergunta que interessa — *o que não é executado
por teste nenhum?*. A primeira tarefa deste item é também a mais barata: ligar o
provedor, publicar o número real e só então negociar onde os 5% podem ficar de
fora. E-06 ataca o buraco que a instrumentação vai apontar como maior: a
composição de guarda por rota, que hoje é verificada por **grep** em
`architecture.test.ts` — o teste confirma que a chamada está escrita no arquivo,
nunca que ela nega quem deve negar.

---

#### O corte: o que vai para o browser e o que fica sem ele

A regra é uma frase: **o browser recebe percurso, a matriz fica onde uma
combinação custa microssegundos.**

| Cenário | Onde | Por quê |
|---|---|---|
| papel × ação × posse × visibilidade | puro — já existe | 28 testes, sem I/O; nada a acrescentar |
| regras de impersonação (cadeia, desabilitado, TTL, auditoria) | puro — já existe | 10 testes; o browser não veria mais |
| 11 rotas × 6 contas → 200/403 | integração, sem browser | 66 combinações; sobe o app uma vez e pede as rotas, sem renderizar |
| 4 motivos de login falho → `auth_event` correto | integração | o oráculo é uma linha de tabela |
| percurso do candidato puro | browser | é o que a suíte já faz; muda só de conta |
| percurso do recrutador vinculado | browser | o único papel sem cobertura visual nenhuma |
| impersonação ponta a ponta | browser | cookie, faixa, 403 renderizado, revogação |
| mensagem idêntica nos 4 motivos | browser, 1 checagem | o oráculo é o texto que a página desenha |
| tipografia, tooltip, i18n, mobile | **não multiplicar por conta** | são propriedades do layout, não do papel |

A última linha é a que segura o custo. O laço de idioma sozinho carrega 8 telas,
o de mobile mede `scrollWidth` em mais um conjunto, e a suíte ainda constrói o
Next e sobe servidor próprio a cada execução — já são minutos. Multiplicar isso
por seis contas transforma `pnpm test:e2e` em algo que ninguém roda antes de
commitar, e suíte que não roda custa mais cobertura do que acrescenta. O critério
correto é por **tela**, não por conta: cada tela nova entra uma vez no laço de
idioma e uma vez no de mobile, com a conta que consegue abri-la.

Na prática o browser ganha **duas** contas além da atual — candidato puro e
recrutador vinculado — e delas só o percurso específico. As outras quatro vivem
inteiras em teste de integração.

---

#### O que fica de fora, e por quê

**Corrigir o 403 do recrutador e do admin puro.** Este item **descobre e fixa**;
consertar é UI-04 (cadastro por recrutador precisa de uma tela que o recrutador
consiga abrir) e a decisão de home por papel. Misturar as duas coisas faria um
item de teste virar refatoração de rota com teste junto, e a discussão sobre
qual tela o recrutador vê merece acontecer sozinha.

**Cenário de dois usuários simultâneos.** Duas sessões concorrendo pela mesma
linha — recrutador lendo enquanto o candidato salva — é teste de concorrência,
não de papel. O único lugar do sistema com claim atômico é a fila, e ele já tem
o próprio teste.

**Fuzz de permissão.** Gerar sessões aleatórias contra `can()` é atraente e
seria redundante: a função é pequena, exaustivamente enumerável e já enumerada.
Fuzz paga onde o espaço é grande demais para listar.

**Conta com papel `recruiter` E `candidate`.** Combinação que a política aceita e
que ninguém pediu. Cenário sem usuário é manutenção sem dono.

## Ordem de execução proposta

1. **B-01, B-02** — corrigem descarte indevido de vagas. Em implementação.
2. **E-01** — a arquitetura decide onde tudo abaixo mora. Não faz sentido
   construir F-02 e M-03 sobre a estrutura que será refatorada.
3. **M-04, B-03** — ganho de usabilidade imediato, custo baixo.
4. **F-02** — área do candidato, já na estrutura nova.
5. **M-03** — benefícios, junto do rebalanceamento de pesos.
6. **F-01** — e-mail, o maior salto de qualidade de dado.
7. **E-02** — estatística, quando houver dado de resultado para correlacionar.
8. **UI-02** — histórico de versões do currículo. Pedido em 19/08; a etapa de
   exclusão depende de `cv_variant` virar chave estrangeira, então entra depois
   da migração.
9. **AUTH-02** — administração de usuários. `UserDirectory` é a única porta do
   contexto sem adapter, e sem ela papel se troca por SQL. Impersonação é o que
   torna a política de três papéis operável em vez de só correta.
10. **AUTH-03** — visibilidade do perfil. Precede AUTH-04: sem o controle, a
    página pública existe e nenhum candidato consegue ligá-la.
11. **AUTH-04** — portfólio público. A primeira rota anônima do sistema; entra
    depois de AUTH-03 e com o teste de ausência de piso salarial, funil e
    contato junto.
12. **UI-04** — cadastro por recrutador. Independente dos três acima, mas só
    faz sentido com recrutadores de verdade na instalação, o que depende de
    AUTH-02 conseguir criá-los.
13. **F-05** — Resend. Fecha a lacuna que AUTH-02 abre: conta criada pelo admin
    hoje não recebe o link de acesso, porque ele sai no terminal. Depende de
    uma chave que só o usuário pode emitir.
14. **E-05** — estrutura de documentação do CompozyOS. Depende de uma primeira
    jornada completa com a ferramenta: decidir a forma de todos os documentos
    antes de a 0.3 ter fechado um ciclo aqui seria escolher no escuro.
15. **E-06** — cenários por papel. A instrumentação de cobertura e a matriz de
    rota × papel em integração podem entrar já; o percurso em browser depende de
    AUTH-02 (criar as contas pela porta) e da decisão de UI-04 sobre que tela um
    recrutador abre. Antes disso metade dos cenários só saberia afirmar 403 —
    registrar o vazio não é testar percurso.
