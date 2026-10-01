# QA dirigido — empregador direto e densidade — #397

- Scope: fix/empregador-densidade-397; standalone e PostgreSQL isolado.
- Cadence tier: targeted. Status: closed.
- Persona: Andreus em triagem, conta sintética Alex; Chromium, inglês, wifi local.
- Driver: agent-browser; desktop e 375×812.

## Session Matrix & Results

| Scenario | Tour | Resultado |
|---|---|---|
| JOBS-anonymous-employer-never-groups | Feature Tour | Pass no contraste fonte direta/agregador |
| Lista compacta entre mudanças | Configuration Tour | Pass no recorte manual |

## Session Debriefs

Alex entrou, abriu Vagas por see all e viu Staff Engineer Direct Career em
uma linha de Vercel, com Brasil/França. Na mesma lista, Staff Engineer
Anonymous Fixture continuou Grupo QA · employer hidden sem agrupamento.
Ao selecionar Named employer, Vercel continuou e o anônimo saiu. A leitura
independente após reload confirmou esses conteúdos.

Ligou Compact, selecionou Most recent e o filtro Named employer, com reload
em cada etapa. dense=1 e aria-current=page de Compact persistiram. Em 375px,
selecionou Untriaged e recarregou: densidade e agrupamento de Vercel
continuaram, sem overflow. Captura: docs/qa/evidence/2026-09-29T150058Z-empregador-densidade-397/careers-compacta-375.png.
A fixture manual tem poucas linhas; a segunda página foi percorrida no E2E.

## Validação automatizada

Antes: dois testes de regressão falharam — dense era perdido e o agrupamento
contava quatro linhas em vez de três. Depois: 120 testes relacionados
passaram, incluindo banco isolado, facetas e arquitetura; typecheck passou.
E2E auth,jobs-density: 24/24, com paginação, ordem, modalidade, GET, preset,
reload e overflow em desktop e 375px.

## Final Status

Recorte revalidado por interface pública e leitura independente. Sem escrita
em produção; PR draft aguarda revisão L1 da coordenadora.
