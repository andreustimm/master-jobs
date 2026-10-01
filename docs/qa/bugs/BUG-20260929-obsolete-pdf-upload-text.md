# BUG-20260929-obsolete-pdf-upload-text: texto obsoleto diz que upload de PDF não existe, ao lado da importação que já funciona

- **Status:** verified
- **Impact (user-side):** Friction
- **Severity:** Low · **Priority:** P3
- **Persona Affected:** Andreus em triagem noturna; Candidato convidado sem perfil
- **Journey Step:** J-refresh-candidate-ranking e J-create-own-profile, na área de importação de CV
- **Scenarios:** PROF-create-own-profile-pdf; PROF-rescore-status-visibility
- **Found:** 2026-09-29 · **Report:** docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md

## Summary

Ao lado do controle de importação de CV em PDF — que funciona (extrai texto,
nomeia a versão pelo arquivo, sobrevive ao refresh, confirmado nesta mesma
rodada em `PROF-create-own-profile-pdf`) — a tela ainda mostra o texto
obsoleto "Upload de PDF ainda não existe" (pt-BR) / "PDF upload does not exist
yet" (en). A mensagem contradiz o que a própria tela permite fazer e pode
convencer a pessoa a não tentar a funcionalidade que já está pronta.
Observado independentemente em duas sessões desta rodada, uma em cada idioma,
o que descarta erro pontual de tradução.

## Reproduction

- **Charter:** CH-save-cv-ranking-refresh (pt-BR) e CH-account-isolation-first-entry (en) · **Tour:** Feature Tour
- **Environment:** `next dev` local (127.0.0.1:3210), 375×812 e 1280×900, pt-BR e en

1. Entrar como candidato e abrir a área de CV/currículo em `/candidate`.
2. Ler o texto ao lado do controle de importação de PDF.

**Expected:** nenhum texto dizendo que a importação de PDF não existe, já que
ela funciona.
**Actual:** "Upload de PDF ainda não existe" / "PDF upload does not exist yet"
visível ao lado do controle funcional.

## Evidence

- Observado nas duas sessões desta rodada (lane pipe, pt-BR; lane prof, en);
  sem captura de tela dedicada — leitura direta da tela em ambas as sessões.
  Contrastar com `docs/qa/evidence/2026-09-29T035351654581Z-97f37e1c-full/adhoc-prof/02-pdf-imported.png`,
  que mostra a importação funcionando na mesma área.

## Fix

<!-- filled when status moves to fixed -->
- **Root cause:** O texto `copy.pdfUploadTodo` ("Upload de PDF ainda não existe" / "PDF upload does not exist yet") ficou na tela desde antes da #278 implementar o upload de verdade; ninguém removeu o aviso quando a funcionalidade passou a existir.
- **Fix commit:** `053a5d8`
- **Regression test:** E2E `onboarding` (`tests/e2e/ui/onboarding.mjs`, "perfil não anuncia upload inexistente em en/pt-BR") — reprovava antes da remoção do texto, porque a tela ainda continha a frase obsoleta ao lado do controle funcional.

## Verification

<!-- filled when status moves to verified -->
- **Retested:** Manual Pass em `053a5d8`, relatório `docs/qa/reports/2026-09-29T143500Z-codex388-importacao-pdf.md` (importação em perfil existente, pt-BR/en); E2E `onboarding` 44/44, incluindo a criação inicial de perfil via PDF, cobertura confirmada no retest de `PROF-create-own-profile-pdf` (`docs/qa/reports/2026-10-01-pr414-prof-create-own-profile-pdf-retest.md`, achado 1 da revisão L1 da PR #414).
- **Result:** Pass. O aviso obsoleto não aparece mais em nenhum idioma, ao lado do controle de importação que funciona.
