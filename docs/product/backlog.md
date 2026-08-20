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
