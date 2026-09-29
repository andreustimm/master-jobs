# QA targeted — vazio da busca contextualizado

- Issue: #402; branch fix/busca-vazia-com-filtros.
- Persona: Andreus em triagem; pt-BR/en; 375px.
- Charter: CH-relevance-and-availability-catch-up.
- Cenário: JOBS-term-filter-descriptions.
- Estado: Pass no escopo da #402, sobre o commit 7f69ab7.

## Validação

Dois testes falharam antes porque a mensagem afirmava ausência em todo o acervo. Depois, 16 testes relacionados passaram; typecheck passou; E2E searches 86/86 passou, incluindo Laravel existente, filtro incompatível, recarga, recuperação ao retirar filtro, PT/EN e 375px. O servidor registrou avisos de stream fechado durante navegação; o gate de console do navegador passou. A consulta e as contagens não mudam: a mensagem descreve o recorte real, inclusive filtros padrão.

## Jornada executada

Em conta Alex da fixture local isolada, a busca por TypeScript encontrou duas vagas. Selecionar modalidade presencial zerou a lista; após refresh, o vazio explicou os filtros atuais em inglês e português. Retirar a modalidade recuperou as duas vagas, inclusive após refresh. Voltar e avançar preservou os estados. Abrir a vaga Senior Software Architect confirmou TypeScript na descrição e modalidade remota, por leitura independente. As buscas por architect (cargo) e Aurora (empresa) recuperaram essa vaga; type não encontrou pedaço da palavra. Em viewport 375px, a largura do documento foi 360px, sem transbordamento horizontal.

Evidência visual: `docs/qa/evidence/2026-09-29T144500Z-codex402-busca-filtrada/vazio-pt.png`, capturada após leitura do conteúdo carregado. As primeiras capturas após refresh mostraram o skeleton; foram descartadas como prova do resultado.

## Limitações

Sem telefone físico e leitor de tela; suíte completa pelo CI. O cenário JOBS-term-filter-descriptions contém casos adicionais de sintaxe que não foram integralmente reexecutados manualmente nesta correção; seu estado global permanece untested.
