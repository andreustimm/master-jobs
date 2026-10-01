# Filtros sem overlay — #394

Tamanho M. A atualização de query na mesma tela continua suave mesmo após o
limiar de espera prolongada. O reducer conserva `soft`; a live region anuncia
a espera prolongada. Navegação entre telas e recuperação offline conservam
seu comportamento. Nenhuma alteração de dado, autenticação ou schema.

Implementação: reducer em `src/core/pwa/transition.ts`, anúncio em
`app/navigation-transition.tsx`, regressões de store e navegador isolado.

Entrega: PR draft para dev; revisão e merge pela coordenadora.
