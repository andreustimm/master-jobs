# Ingestão de e-mail

Implementação da [ADR 0008](adr/0008-ingestao-de-email-como-fonte-de-sourcing.md).
Leia a ADR antes de mexer aqui — ela contém as três travas que tornam este
caminho defensável, e este documento pressupõe que você as conhece.

## O que faz

```
.eml → parse → classifica → ┬→ job alert  → vagas no acervo
                            └→ e-mail ATS → sugestão de funil (nunca aplicada)
```

```bash
pnpm jho mail import ~/mail/alertas --dry-run   # classifica sem gravar
pnpm jho mail import ~/mail/alertas
pnpm jho mail suggestions                        # o que o e-mail sugere
pnpm jho mail accept 2                           # você decide
pnpm jho mail dismiss 1
```

> **Invariante:** parsear e-mail **nunca** escreve em `application`. Grava em
> `mail_suggestion` e o usuário aceita ou descarta. Um parser de rejeição que
> erra uma vez e fecha silenciosamente um processo vivo violaria a ADR 0005 do
> modo mais caro possível — e "sem resposta" é indistinguível de "rejeitado"
> para quem parou de fazer follow-up.

Quando você aceita, a mudança passa por `setApplicationStatus` como qualquer
outra, então fica registrada em `application_event` igual a uma transição
manual. Não há caminho paralelo.

## Como obter os .eml

Sem OAuth ainda. Hoje é exportação manual:

| Cliente | Como |
|---|---|
| Gmail (web) | Abrir a mensagem → ⋮ → *Download message* |
| Apple Mail | Selecionar → arrastar para uma pasta |
| Thunderbird | Botão direito → *Save As* |

Aponte o `import` para a pasta. Ele aceita `.eml`, `.txt` e `.html`.

O caminho definitivo é a Gmail API com escopo `gmail.readonly` — decidido na
ADR 0008 §"Acesso à caixa de entrada", ainda **não implementado**.

## O parser

`src/core/mail/eml.ts` — RFC 5322/MIME mínimo, sem dependência externa.
Cobre o que este tipo de mensagem realmente usa:

- headers dobrados em linha indentada (perder isso corta metade de um Subject)
- MIME encoded-words `=?UTF-8?B?…?=` e `=?UTF-8?Q?…?=` — o LinkedIn codifica
  praticamente todo assunto, e o assunto é o sinal de classificação mais forte
- multipart aninhado, quoted-printable, base64, e conversão de charset

Não cobre assinatura, criptografia nem anexos. Nada disso é necessário para ler
um alerta de vaga.

## O classificador

`src/core/mail/classify.ts` classifica em `job_alert`, `ats_received`,
`ats_screening`, `ats_interview`, `ats_offer`, `ats_rejection`,
`recruiter_inbound` ou `unknown`.

**O viés é deliberado: na dúvida, `unknown`.** Uma classificação perdida custa
uma edição manual; uma rejeição falsa custa uma oportunidade. Por isso as
regras de rejeição exigem frase explícita e trazem uma lista `none` que impede,
por exemplo, que um alerta cujo texto contenha "unfortunately" seja lido como
rejeição.

Cada classificação carrega confiança e o sinal que a produziu, porque os dois
aparecem para você antes de aceitar qualquer mudança.

## O extrator de alertas

`src/core/mail/job-alert.ts` extrai título, empresa, local e URL de cada vaga.

Duas decisões que valem registro:

**A URL é normalizada** (`/comm/jobs/view/123/?trackingId=…` →
`/jobs/view/123`), senão o mesmo anúncio em dois alertas viraria duas vagas.

**Vagas de alerta entram sem descrição, e isso é correto.** O e-mail traz uma
linha de título. Elas pontuam baixo em keywords porque um alerta é um
*ponteiro* — a resolução para o anúncio completo acontece pelas fontes de ATS
públicas, conforme a Trava 2 da ADR 0008. **Nada neste código pode seguir o
link automaticamente.**

O extrator reporta links que não conseguiu resolver. Silêncio seria o pior
resultado: se o LinkedIn mudar o template, você veria "nenhuma vaga nova" para
sempre, sem nenhum sinal de que o parser quebrou.

## Casamento com o funil

Um e-mail de ATS precisa achar a candidatura correspondente. A ordem de sinais
importa:

1. **Nome de exibição do remetente** — quase sempre o melhor: os templates
   enviam como "Acme Corp", "Recruiting at Acme" ou "Acme via Greenhouse".
2. **Domínio do remetente**, apenas quando não é domínio de ATS — `ashbyhq.com`
   identifica a ferramenta, não o empregador.
3. **Assunto** — o mais ruidoso, último recurso.

Só candidaturas **vivas** entram no casamento. Uma rejeição não pode
re-rejeitar algo já encerrado, e considerar linhas fechadas geraria ruído a
cada reimportação.

## Limites conhecidos

- Sem OAuth: exportação manual dos `.eml`.
- Template de e-mail muda sem aviso. O extrator avisa quando não resolve, mas
  uma mudança grande exige ajustar as regex.
- O casamento por nome de empresa é heurístico — por isso o resultado é
  sugestão com justificativa visível, nunca ação automática.
- `Message-ID` é a chave de deduplicação; um `.eml` salvo à mão sem esse header
  cai para o caminho do arquivo.
