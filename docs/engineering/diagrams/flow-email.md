# Fluxo — ingestão de e-mail

`pnpm jho mail import` — a implementação da [ADR 0008](../../adr/0008-ingestao-de-email-como-fonte-de-sourcing.md).

```mermaid
flowchart TD
  files([arquivos .eml]) --> parse[parseEml<br/>headers dobrados, encoded-words,<br/>multipart, quoted-printable, base64]
  parse --> dedupe{Message-ID<br/>já visto?}
  dedupe -->|sim| skip[pula — duplicata]
  dedupe -->|não| classify[classify<br/>assunto + remetente + 6k do corpo]

  classify --> kind{tipo}

  kind -->|job_alert| extract[extractAlertJobs<br/>título, empresa, local, URL]
  extract --> canon[canonicalJobUrl<br/>remove tracking]
  canon --> upsert[(upsertRawJob<br/>source manual:linkedin-alert)]
  upsert --> nodesc[["sem descrição, de propósito:<br/>o alerta é ponteiro (Trava 2)"]]

  kind -->|ats_*| match[companyCandidates<br/>1. nome de exibição<br/>2. domínio, se não for ATS<br/>3. assunto]
  match --> live{candidatura<br/>viva casa?}
  live -->|sim| sug[(mail_suggestion<br/>com rationale e confiança)]
  live -->|não| sug2[(mail_suggestion<br/>sem application_id)]

  kind -->|unknown| store[(mail_message<br/>só registra)]

  sug --> human{{humano revisa<br/>jho mail suggestions}}
  sug2 --> human
  human -->|accept| apply[setApplicationStatus<br/>cai em application_event]
  human -->|dismiss| drop[status = dismissed]

  style nodesc fill:#ffe,stroke:#9a6b12
  style human fill:#eef,stroke:#024ad8,stroke-width:2px
```

## A fronteira que o diagrama existe para mostrar

> **Nenhuma seta liga o parsing diretamente a `application`.** Todo caminho de
> e-mail termina numa sugestão que um humano aceita ou descarta. Um parser de
> rejeição que erra uma vez e fecha silenciosamente um processo vivo violaria a
> ADR 0005 do modo mais caro possível — "sem resposta" é indistinguível de
> "rejeitado" para quem parou de fazer follow-up.

## Por que o alerta entra sem descrição

A Trava 2 da ADR 0008 proíbe seguir o link do alerta com automação. O e-mail
entrega o **sinal**; a resolução para o anúncio completo acontece pelas fontes
de ATS públicas. Consequência aceita: essas vagas pontuam baixo em keywords, e
a UI marca "sem descrição — a nota está subestimada, não baixa".

## Por que o classificador prefere `unknown`

Classificação perdida custa uma edição manual. Rejeição falsa custa uma
oportunidade. Por isso as regras de rejeição exigem frase explícita e carregam
uma lista `none` que impede, por exemplo, que um alerta contendo "unfortunately"
seja lido como rejeição.
