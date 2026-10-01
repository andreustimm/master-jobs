# QA targeted — retest de PROF-create-own-profile-pdf (achado 1 da revisão da PR #414)

- Issue: #388; PR: #414; branch: fix/importacao-cv-pdf-recusa.
- Persona: candidato convidado sem perfil, en, 375px.
- Ambiente: runner isolado (`node tests/e2e/run-isolated.mjs --areas onboarding`), banco descartável, autenticação real.
- Charter: CH-account-isolation-first-entry; cenário: PROF-create-own-profile-pdf.
- Estado: Pass.

## Por que este relatório existe

O relatório original da PR #414
(`docs/qa/reports/2026-09-29T143500Z-codex388-importacao-pdf.md`) já dizia,
na seção Probes: "A criação inicial de perfil [...] não receberam veredito
manual novo nesta sessão." A revisão L1 (achado 1) apontou que, mesmo assim,
os dois bugs ficaram `verified` apontando `Scenarios:
PROF-create-own-profile-pdf`, e esse cenário continuava `untested` — sem o
vínculo que o próprio template exige. Este relatório fecha essa lacuna com
evidência de navegador, em vez de assumir o veredito.

## Validação

`node tests/e2e/run-isolated.mjs --areas onboarding`, 44/44 verificações. O
bloco "Criar o perfil enviando o currículo em PDF (#278), em 375px"
(`tests/e2e/ui/onboarding.mjs:138-229`) é o canário automatizado do próprio
cenário:

- `onboarding recusa arquivo que não é PDF, com a razão` — arquivo de texto
  puro renomeado para `.pdf`, recusado com `onboarding.pdfNotPdf`.
- `recusa do PDF não cria perfil` — a tela de onboarding continua visível,
  nenhum candidato foi criado.
- `perfil criado com PDF sobrevive ao refresh`, `texto extraído do PDF vira o
  currículo, no editor`, `versão do currículo leva o nome do arquivo`,
  `perfil criado com PDF cabe em 375px` — o caminho feliz: PDF de verdade
  (gerado por `tests/support/synthetic-pdf.ts`) cria o perfil, extrai o texto
  para o editor com a versão nomeada pelo arquivo, sobrevive ao refresh e cabe
  em 375px.
- Reteste da #388 (perfil já existente), nos dois idiomas:
  `importação de PDF existente explica a recusa em en/pt-BR`, `recusa mantém
  CV e versão após refresh em en/pt-BR`, `perfil não anuncia upload
  inexistente em en/pt-BR`, `PDF inválido recebe recusa sem HTTP 500`.

Saída completa do runner anexada ao log desta sessão (33 checks da área
`onboarding`, mais os 9 de `auth` e o guard `E2E-025`, somando 44/44).

## Limitações

Sem percurso manual com conta real de produção para este cenário — a
evidência é só o E2E hermético acima, igual ao padrão já aceito em
`AUTH-referrals-own-network-only`. Suíte completa a cargo do CI (G57).
