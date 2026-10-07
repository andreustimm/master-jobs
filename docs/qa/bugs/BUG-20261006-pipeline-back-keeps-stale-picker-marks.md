# BUG-20261006-pipeline-back-keeps-stale-picker-marks: no Funil, voltar ou limpar deixa empresa e canal marcados, e o próximo Aplicar os traz de volta

- **Status:** open
- **Impact (user-side):** Trust-Damage
- **Severity:** High · **Priority:** P1
- **Persona Affected:** Andreus em triagem noturna
- **Journey Step:** J-preserve-application-decision, ao voltar pelo navegador ou limpar o filtro de empresa/canal em `/pipeline`
- **Scenarios:** PIPE-filter-applications
- **Found:** 2026-10-06 · **Report:** docs/qa/reports/2026-10-06-qa-478-funil-filtros.md
- **Issue:** [#492](https://github.com/andreustimm/master-jobs/issues/492)

## Summary

Depois de aplicar uma empresa (ou um canal) no Funil e voltar pelo navegador
— ou clicar em "limpar" ao lado do seletor —, a URL, o resumo do seletor
("todas as empresas") e a lista mostram o funil sem filtro, mas a caixa da
empresa continua marcada. Quem abre o seletor vê "todas as empresas" no topo e
"Vercel" marcada embaixo; ao marcar outra empresa e aplicar, a Vercel volta
para o filtro sem a pessoa ter pedido. Em Vagas, o mesmo seletor de fontes
desmarca corretamente nos dois caminhos — o defeito é só do Funil.

## Reproduction

- **Charter:** CH-filter-pipeline · **Tour:** Back-Button Tour
- **Environment:** `tests/e2e/run-isolated.mjs --manual` (build standalone de
  `origin/dev` 4f62a49a, PostgreSQL descartável), 1280 px, pt-BR, conta
  `alex@local.test`

1. Abrir `/pipeline`, abrir "Empresa", marcar "Vercel" e Aplicar
   (`?company=Vercel`).
2. Clicar em Voltar no navegador (URL volta a `/pipeline`, resumo "todas as
   empresas", 7 linhas).
3. Abrir "Empresa": "Vercel" continua marcada.
4. Marcar "Gopher Labs QA" e Aplicar.

**Expected:** a marca segue a URL; o passo 4 filtra só por Gopher Labs QA.
**Actual:** URL `?company=Gopher+Labs+QA&company=Vercel` — a empresa
desfeita volta. O mesmo com o link "limpar" do seletor (passo 2 trocado por
"limpar") e com o seletor de Canal (`agency` marcado após voltar).

## Evidence

- `docs/qa/evidence/2026-10-06-qa-478-funil-filtros/06-voltar-marca-velha.png`
  (resumo "todas as empresas" com "Vercel" marcada).
- Leituras de DOM da sessão no relatório (seção 6).
- Contraprova em `/jobs` (fontes): voltar e limpar deixam zero marcadas.

## Fix

<!-- filled when status moves to fixed -->

## Verification

<!-- filled when status moves to verified -->
