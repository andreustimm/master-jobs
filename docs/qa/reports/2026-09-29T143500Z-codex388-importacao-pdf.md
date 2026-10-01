# QA targeted — importação de PDF no perfil existente

- Issue: #388; branch: fix/importacao-cv-pdf-recusa; base: 36c120c.
- Persona: candidato revisando o currículo, pt-BR/en, 375px.
- Ambiente: runner isolado, banco descartável, autenticação real.
- Charter: CH-save-cv-ranking-refresh; cenário: PROF-import-existing-cv-pdf (canário automatizado: PROF-create-own-profile-pdf).
- Estado: Pass no escopo da importação em perfil existente, commit 053a5d8.

## Validação

Antes da correção, os testes com arquivo renomeado e ausente falharam porque
`importPdfAction` lançava `pdfNotPdf` e `pdfMissing`. Após a correção:
37 testes em quatro arquivos passaram; typecheck passou; E2E onboarding 44/44 passou, incluindo recusa PT/EN, CV preservado após refresh e ausência de HTTP 500.

## Jornada

Percorrida por agent-browser, conta Alex, em 375px. O arquivo renomeado recebeu ‘The file is not a readable PDF.’ e ‘O arquivo não é um PDF legível.’. Após refresh, o rótulo Currículo e o texto anterior permaneceram. Na tentativa seguinte, curriculo-atualizado.pdf importou 243 caracteres; o editor e a leitura independente em Versões mostraram o mesmo conteúdo após refresh. scrollWidth 360 para innerWidth 375. A mensagem obsoleta estava ausente.

Evidências no diretório docs/qa/evidence/2026-09-29T143500Z-codex388-importacao-pdf/: recusa-en.png, recusa-pt.png, pdf-salvo-refresh.png e versao-independente.png.

O primeiro upload do driver usou caminho relativo que não estava acessível ao processo do navegador, produzindo falha de transporte sem resposta HTTP. Repetido com caminho absoluto, o mesmo arquivo percorreu a ação e recebeu a recusa esperada. Esse incidente não foi contado como aprovação.

Probes: arquivo com extensão enganosa, alternância de idioma, refresh após recusa, recuperação com PDF válido e viewport estreito. A criação inicial de perfil e os demais tipos de PDF estão cobertos pelos testes relacionados; não receberam veredito manual novo nesta sessão.

## Limitações

Sem telefone físico ou leitor de tela. Suíte completa a cargo do CI (G57).
