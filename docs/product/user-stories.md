# User stories

Organizadas por épico. Cada história traz critérios de aceite verificáveis e o
estado real — conferido contra o código, não contra a intenção.

**Legenda:** ✅ entregue · 🔨 parcial · 📋 planejado · ❌ recusado (com motivo)

Personas em `personas.md`. Prioridade e sequência em `backlog.md`.

---

## E1 — Sourcing: trazer vagas sem arriscar a conta

### E1.1 ✅ Sincronizar boards públicos
> Como **Andreus**, quero puxar vagas de vários boards com um comando, para não
> abrir catorze abas.

**Aceite**
- [x] `jho jobs sync` percorre todas as fontes de `config/sources.yaml`
- [x] Falha de uma fonte não derruba o sync; erro fica em `source.lastError`
- [x] Reexecução é idempotente — mesma vaga não duplica (fingerprint)
- [x] Edição no anúncio é detectada por `contentHash` e invalida o score

**Real:** 13 fontes ativas, 6.239 vagas abertas.

---

### E1.2 ✅ Cadastrar vaga por URL
> Como **Andreus**, quero colar a URL de uma vaga que recebi por e-mail e ter
> ela no sistema com o mesmo score das outras.

**Aceite**
- [x] `jho jobs add <url>` resolve o ATS a partir da URL
- [x] Formulário equivalente na UI
- [x] Vaga entra com `source_id = manual:*` e é pontuada igual
- [x] URL já conhecida não cria duplicata

---

### E1.3 ✅ Importar de plataforma autenticada
> Como **Andreus**, quero importar vagas da Revelo (que exige login) sem que o
> sistema guarde minha sessão.

**Aceite**
- [x] `jho jobs import <arquivo> --source revelo`
- [x] Nenhuma credencial é armazenada
- [x] `--dry-run` mostra o que entraria

**Por que assim:** o sistema não dirige sessão autenticada de terceiro. Ver
`docs/sources-autenticadas.md`.

---

### E1.4 ✅ Não perseguir vaga morta
> Como **Andreus**, não quero escrever carta para vaga que já não existe.

**Aceite**
- [x] `jho jobs verify` checa as vagas do topo
- [x] 404/410 fecha a vaga; **403 não** — é bloqueio de bot, não morte
- [x] Vaga é fechada (`closedAt`), nunca deletada
- [x] Vaga fechada some da lista sem quebrar histórico

**Real:** 314 vagas fechadas. Uma fonte tinha 25% de links mortos.

---

### E1.5 ❌ Scraping do LinkedIn
> Como **Andreus**, eu queria puxar as vagas do LinkedIn direto.

**Recusado.** Viola a §8.2 do User Agreement e arrisca a conta que é o principal
ativo de posicionamento. O caso *hiQ v. LinkedIn* costuma ser citado como
precedente favorável e **não é**: a hiQ perdeu por quebra de contrato, pagou
US$ 500 mil e levou injunção permanente. ADR 0001.

**Alternativa entregue:** E4 (alerta por e-mail), que é a via legítima.

---

## E2 — Triagem: decidir onde gastar as duas horas

### E2.1 ✅ Ranquear com justificativa lida por humano
> Como **Andreus**, quero saber *por que* uma vaga está no topo.

**Aceite**
- [x] Score 0–100 decomposto em 7 componentes
- [x] `reasons` em linguagem natural, mostradas na UI e na CLI
- [x] Determinístico: mesma entrada, mesma saída
- [x] `SCORER_VERSION` versionado; score velho é detectável
- [x] Nenhuma chamada de rede dentro do scoring (garantido por teste)

**Real:** versão 1.2.0. Pesos: cargo 30 · palavras-chave 27 · elegibilidade 15
· senioridade 10 · remuneração 8 · frescor 6 · benefícios 4.

---

### E2.2 ✅ Ver bloqueador antes de investir tempo
> Como **Andreus**, quero que "exige autorização nos EUA" apareça na lista, não
> no parágrafo onze.

**Aceite**
- [x] Bloqueador some ao score em vez de zerá-lo — vaga com "US preferred"
      continua visível, só não no topo
- [x] Bloqueadores listados na linha da vaga
- [x] Filtro para escondê-los

**Real:** 468 vagas com bloqueador. Mais comum: presença física (257).

---

### E2.3 ✅ Priorizar vaga que ainda dá tempo
> Como **Andreus**, quero que vaga recente suba, porque vaga de seis semanas já
> tem shortlist.

**Aceite**
- [x] Platô de 3 dias, depois meia-vida de 14
- [x] Data ausente pontua neutro, nunca punitivo
- [x] Data futura é clampada, não premiada
- [x] Idade e origem da data visíveis ("primeiro visto; pode ser mais antiga")

**Real:** 100% das vagas abertas têm data; 3.091 estão na janela de 3 dias.

---

### E2.4 ✅ Cruzar benefícios
> Como **Andreus**, quero ver quais vagas oferecem o que me importa.

**Aceite**
- [x] Detecção de 14 benefícios canônicos com aliases
- [x] Cruzamento com `required` / `preferred` / `nice_to_have` do perfil
- [x] Benefício `required` ausente vira bloqueador — **só em vaga legível**
- [x] Vaga com texto curto pontua neutro e nunca gera bloqueador

**Regra que sustenta o resto:** silêncio não é ausência. Vaga que não menciona
plano de saúde provavelmente tem — descrição pública costuma omitir a seção.

---

### E2.5 ✅ Filtrar, ordenar e paginar
> Como **Andreus**, quero cortar 6.239 vagas até uma lista que eu leia.

**Aceite**
- [x] Filtro por fit, fonte, cluster, remoto, bloqueador, faixa salarial
- [x] Ordenação por fit, valor, data
- [x] Paginação com contagem total
- [x] Estado do filtro na URL — o link é compartilhável e o botão voltar funciona
- [x] Sem JS de cliente para filtrar (Server Components)

---

### E2.6 ✅ Ler a vaga sem sair para o site
> Como **Andreus**, quero ler a descrição offline e só depois decidir abrir.

**Aceite**
- [x] Página própria por vaga com descrição completa
- [x] Botões separados: **ver** (descrição) e **aplicar** (formulário)
- [x] Breakdown do score na mesma tela

**Origem:** `/apply` do Lever pula a descrição. Dois botões distintos resolvem.

---

### E2.7 ✅ Comparar valores em moedas diferentes
> Como **Andreus**, quero comparar USD/ano com BRL/mês e preço fechado de
> projeto.

**Aceite**
- [x] `Money` = valor + moeda + período
- [x] Períodos: hora, dia, semana, mês, ano, **projeto**
- [x] Projeto anualiza por duração; sem duração, não pontua (não chuta)
- [x] Câmbio do BCE via Frankfurter, com cache e aviso de cotação velha
- [x] Faixas do candidato por moeda e período (piso / alvo / ideal)

---

## E3 — Funil: proteger o único dado insubstituível

### E3.1 ✅ Registrar estado da candidatura
> Como **Andreus**, quero acompanhar cada candidatura sem planilha.

**Aceite**
- [x] 10 estados, de `backlog` a `archived`
- [x] `jho track <id> <status> --channel referral`
- [x] Mesma mutação na UI (`setApplicationStatus`, caminho único)
- [x] Log de eventos com `fromStatus` e `toStatus`
- [x] `appliedAt` marcado uma vez e **nunca reescrito**

**Por que importa:** é o único dado que um novo sync não reconstrói. Ingestão
nunca escreve em `application` — garantido por teste de arquitetura.

---

### E3.2 ✅ Achar vaga onde já conheço alguém
> Como **Andreus**, quero saber onde minha rede de 20 anos vale indicação.

**Aceite**
- [x] `jho contacts` + `jho referrals`
- [x] Cruzamento por empresa
- [x] Indicação sobe na priorização

**Limite honesto:** só funciona com empregador nomeado — 26% do acervo.

---

## E4 — E-mail: a via legítima

### E4.1 ✅ Extrair vaga de alerta por e-mail
> Como **Andreus**, quero que os 34 alertas acumulados virem vagas no sistema.

**Aceite**
- [x] Parser MIME próprio, sem dependência
- [x] Extrai título, empresa e URL de alerta do LinkedIn
- [x] `--dry-run`
- [x] Classificador enviesado para `unknown` — na dúvida não decide

---

### E4.2 🔨 Detectar mudança de funil no e-mail
> Como **Andreus**, quero que "infelizmente seguimos com outros candidatos" me
> sugira marcar como rejeitado.

**Aceite**
- [x] Classificador gera `mail_suggestion`
- [x] `jho mail accept <id>` / `dismiss <id>`
- [x] **E-mail nunca muda o funil sozinho** — só sugere
- [ ] OAuth do Gmail (**F-01** — hoje exige `.eml` exportado à mão)

**Trava de projeto:** e-mail é sinal de sourcing, jamais gatilho de ação.
ADR 0008.

---

## E5 — Candidato: o perfil como fonte da verdade

### E5.1 ✅ Manter o perfil como dado
> Como **Andreus**, quero mudar meus critérios sem mexer em código.

**Aceite**
- [x] `profile.yaml` valida por Zod
- [x] `evidence:` separado de `growth:`
- [x] Mudança no perfil exige bump de `SCORER_VERSION`

---

### E5.2 ✅ Editar o CV como no Obsidian
> Como **Andreus**, quero colar meu CV num editor Markdown com Vim.

**Aceite**
- [x] CodeMirror 6 com `@replit/codemirror-vim`
- [x] Preview de Markdown
- [x] Persistência em `candidate_document`
- [ ] Upload de PDF com extração (**planejado**)

---

### E5.3 ✅ Extrair skills automaticamente
> Como **Andreus**, quero que o sistema leia meu CV e monte minhas skills.

**Aceite**
- [x] Três estratégias com peso: `alias` 1,0 · `declared` 0,8 · `applied` 1,3
- [x] Confiança calculada, com repetição saturante
- [x] Catálogo global de skills
- [x] Domínio puro, sem infraestrutura (garantido por teste)
- [x] Rotina reutilizável — contexto isolado, portas explícitas

**Por que "applied" pesa mais:** "usei X para entregar Y" é evidência mais forte
que uma lista de tecnologias no rodapé. A hierarquia do peso é uma afirmação de
recrutamento, não de engenharia.

---

### E5.4 📋 Curar o catálogo global
> Como **Marcos**, quero revisar detecções e fundir duplicatas.

**Aceite**
- [ ] Fila de revisão ordenada por impacto
- [ ] Fundir, rejeitar, promover, criar alias
- [ ] Alias novo melhora retroativamente todos os candidatos
- [ ] Decisão fica auditável

---

### E5.5 📋 Fechar a lacuna de vocabulário
> Como **Andreus**, quero saber que meu CV nunca escreve "observability" embora
> 51% das vagas-alvo peçam.

**Aceite**
- [ ] Diff entre vocabulário do CV e das vagas com fit ≥ 60
- [ ] Termos ordenados por frequência nas vagas-alvo
- [ ] Só sugere termo com evidência correspondente em `evidence:`
- [ ] Nunca propõe texto sem lastro

**Descoberta independente:** o sistema chegou à mesma conclusão da auditoria
humana §7.2, por caminho diferente.

---

## E6 — Posicionamento

### E6.1 ✅ Plano de posicionamento como dado
> Como **Andreus**, quero a auditoria do meu LinkedIn como tarefas rastreáveis.

**Aceite**
- [x] `positioning_task` populada a partir da auditoria
- [x] `jho tasks list --horizon 24h`

---

### E6.2 📋 Publicar via API oficial
> Como **Andreus**, quero publicar no LinkedIn a partir do sistema.

**Aceite**
- [ ] API oficial (`w_member_social`) apenas
- [ ] Comentário e conexão permanecem **assistidos**, nunca automatizados
- [ ] Nenhuma sessão autenticada dirigida

**Bloqueado por:** app de desenvolvedor do usuário.

---

## E7 — Aprender com o próprio funil

### E7.1 📋 Análise estatística do matching (E-02)
> Como **Andreus**, quero saber quais componentes do score realmente predizem
> resposta.

**Aceite**
- [ ] Correlação entre componente e resultado do funil
- [ ] Taxa de resposta por cluster, fonte e canal
- [ ] Recalibração de peso proposta, **nunca aplicada sozinha**
- [ ] Intervalo de confiança visível — 40 candidaturas não sustentam conclusão
      forte, e o sistema precisa dizer isso

**Bloqueado por dado:** 1 candidatura registrada. Precisa de ~30 com desfecho.

---

### E7.2 📋 Submissão autônoma (E-03)
> Como **Andreus**, quero que o sistema preencha o formulário por mim.

**Aceite**
- [ ] Só para vaga aprovada explicitamente, uma a uma
- [ ] Nenhuma submissão sem confirmação
- [ ] Registro completo do que foi enviado

**Ressalva de produto:** acelera o gargalo errado. Só faz sentido depois que
E7.1 provar que a triagem está calibrada. Ver antivisão em `vision.md`.
