# ADR 0008 — Ingestão de e-mail como fonte de sourcing

**Status:** Aceita · 2026-08-18
**Decisores:** Andreus Timm
**Relacionada:** complementa a [ADR 0001](0001-nao-fazer-scraping-do-linkedin.md); não a revoga.

## Contexto

A ADR 0001 registrou uma perda honesta: vaga publicada só no LinkedIn não é
capturada. O LinkedIn não tem API pública de busca de vagas, e a única via que
retorna esses dados dirige a sessão autenticada do membro — o que a ADR recusou.

Andreus propôs o caminho que estava na caixa de entrada dele o tempo todo: o
LinkedIn **envia** job alerts por e-mail. Parsear a própria correspondência não
toca a plataforma.

O benchmark competitivo investigou a questão a fundo
(`docs/benchmark/frente-c-autoapply-e-risco-linkedin.md`) e trouxe um fato que
reforça a decisão original mais do que a enfraquece.

### O que o caso hiQ realmente decidiu

A memória popular parou em 2019/2022, quando o Ninth Circuit manteve a liminar a
favor do hiQ sob a **CFAA**. O desfecho foi o oposto:

- **04/11/2022** — julgamento sumário para o LinkedIn na pretensão de **quebra de
  contrato**: o hiQ violou o User Agreement.
- **06/12/2022** — acordo e consent judgment: **US$ 500 mil**, responsabilidade
  reconhecida por *trespass to chattels* e *misappropriation*, e **injunção
  permanente** para cessar o scraping e **destruir todo código, dado e algoritmo**
  derivados do LinkedIn.

> **Invariante:** o hiQ removeu a **CFAA** do caminho para dado público e
> deslogado. Não tocou em **contrato** — e contrato é a arma que o LinkedIn
> efetivamente usa. Qualquer argumento futuro que invoque "hiQ ganhou" para
> justificar scraping está partindo de premissa falsa.

## Decisão

**Ingerir job alerts do LinkedIn a partir da caixa de entrada do próprio usuário
é permitido.** É a aplicação consistente do princípio da ADR 0001 — *nada toca a
plataforma* —, não uma exceção a ele.

### Por que não aciona a §8.2

| Cláusula | Texto-chave | Acionada? | Por quê |
|---|---|---|---|
| item 2 | scrape or copy **the Services** | Não | O e-mail entregue não é "the Services". Nenhum endpoint é tocado |
| item 3 | bypass **access controls** | Não | Nada é contornado; o conteúdo foi enviado voluntariamente |
| item 13 | bots to **access the Services** | Não | Não há acesso. O modelo é **push**, não pull |
| item 1 | identidade falsa | Não | Desde que o alerta venha da conta real do usuário — ver Trava 1 |
| item 4 | copy, use, display or **distribute** | **Zona cinzenta** | Ver abaixo |

O item 4 é a única cláusula com alcance textual, e merece honestidade em vez de
racionalização. Ele não tem carve-out de uso pessoal, e uma leitura maximalista
alcança qualquer conteúdo de origem LinkedIn. Contra essa leitura pesam três
pontos: o LinkedIn **transmitiu deliberadamente** o alerta ao membro e usá-lo
para achar vaga é o propósito para o qual foi enviado; o vetor de dano da
cláusula é **"distribute"** — revenda, agregação, brokerage, exatamente o que foi
litigado em hiQ e em Proxycurl; e o dono do conteúdo do texto de uma vaga é a
**empresa contratante**, não o LinkedIn.

> **Invariante:** a conclusão correta é *"não aciona as cláusulas que mordem"* —
> **não** é *"expressamente autorizado"*. Nunca escreva que o LinkedIn permite.
> Quem escalar a partir dessa premissa falsa estará construindo sobre areia.

### Por que o argumento de enforcement é mais forte que o jurídico

Toda a detecção do LinkedIn — velocidade, fingerprint de navegador, artefatos de
extensão no DOM, IP mismatch, cadência de sessão — opera **sobre a sessão**. Uma
caixa de entrada é invisível para ela. Não há sinal a emitir porque não há
interação.

A pesquisa não localizou nenhum caso, ação ou restrição contra alguém por
parsear os próprios e-mails de alerta. Ausência de caso não é prova de permissão,
mas é coerente com a análise de superfície. E a prática é comercialmente aberta:
Parsio, Mailparser e Parseur vendem exatamente isso como produto, publicamente,
com o LinkedIn nomeado nos materiais.

## As três travas

Sem elas, "e-mail" vira a porta dos fundos por onde o scraping volta.

> **Trava 1 — Uma conta, real, do próprio usuário.** O alerta chega da conta
> legítima do Andreus, com preferências configuradas **à mão** na interface.
> Zero contas extras, zero conta "de coleta", zero alerta criado por script.
> O item 1 da §8.2 (identidade falsa) é a linha mais dura que o LinkedIn tem —
> criar conta secundária troca um risco inexistente pelo pior risco do catálogo.

> **Trava 2 — O e-mail é fonte de *sourcing*, nunca gatilho de ação na
> plataforma.** O pipeline extrai título, empresa, local, URL e data. **Não
> pode** seguir a URL com automação, abrir o Easy Apply, ou enriquecer buscando
> a empresa no LinkedIn. No instante em que o software segue o link, voltamos ao
> item 13 e perdemos toda a proteção. O e-mail entrega o **sinal**; a resolução
> da vaga vai para o ATS público (ADR 0003) ou para o humano.

> **Trava 3 — Nada é redistribuído.** Sem publicação, sem dataset compartilhado,
> sem repasse a terceiros, sem commit do conteúdo bruto no git. O item 4 só vira
> risco real quando há distribuição. O dado fica em `data/jobs.db`, local — que
> já é gitignored.

Arquitetura resultante:

```
push do LinkedIn → parse local → correspondência com fonte de ATS → scorer
```

O LinkedIn nunca é consultado.

## Acesso à caixa de entrada

Este é um problema de termos do **Google**, não do LinkedIn. Usar a Gmail API com
OAuth sobre a própria conta, escopo **somente leitura**
(`gmail.readonly`), é caminho oficial e documentado.

> **Invariante:** nunca armazenar senha de e-mail. OAuth com refresh token, ou
> senha de app específica revogável. O token entra no `.gitignore` junto com os
> demais segredos.

## Consequências

**Positivas**

- Fecha a única lacuna de cobertura declarada na ADR 0001, sem reabrir o risco.
- Habilita três métricas que hoje não existem, a partir dos e-mails de ATS
  (confirmação, triagem, agendamento, rejeição): tempo de resposta por empresa,
  ghosting explícito, e **rejeição segmentada por estágio** — que são três
  problemas diferentes com correções diferentes.
- O funil passa a ser alimentado por evidência, não por memória.

**Negativas**

- Depende de o usuário manter alertas configurados no LinkedIn.
- O texto do e-mail é resumido; a descrição completa continua vindo do ATS.
- Adiciona uma superfície de credencial (OAuth do Google) que hoje não existe.
- Parsing de e-mail é frágil por natureza: o LinkedIn muda o template sem aviso,
  e o parser precisa falhar de forma visível em vez de silenciosa.

## Alternativas consideradas

**Manter a lacuna.** Foi a posição da ADR 0001, tomada quando esta via não havia
sido identificada. Não se sustenta agora que existe caminho sem risco.

**IMAP com senha de aplicativo.** Mais simples de implementar, mas guarda uma
credencial de longa duração com acesso total à conta. OAuth com escopo de leitura
é estritamente melhor pelo mesmo esforço.

**Encaminhar alertas para um endereço dedicado.** Reduz o escopo de acesso, mas
adiciona uma regra de encaminhamento persistente na conta do usuário — que é
justamente o tipo de configuração permanente que deve ser decisão dele, não
efeito colateral de uma escolha de implementação. Fica disponível como opção.
