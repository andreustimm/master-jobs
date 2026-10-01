# BUG-20261001-verify-run-shows-capture-completeness-copy: o detalhe de uma execução de verificação diz "janela parcial: não fecha por ausência"

- **Status:** open
- **Impact (user-side):** Friction
- **Severity:** Medium · **Priority:** P2
- **Persona Affected:** Andreus em triagem (admin)
- **Journey Step:** J-operate-source-catalog, passo 3 (ler o detalhe da execução depois de pedir)
- **Scenarios:** ADMN-source-runs-partial-retry
- **Found:** 2026-10-01, durante a verificação de JOBS-availability-last-check · **Report:** docs/qa/reports/2026-10-01-qa-223-verificacoes.md

## Summary

Numa execução de "Atualizar status" (verificação de links) cortada pelo limite
do operador, o detalhe mostra "Completude: janela parcial: não fecha por
ausência". Essa frase descreve a captura de uma fonte. A verificação não fecha
vaga por ausência (só 404 e 410 fecham), então quem lê fica sem saber o que
"janela parcial" quer dizer aqui nem se algo deu errado.

## Reproduction

- **Charter:** CH-relevance-and-availability-catch-up · **Tour:** Feature Tour
- **Environment:** laptop, wifi-fast, pt-BR; `pnpm dev` local, PostgreSQL
  descartável, uma fonte real de baixo volume (`lever:epoch-ai`, 9 vagas)

1. Como admin, abrir `/admin/plataformas/lever%3Aepoch-ai` e clicar em
   "Atualizar status" (cria a execução de verificação na fila).
2. No terminal do operador: `jho jobs verify --run <id> --limit 3` (3 vagas
   verificadas, 3 vivas).
3. Recarregar `/admin/execucoes/<id>` e ler "Completude".

**Expected:** texto próprio da verificação, por exemplo "conferência cortada
pelo limite", sem falar de fechamento por ausência.
**Actual:** "janela parcial: não fecha por ausência" (o texto da captura).

## Evidence

- `docs/qa/evidence/2026-10-01-qa-223-verificacoes/CH-admin-source-catalog-first-walk-verificacao-completude.png`
- Leitura independente: o mesmo detalhe depois de recarregar mostra o mesmo
  texto; as contagens (3 lidas, 3 vivas, 0 fechadas) estão corretas.
- Só a variante "parcial" foi vista no navegador; a "completa" (lista
  completa: fecha por ausência) sai pelo mesmo mapeamento e não foi percorrida.
- Issue: #439.

## Fix

<!-- Hipótese de causa, não confirmada por correção:
`app/admin/execucoes/[id]/page.tsx` traduz `run.completeness` sempre por
`platforms.snapshotComplete`/`platforms.snapshotPartial`, qualquer que seja o
escopo da execução. -->

## Verification

<!-- pendente -->
