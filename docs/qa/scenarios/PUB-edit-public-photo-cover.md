---
id: PUB-edit-public-photo-cover
area: PUB
title: Enviar, trocar e remover a foto e a capa do perfil público, com "mostrar" desmarcado por padrão
persona: Andreus no celular
journey: J-choose-public-address
expected: Em /candidate, o cartão "Foto e capa do perfil público" aceita JPEG, PNG ou WebP até 4 MB; a prévia mostra a imagem recortada (foto quadrada, capa 4:1) e sobrevive ao refresh; "Mostrar no perfil público" nasce desmarcado; SVG, arquivo acima de 4 MB ou imagem pequena demais são recusados com a razão, sem apagar a imagem que já estava salva; trocar mostra a nova na hora; remover some com a prévia e desmarca o "mostrar"; sem armazenamento configurado a tela diz que o envio não está configurado
entry_points: /candidate
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/evidence/2026-09-28T205309000000Z-62fe85e4-perfil-publico-foto-capa-targeted/CH-photo-cover-edit-mobile-upload-preview.png; docs/qa/evidence/2026-09-28T205309000000Z-62fe85e4-perfil-publico-foto-capa-targeted/CH-photo-cover-edit-mobile-svg-rejected.png; docs/qa/evidence/2026-09-28T205309000000Z-62fe85e4-perfil-publico-foto-capa-targeted/CH-photo-cover-edit-mobile-wrong-type-rejected.png; docs/qa/evidence/2026-09-28T205309000000Z-62fe85e4-perfil-publico-foto-capa-targeted/CH-photo-cover-edit-mobile-cover-too-small.png; docs/qa/evidence/2026-09-28T205309000000Z-62fe85e4-perfil-publico-foto-capa-targeted/exif-strip-check.txt; docs/qa/evidence/2026-09-28T205309000000Z-62fe85e4-perfil-publico-foto-capa-targeted/CH-not-configured-candidate-card.png
last_report: docs/qa/reports/2026-09-28T205309000000Z-62fe85e4-perfil-publico-foto-capa-targeted.md
overlaps: PUB-public-photo-cover-opt-in; PUB-public-image-revoked-404; PUB-edit-public-facts
---

Criado com a parte B de #327. Percorra em 375px e no desktop, em pt-BR e em
inglês, com o armazenamento local ligado (MinIO do `docker-compose.local.yml`,
`JHO_STORAGE_DRIVER=s3`; ver `docs/engineering/local-storage.md`). Envie uma
foto de celular com localização (EXIF de GPS): a prévia aparece em pé e,
baixando a imagem pela prévia, ela não tem mais metadados de localização.
Tente um SVG renomeado para `.png`, arquivos de ~4,2 MB e ~4,8 MB e uma capa de 600×600
px: cada um é recusado com a mensagem própria e a imagem anterior continua.
Troque a foto e confirme que a prévia muda sem recarregar à mão; remova e
confirme que a prévia some e "Mostrar" volta desmarcado depois do refresh.

**Nota da rodada de 2026-09-28:** a sessão começou contra o commit `ef8d359`
(teto de 5 MB no texto e um arquivo de 4,47 MB sendo recusado — parecia bug)
e terminou contra `21724ef`, depois que os commits `a8bca20`–`21724ef`
(revisão L2, ainda na mesma PR) baixaram o teto para 4 MiB de propósito (acima
de 4,5 MB a Vercel devolve 413 antes da action) e adicionaram checagem no
próprio seletor de arquivo. Todos os casos foram reconfirmados contra
`21724ef`: JPEG/PNG/WebP até 4 MB aceitos nos dois cartões; SVG renomeado,
tipo real errado (GIF), tamanho acima de 4 MB (~4,47 MB e ~5,8 MB) e capa
600×600 recusados com a razão certa, sem apagar a imagem anterior — inclusive
um arquivo de ~10,5 MB, que agora é barrado pelo próprio seletor antes de
qualquer requisição (antes de `a8bca20` isso gerava um erro genérico). EXIF de
GPS confirmado removido (baixado o arquivo servido e inspecionado byte a
byte: nenhum chunk EXIF/XMP/ICC). Também confirmado o aviso "Image upload is
not configured in this environment." ao tentar enviar sem
`JHO_STORAGE_DRIVER` — mas a exibição passiva de uma imagem que já existia
nesse mesmo cenário mostra ícone de imagem quebrada em vez de nada (ver
`BUG-20260928-public-profile-broken-image-icon-storage-unconfigured`, ligado
ao cenário `PUB-public-photo-cover-opt-in`).
