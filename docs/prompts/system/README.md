# System prompts

Registro dos prompts usados no projeto, e — igualmente importante — de onde
**não** há prompt nenhum.

---

## Correção de premissa: o sourcing de vagas não usa LLM

Nenhuma vaga deste acervo foi encontrada por um modelo de linguagem. As 5.932
vagas abertas vieram de **adapters determinísticos** que consomem APIs públicas
de ATS e agregadores:

```
src/core/sources/
  ats.ts          Greenhouse, Lever, Ashby, SmartRecruiters, Recruitee
  aggregators.ts  Himalayas, Remotive, Arbeitnow, RemoteOK, Adzuna
  braintrust.ts   Braintrust
  careers.ts      career page da própria empresa (HTML)
```

Cada um faz `fetch`, mapeia campos e retorna. Sem prompt, sem inferência.

**O ranqueamento também é determinístico** — `src/core/scoring/`, sete
componentes com pesos fixos. Isso é decisão registrada na ADR 0004, e o motivo
é direto: o score roda sobre milhares de vagas a cada sync, precisa ser
reproduzível em teste de regressão, e precisa ser auditável — você tem que
conseguir ler `reasons` e discordar da nota com argumento. Um LLM no lugar
disso daria respostas diferentes para a mesma entrada e nenhuma justificativa
verificável.

Então: **não existem system prompts de busca de vagas para armazenar**, porque
essa parte do sistema não é feita de prompts. Documentar prompts imaginários
aqui criaria a impressão de que o pipeline depende de um modelo, o que mudaria
como qualquer pessoa (ou agente) mexeria nele depois.

---

## O que existe de verdade, e está aqui

| Arquivo | O que é |
|---|---|
| [`research-sourcing.md`](research-sourcing.md) | Pesquisa de **quais fontes** integrar, e o que a lei e os termos permitem. Usada de fato, e é a origem da ADR 0001. |
| [`research-technical.md`](research-technical.md) | Pesquisa de decisões técnicas (fila, free tiers). Origem da ADR 0009. |
| [`cv-tailoring.md`](cv-tailoring.md) | Prompt para ajustar CV a uma vaga. **Ainda não implementado** — está aqui como contrato, não como registro. |
| [`job-analysis.md`](job-analysis.md) | Prompt para leitura qualitativa de uma vaga. **Implementado** — `jho analyze <id>`. |

Os dois primeiros são histórico: reconstruídos fielmente do que foi executado.
O `cv-tailoring` é especificação do que virá. O `job-analysis` **é executado**
— e de propósito a partir deste arquivo, não de uma string no TypeScript.

---

## BYOK — a chave é sua

`jho analyze <id>` roda com a sua chave de API. O projeto não embute chave, não
faz proxy por servidor nenhum, e não guarda a chave em lugar algum além do
`.env` que já é seu.

```bash
# no .env (ignorado pelo Git)
ANTHROPIC_API_KEY=sk-ant-...      # ou OPENAI_API_KEY
JHO_LLM_PROVIDER=anthropic        # opcional; detecta pela chave presente
JHO_LLM_MODEL=claude-sonnet-5     # opcional
```

**O prompt vem deste diretório.** `job-analysis.md` é lido em tempo de execução
e o primeiro bloco cercado por crases vira o system prompt. Ajustar o
comportamento é editar markdown, não TypeScript — que é o ponto de manter o
prompt aqui e não numa constante.

### O que sai da sua máquina

Todo o resto do sistema roda offline contra um banco local. `analyze` é o único
comando que envia algo para fora, então ele **diz o que vai enviar e espera
confirmação** antes de enviar:

```
Isto vai sair da sua máquina
  destino: anthropic (claude-sonnet-5)
  chave:   sk-ant-…f4a2
  envia:   o anúncio da vaga, ~7.400 caracteres
  NÃO envia: seu currículo, seu perfil, nem o funil
```

Enter vazio é "não". A chave nunca aparece inteira, nem em erro — o próprio tipo
`LlmError` redige antes de a mensagem existir, para que nenhum ponto de chamada
possa esquecer.

### Trocar de provedor não toca em código

`LlmPort` é uma porta, como `QueuePort` e `SourceAdapter` (regra 4 do
`CLAUDE.md`). Anthropic e OpenAI são adapters de ~40 linhas cada. Um provedor
novo é mais um arquivo, e nada acima dele muda.

---

## A regra que vale para qualquer prompt deste projeto

Se um LLM entrar no pipeline, ele entra **para redigir e explicar, nunca para
ranquear**. Ranking precisa ser reproduzível; texto não precisa.

E vale a regra 6 do `CLAUDE.md` sem exceção: **nada fora de `evidence:` no
`profile.yaml` pode ser afirmado**. Um prompt de tailoring que "melhora" o
currículo inventando experiência produz uma mentira que a pessoa vai ter que
sustentar numa entrevista.
