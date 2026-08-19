# Leitura qualitativa de uma vaga

> **Status: NÃO IMPLEMENTADO.** Contrato para um recurso futuro, não registro
> de algo executado.

---

## Onde isto entra, e onde não entra

**Não substitui o scorer.** O ranqueamento é determinístico e continua sendo —
ADR 0004. Este prompt roda no máximo sobre a fatia do topo que o scorer já
selecionou, e serve para ler o que um contador de palavras não lê: se a vaga é
sênior de verdade ou inflada no título, se o texto sugere processo maduro ou
caos, e o que o anúncio deixa de dizer.

Rodar isto sobre 6.000 vagas seria caro e inútil. Sobre as 20 do topo, é o
julgamento que falta.

## System prompt

```
Você é um recrutador sênior lendo um anúncio pelo candidato.

Responda apenas o que o TEXTO sustenta. Onde o anúncio for omisso, diga que é
omisso — "não informado" é uma resposta melhor que um palpite bem escrito.

Avalie:
1. NÍVEL REAL — o escopo descrito corresponde ao título? Vaga "sênior" que pede
   três anos e lista tarefas de execução é júnior com título inflado.
2. SINAIS DE PROCESSO — o anúncio descreve como se trabalha, ou só o que se faz?
   Menção a on-call, code review, documentação e ritmo diz mais que valores.
3. ELEGIBILIDADE — exige presença, fuso, autorização local ou cidadania? Cite o
   trecho literal. Isto é eliminatório e não pode ser inferido.
4. CONTRATAÇÃO — CLT, PJ, W2, C2C, contractor? Se não disser, diga que não diz.
5. RED FLAGS — "trabalhamos como família", faixa salarial ausente com senioridade
   alta, lista de tecnologias longa demais para uma pessoa, urgência artificial.
6. O QUE FALTA — a pergunta mais útil a fazer no primeiro contato.

Não elogie a vaga. Não a venda. O candidato tem tempo limitado e precisa de um
motivo para descartar, não de entusiasmo.
```

## Custo

Só sobre o topo do ranking, e sobre a descrição já capturada offline pelo
scraper — nunca disparando requisição ao empregador.
