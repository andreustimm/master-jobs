## Técnico

### Segurança

- `redactKey` (`src/core/llm/port.ts`) não devolve mais nenhum caractere da parte secreta da chave de API (#441, regra 16): o banner de `jho analyze` e `jho analysis run` mostra só o prefixo público do formato (`sk-ant-`, `sk-`, `nvapi-`) e o comprimento — `nvapi-… (70 caracteres)` —, ou `***` para formato desconhecido e chave curta, sempre ao lado do nome da variável. A máscara anterior mostrava 7 caracteres do começo e 4 do fim (5 reais numa chave `nvapi-`). Mede a chave aparada, a mesma do cabeçalho. `redactText` e `redactSecret` seguem cobrindo chave ecoada em erro.

## pt-BR

### Segurança

- O aviso antes de enviar uma vaga ao provedor de IA mostra só de qual variável vem a chave, o tipo e o tamanho dela, sem nenhum trecho da chave.

## en

### Security

- The notice shown before sending a job to the AI provider now shows only which variable the key comes from, its type and length, with no part of the key itself.
