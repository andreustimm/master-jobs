# Documentação de produto

Por que o sistema existe, para quem e quais contratos o produto cumpre.
Documentação **de engenharia** fica em `../` (arquitetura, scoring, fontes).

A ordem de construção, o estado e os responsáveis são mantidos nas issues de
`andreustimm/master-jobs` no [GitHub Project 3](https://github.com/users/andreustimm/projects/3).
Use o [fluxo de tarefas](../engineering/github-project-tasks.md) para começar
ou retomar. As marcações de backlog e histórias abaixo registram o momento da
escrita; a [reconciliação do legado](../engineering/github-project-migration.md)
preserva seus contratos e identifica vínculos sem lhes dar autoridade operacional.

| Documento | O que responde | Quando ler |
|---|---|---|
| [`vision.md`](vision.md) | Qual é o problema real, por que o mercado não resolve, o que este produto se recusa a ser | Antes de propor funcionalidade |
| [`personas.md`](personas.md) | Para quem, e quem está do outro lado decidindo | Antes de mexer em score ou UI |
| [`user-stories.md`](user-stories.md) | O que cada perfil precisa, com critérios de aceite e marcações históricas | Ao preparar o contrato da issue |
| [`backlog.md`](backlog.md) | Pedidos e justificativas capturados no discovery; snapshot histórico | Ao investigar a origem de uma demanda |

---

## A tese, em cinco linhas

O acervo tem **6.239 vagas abertas** e o funil tem **1 candidatura**. Encontrar
vaga nunca foi o gargalo — decidir em quais das 1.600 plausíveis gastar as duas
horas de hoje é. Agregadores otimizam volume porque quem paga é o empregador;
auto-appliers aceleram o gargalo errado; trackers chegam depois da decisão.
Este sistema faz a única coisa que falta: **ranqueia com justificativa
auditável e defende o tempo do usuário de vagas que não merecem.**

## O que dirige a prioridade

**73,6% do acervo vem de uma fonte que esconde o empregador.** As fontes com
melhor fit médio — ATS de empresa, direto — somam 48 vagas. Volume e qualidade
estão em lados opostos, e a métrica de sourcing por isso não é "quantas vagas",
é **"quantas vagas com empregador nomeado e fit ≥ 60"**.

## Regras que não se negociam

1. Decisão acima de descoberta
2. Todo número é auditável
3. Silêncio não é ausência — dado faltante pontua neutro, nunca punitivo
4. A decisão do usuário é sagrada — ingestão jamais escreve no funil
5. Nada que arrisque a conta do LinkedIn
6. Não inventar evidência

Detalhe e consequência de cada uma em [`vision.md`](vision.md#5-princípios).
