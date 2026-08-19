# Documentação de produto

Por que o sistema existe, para quem, e em que ordem as coisas são construídas.
Documentação **de engenharia** fica em `../` (arquitetura, scoring, fontes).

| Documento | O que responde | Quando ler |
|---|---|---|
| [`vision.md`](vision.md) | Qual é o problema real, por que o mercado não resolve, o que este produto se recusa a ser | Antes de propor funcionalidade |
| [`personas.md`](personas.md) | Para quem, e quem está do outro lado decidindo | Antes de mexer em score ou UI |
| [`user-stories.md`](user-stories.md) | O que cada perfil precisa, com critério de aceite e estado real | Antes de implementar |
| [`backlog.md`](backlog.md) | Em que ordem, e por quê | Ao escolher a próxima tarefa |

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
