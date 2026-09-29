# QA targeted — importação de PDF no perfil existente

- Issue: #388; branch: fix/importacao-cv-pdf-recusa; base: 36c120c.
- Persona: candidato revisando o currículo, pt-BR/en, 375px.
- Ambiente: runner isolado, banco descartável, autenticação real.
- Charter: CH-save-cv-ranking-refresh; cenário: PROF-create-own-profile-pdf.
- Estado: Pending — E2E e jornada em andamento.

## Validação

Antes da correção, os testes com arquivo renomeado e ausente falharam porque
`importPdfAction` lançava `pdfNotPdf` e `pdfMissing`. Após a correção:
37 testes em quatro arquivos passaram; typecheck passou; E2E onboarding 44/44 passou, incluindo recusa PT/EN, CV preservado após refresh e ausência de HTTP 500.

## Jornada

Planejada: recusar arquivo renomeado, ler a razão localizada, recarregar e
conferir que a versão anterior permanece; importar PDF com texto e reler o CV.
Confirmar que a tela não anuncia upload inexistente. Estado pendente.

## Limitações

Sem telefone físico ou leitor de tela. Suíte completa a cargo do CI (G57).
