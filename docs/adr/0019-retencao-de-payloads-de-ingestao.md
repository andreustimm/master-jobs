# ADR 0019 — Payload de ingestão é temporário, texto normalizado é durável

**Status:** aceita · 2026-08-29

## Contexto

O banco local de produção chegou a 525,7 MiB com 13.384 vagas. A medição por
`dbstat` mostrou 275,0 MiB em `job` e 139,8 MiB em `job_page`. A composição dos
campos grandes era:

| Campo | Volume |
|---|---:|
| `job_page.html` | 137,1 MiB |
| `job.raw` | 125,3 MiB |
| `job.description_html` | 67,7 MiB |
| `job.description_text` | 65,7 MiB |

Os três primeiros são entradas reconstruíveis. O último é o texto útil lido
pelo scorer e pela interface. Guardar todos eles transformou cada vaga em até
quatro cópias da mesma descrição.

Ao mesmo tempo, o grupo Turso ultrapassou a cota mensal de leituras. Tamanho e
leituras são métricas diferentes, mas campos grandes amplificam transferência,
backup e custo de toda operação que materializa a linha completa.

## Decisão

1. Adapter pode receber HTML e payload integral, mas `observeRawJob()` persiste
   apenas `description_text` e, quando declarado, o `workplaceType` mínimo para
   manter o filtro de modalidade das fontes de rede.
2. `raw` continua durável para fontes `manual` e `recruiter`, porque ali guarda
   notas e proveniência escritas por uma pessoa. Fontes reconstruíveis gravam
   apenas `{ workplaceType }` quando esse sinal existe; o restante vira `{}`.
3. `job_page.html` existe só entre captura e tratamento. Extração bem-sucedida
   grava `text` e `extracted` e zera o HTML na mesma transição.
4. Falha de extração preserva o HTML, permitindo `scrape reparse` depois de uma
   correção. Sucesso exige novo fetch para reprocessar no futuro.
5. `jho db cleanup` é dry-run por padrão. `--apply` remove payload legado e
   vagas fechadas antigas sem candidatura. `application` nunca é alterada.
6. Uma Action semanal executa a retenção em produção depois da varredura.

Esta decisão substitui apenas o invariante 4 da ADR 0009. A fila em tabela, as
duas etapas, robots.txt e a política de concorrência permanecem vigentes.

## Consequências

**Boas.** Numa cópia real, a rotina identificou 329,7 MiB reconstruíveis. Após
a limpeza, `dbstat` caiu para aproximadamente 108 MiB usados; `job_page` caiu
de 139,8 para 2,9 MiB. Novas ingestões não recriam o passivo.

**Ruins.** Melhorar o extrator não reprocessa páginas que já tiveram sucesso;
é necessário reenfileirar com `--refresh` e buscar novamente.

**Aceita.** Um corpus operacional pequeno e previsível vale mais que conservar
indefinidamente a resposta original de serviços externos.

## Leitura e cota

Retenção não zera consumo mensal já contabilizado. Para reduzir novas leituras,
as seis contagens do cockpit foram reunidas em uma única agregação condicional,
reduzindo essa parte de seis varreduras completas para uma.
