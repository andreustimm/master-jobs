# Visão de produto

> Documento vivo. Números conferidos em 18/08/2026 contra `data/jobs.db`.
> Quando um número aqui divergir do banco, o banco está certo.

---

## 1. O problema, dito com precisão

A formulação preguiçosa é "encontrar vagas é difícil". Ela é falsa, e o próprio
banco desmente: há **6.239 vagas abertas** no acervo, vindas de 13 fontes, com
1.031 empresas. Encontrar vaga não é o problema. Nunca foi.

O problema aparece quando se olha o funil:

| | |
|---|---:|
| Vagas no acervo | 6.239 |
| Vagas com fit ≥ 45 | 1.600 |
| Vagas com fit ≥ 60 | 207 |
| Candidaturas registradas | **1** |

Essa última linha é o produto inteiro em um número. O acervo cresceu três
ordens de grandeza acima da capacidade humana de agir sobre ele.

**O gargalo é a decisão, não a descoberta.** Uma candidatura que presta — CV
ajustado ao vocabulário da vaga, carta que demonstra leitura real da empresa,
checagem de que a vaga ainda existe — custa entre 40 e 90 minutos. Quem tem
duas horas por dia consegue de 8 a 12 candidaturas boas por semana. O acervo
oferece 1.600 candidatas plausíveis. A pergunta que importa não é "que vagas
existem", é:

> **Destas 1.600, em quais 10 eu gasto as próximas duas horas?**

Todo o resto do sistema existe para responder isso de forma auditável.

---

## 2. Por que o mercado não resolve isso

Três padrões dominam as ferramentas existentes, e os três falham para este
usuário por motivos estruturais, não por falta de polimento:

**Agregadores (LinkedIn Jobs, Indeed, Wellfound).** Otimizam para volume de
candidaturas, porque o cliente pagante é o empregador. "Candidatura simplificada"
é o produto deles funcionando — e é exatamente o comportamento que produz
resposta zero. Nenhum deles tem incentivo para dizer "não se candidate a esta".

**Auto-appliers (LazyApply, Sonara, e a leva de 2025-2026).** Aceitam a premissa
do agregador e a aceleram: 200 candidaturas por dia, taxa de resposta que
desaba. Resolvem o gargalo errado, com convicção.

**Trackers (Teal, Huntr, Simplify).** Registram o que o usuário já decidiu.
Chegam depois da decisão, que é justamente a parte cara.

Nenhuma dessas categorias faz a única coisa que este usuário precisa: **ranquear
com justificativa lida por humano, e defender o tempo dele de vagas que não
merecem.**

---

## 3. Storytelling — três cenas

### Cena 1 — A terça-feira que este sistema existe para eliminar

São 21h40. Andreus abre a caixa de entrada e encontra 34 e-mails de alerta de
vaga acumulados desde segunda. Abre sete abas. Duas dão 404 — a vaga foi
preenchida ou nunca existiu. Três são anúncios de recrutadora sem nome de
empresa, e ele não tem como saber se já se candidatou àquela mesma vaga por
outro caminho na semana passada. Uma pede autorização de trabalho nos EUA, o que
ele descobre no parágrafo onze. A sétima é boa — e é a mesma vaga que ele viu
na sexta-feira, quando também achou boa, e também não se candidatou porque eram
23h.

Ele fecha o notebook às 22h20 tendo se candidatado a zero vagas. Não por
preguiça: por **falta de um critério que não precise ser reconstruído do zero
toda noite.**

### Cena 2 — A mesma terça, com o sistema

Ele roda `jho jobs sync`. Onze minutos depois, abre `localhost:3000`.

A tela mostra 23 vagas com fit ≥ 70. As mortas já foram fechadas pela
verificação de links — 314 até hoje. As que exigem presença física ou cidadania
já estão marcadas com bloqueador visível: são 468 no acervo, e ele não abre
nenhuma delas por engano. Cada vaga traz uma barra decomposta em sete
componentes, e ele consegue ler *por que* a nota é aquela: "Cargo 27,4 ·
Palavras-chave 21 · Elegibilidade 15 · Frescor 6 · Benefícios 2,4".

Ele escolhe quatro. Gasta as duas horas nelas. Registra no funil.

A diferença entre as duas cenas não é ter mais vagas. É ter **menos vagas, com
motivo declarado.**

### Cena 3 — Seis semanas depois

O funil tem 40 candidaturas com data. O sistema sabe qual cluster de cargo
converte ("architect" responde 3× mais que "backend"), qual canal converte
(referral acima de candidatura fria), e quantos dias em média a vaga leva do
`applied` ao primeiro retorno.

Aí o produto muda de natureza: sai de "ranqueia vagas" e vira **"aprende com o
funil do próprio usuário e recalibra o ranking"**. Nenhum agregador pode fazer
isso, porque nenhum deles vê o resultado.

Essa cena ainda não aconteceu. É para onde o roadmap aponta.

---

## 4. O paradoxo do acervo

O dado mais desconfortável do banco, e o que mais dirige o roadmap:

| Fonte | Vagas | Fit médio | Empregador anônimo |
|---|---:|---:|---:|
| Jobgether (via Lever) | 4.592 | 38,4 | **4.592 (100%)** |
| Himalayas | 1.190 | 32,7 | 0 |
| Arbeitnow | 173 | 31,0 | 0 |
| Braintrust | 119 | 29,5 | 0 |
| RemoteOK | 100 | 28,8 | 0 |
| Ashby / Greenhouse diretos | 48 | **~50** | 0 |

**73,6% do acervo vem de uma fonte que esconde quem é o empregador**, por design
("on behalf of a partner company"). Isso quebra três coisas de uma vez:
o cruzamento com a rede de contatos (não dá para pedir indicação numa empresa
sem nome), a deduplicação entre fontes (a mesma vaga aparece duas vezes), e a
pesquisa prévia que faz a carta valer alguma coisa.

E as fontes com fit médio mais alto — ATS de empresa, acessados direto — somam
**48 vagas**. Um trigésimo do que o agregador anônimo entrega.

> **Consequência de produto:** volume e qualidade estão em fontes opostas. O
> roadmap privilegia acrescentar ATS diretos, mesmo que cada um traga dezenas e
> não milhares. A métrica de saúde de sourcing não é "quantas vagas" — é
> **"quantas vagas com empregador nomeado e fit ≥ 60"**.

---

## 5. Princípios

**1. Decisão acima de descoberta.** Funcionalidade que aumenta o acervo sem
melhorar a triagem tem prioridade baixa por padrão.

**2. Todo número é auditável.** Nenhum score sai sem decomposição legível. Se o
usuário não consegue discordar da nota com argumento, a nota não presta.
É por isso que o scoring é determinístico e não uma chamada de LLM.

**3. Silêncio não é ausência.** Vaga sem descrição não é vaga sem benefício;
fonte sem data de publicação não é vaga velha. Dado faltante pontua neutro,
nunca punitivo — senão o sistema rebaixa fontes pela qualidade da API delas em
vez da qualidade do emprego.

**4. A decisão do usuário é sagrada.** Ingestão jamais escreve em `application`.
É o único dado que um novo sync não reconstrói.

**5. Nada que arrisque a conta do LinkedIn.** O perfil é o principal ativo de
posicionamento. Scraping economiza horas e pode custar a conta — troca ruim em
qualquer cenário. E-mail de alerta é a via legítima (ADR 0008).

**6. Não inventar evidência.** CV ajustado só cita o que está em `evidence:`.
Lacuna assumida se sinaliza, não se maquia.

---

## 6. Antivisão — o que este produto não vai ser

- **Não é auto-applier.** Submissão autônoma existe no roadmap (E-03) apenas
  para vagas que o usuário aprovou explicitamente, uma a uma.
- **Não é rede social nem job board.** Não hospeda vaga nem redistribui acervo.
- **Não é um LLM que decide.** LLM entra para redigir e para explicar, nunca
  para ranquear — ranking precisa ser reproduzível.
- **Não é multi-tenant hoje.** A modelagem já é multi-candidato (`candidate`,
  `candidate_document`, `candidate_skill`), mas o produto roda local, para um.

---

## 7. Métricas

**Métrica-norte:** candidaturas de alta qualidade por semana com resposta.
Não candidaturas enviadas — respondidas.

| Camada | Métrica | Hoje | Alvo |
|---|---|---:|---:|
| Sourcing | Vagas com empregador nomeado e fit ≥ 60 | ~55 | 200 |
| Sourcing | Links mortos no top 100 | 0% | < 2% |
| Triagem | Vagas fit ≥ 70 abertas | 23 | 40 |
| Triagem | Tempo do sync até uma shortlist | ~15 min | < 5 min |
| Ação | Candidaturas por semana | — | 8–12 |
| Ação | Taxa de resposta | sem dado | ≥ 15% |
| Confiança | % do score explicável na tela | 100% | 100% |

As duas linhas "sem dado" são a razão de E-02 existir no backlog: sem funil
populado, o sistema não pode aprender com o próprio resultado.

---

## 8. Estágio atual, sem maquiagem

**Funciona:** 13 fontes, scoring determinístico versionado (1.2.0) com sete
componentes, câmbio multimoeda, funil com log de eventos, parser de e-mail,
referrals, verificação de links, dashboard Next.js, extração de skills,
export CSV e Markdown.

**Não existe:** OAuth do Gmail (parser pronto, autenticação não), geração de CV
e carta, publicação no LinkedIn, submissão autônoma, upload de PDF, deploy.

Ver `roadmap.md` e `backlog.md`. E, conforme `CLAUDE.md`: **não descreva como
pronto o que não está.**
