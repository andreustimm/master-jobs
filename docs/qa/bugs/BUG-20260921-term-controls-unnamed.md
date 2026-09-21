# BUG-20260921-term-controls-unnamed: em Buscas, os controles de cada termo não dizem de qual termo são

- **Status:** open <!-- open | fixed | verified | wont-fix | invalid -->
- **Impact (user-side):** Friction
- **Severity:** Medium · **Priority:** P2
- **Persona Affected:** Andreus em triagem
- **Journey Step:** J-save-term-search, passo 4 (pausar, mover, rodar de novo ou excluir o termo)
- **Scenarios:** SRCH-term-lifecycle
- **Found:** 2026-09-21 · **Report:** docs/qa/reports/2026-09-21T175034729239Z-e901131e-qa-buscas.md

## Summary

Cada termo salvo tem os mesmos controles — BUSCAR DE NOVO, PAUSAR, "mover
para", MOVER e APAGAR, mais o link "N novas · ver vagas" —, e nenhum deles leva
o nome do termo no nome acessível. Com vinte termos, a lista de botões de um
leitor de tela traz vinte "apagar" iguais: quem navega por ela não sabe qual
termo vai apagar. Quem vê a tela não percebe nada, porque o termo está escrito
logo acima dos botões.

## Reproduction

- **Charter:** CH-saved-term-reaches-new-jobs, releitura pela lente de acessibilidade · **Tour:** Feature Tour
- **Environment:** laptop 1280×800 / wifi-fast / pt-BR, ambiente de paridade `run-isolated.mjs --manual`, conta `alex@local.test`

1. Entrar como o dono com vários termos salvos e abrir Buscas.
2. Listar os botões e links pela árvore de acessibilidade (a lista de botões de um leitor de tela).

**Expected:** cada controle diz a que termo pertence.
**Actual:** 20 × "APAGAR", 20 × "PAUSAR", 20 × "MOVER", 20 × "BUSCAR DE NOVO", 20 × "mover para" e 20 × "0 novas · ver vagas", sem `aria-label` nem `aria-describedby`.

## Evidence

- Contagem pela árvore de acessibilidade do driver (`agent-browser snapshot -i`) em `/searches` com 20 termos ativos.
- Os botões não estão dentro de `fieldset` nem de grupo rotulado; o único contexto é a posição no cartão.

## Fix

<!-- filled when status moves to fixed -->
- **Root cause:** os controles do cartão de termo em `app/searches/page.tsx` usam só o rótulo da ação; o termo é um `span` vizinho, sem relação programática com eles. O sintoma é a lista de controles idênticos; a causa é a falta de vínculo entre o controle e o termo.
- **Fix commit:**
- **Regression test:**

## Verification

<!-- filled when status moves to verified -->
- **Retested:**
- **Result:**
