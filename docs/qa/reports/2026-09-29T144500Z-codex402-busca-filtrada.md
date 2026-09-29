# QA targeted — vazio da busca contextualizado

- Issue: #402; branch fix/busca-vazia-com-filtros.
- Persona: Andreus em triagem; pt-BR/en; 375px.
- Charter: CH-relevance-and-availability-catch-up.
- Cenário: JOBS-term-filter-descriptions.
- Estado: Pending, E2E searches86/86 passou e jornada manual em andamento.

## Validação

Dois testes falharam antes porque a mensagem afirmava ausência em todo o acervo. Depois, 16 testes relacionados passaram; typecheck passou; E2E searches86/86 passou, incluindo termo existente, filtro incompatível, recarga, recuperação ao retirar filtro, PT/EN e375px. O servidor registrou avisos de stream fechado durante navegação; o gate de console do navegador passou. A consulta e as contagens não mudam: a mensagem descreve o recorte real, inclusive filtros padrão.

## Jornada planejada

Buscar termo existente, restringir por modalidade incompatível, ler o vazio localizado após refresh e recuperar a vaga ao retirar o filtro. Conferir 375px.

## Limitações

Sem telefone físico e leitor de tela; suíte completa pelo CI.
