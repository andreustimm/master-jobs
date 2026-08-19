# Pesquisa de fontes e limites legais

**Status:** histórico. Executado nesta sessão e nas anteriores; originou a
ADR 0001 (LinkedIn), a ADR 0008 (e-mail) e a lista em `config/sources.yaml`.

Não é um prompt de sistema em produção — nenhum código o executa. É o registro
de como as decisões de sourcing foram tomadas, para que sejam revisáveis.

---

## Papel assumido

```
Você é um profissional sênior de Recrutamento e Seleção com mais de 20 anos de
experiência, avaliando de onde vêm vagas de qualidade para um arquiteto de
software sênior brasileiro, remoto, contratado como PJ/B2B, sem autorização de
trabalho nos EUA.

Avalie fontes por: (1) o empregador é nomeado? (2) a elegibilidade geográfica é
explícita? (3) há API pública e estável? (4) os termos de uso permitem acesso
programático?

Trate ausência de proibição como ausência de informação, nunca como permissão.
```

## Consultas executadas

**Sobre a viabilidade legal de cada fonte**

- `LinkedIn API job search official access 2026`
- `LinkedIn User Agreement section 8.2 automated access scraping`
- `hiQ Labs v LinkedIn final ruling outcome damages`
- `Greenhouse job board API public endpoint documentation`
- `Lever postings API public documentation`
- `Ashby job board API public`
- `robots.txt legal status web scraping court`

**Sobre cobertura e qualidade**

- `remote job boards LATAM contractors B2B hiring`
- `AI architect remote jobs aggregator API free`
- `job board API without authentication 2026`

## Achados que mudaram decisões

**O caso hiQ é citado ao contrário.** A busca por `hiQ Labs v LinkedIn final
ruling` foi feita esperando confirmar que scraping de dado público é permitido —
que é como o caso costuma ser resumido. O desfecho real é o oposto: a hiQ
**perdeu** por quebra de contrato, pagou US$ 500 mil e recebeu injunção
permanente. Isso reforçou a ADR 0001 em vez de enfraquecê-la, e é a razão de
o projeto não ter nem um caminho de scraping do LinkedIn.

**Job alert por e-mail é a via legítima.** O usuário já recebe alertas do
LinkedIn no e-mail dele. Ler a própria caixa não é acesso automatizado à
plataforma. Isso virou a ADR 0008, com três travas: uma conta real, e-mail é
sinal de sourcing e nunca gatilho de ação, e nada é redistribuído.

**Empregador nomeado vale mais que volume.** 73,6% do acervo vinha de um
agregador que oculta a empresa por design, o que quebra indicação, dedupe e
pesquisa prévia. Originou o adapter `careers` (E-04) e a métrica de sourcing
"vagas com empregador nomeado", em vez de "vagas".
