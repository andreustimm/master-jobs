## Técnico

### Adicionado

- Filtros de `/` e `/jobs` que se aplicam ao terminar o gesto (#218). Busca e
  empresa: 400 ms sem digitar, com três caracteres ou mais (ou vazio). Faixas de
  Score e salarial: `onValueCommitted` do slider e saída do foco da faixa
  inteira. Moeda e período: ao escolher. A ilha `app/auto-submit.tsx` só chama
  `requestSubmit()` no formulário GET em volta; as regras (`textReady`,
  `sameDestination`, `createAutoSubmitter`) são puras em `app/auto-apply.ts`.
  Um pedido por controle, o último vence; o envio espera a navegação anterior
  confirmar a URL e é descartado se levaria à URL atual. Enter e Aplicar
  continuam imediatos e cancelam o pedido pendente. A lista de fontes mantém o
  Aplicar explícito.
- E2E `tests/e2e/filter-auto-apply.mjs`, que conta as navegações RSC de `/jobs`
  e retém a resposta para provar que a última digitação vence.

### Alterado

- Busca, empresa e os campos das faixas deixaram de ser remontados por `key`
  a cada resposta: `useAppliedValue` segue a URL sem apagar o texto ainda não
  enviado do campo em foco. `PayRange` continua com a chave de período e moeda.

## pt-BR

### Melhorado

- Os filtros de Vagas e do Cockpit se aplicam sozinhos: a busca, quando você
  para de digitar (a partir de três letras); o Score e a faixa salarial, quando
  você solta o controle ou sai dos campos; moeda e período, ao escolher.
  Durante o arrasto a lista fica como está. Enter e o botão
  Aplicar continuam funcionando na hora, e as fontes seguem com o Aplicar
  próprio.

## en

### Improved

- Filters on Jobs and the Cockpit now apply on their own: search once you stop
  typing (from three letters on); Score and the pay range when you release the
  control or leave its fields; currency and period when you pick them. The list
  stays put while you drag. Enter and the Apply button still
  work immediately, and sources keep their own Apply.
