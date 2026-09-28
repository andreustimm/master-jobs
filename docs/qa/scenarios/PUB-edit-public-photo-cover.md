---
id: PUB-edit-public-photo-cover
area: PUB
title: Enviar, trocar e remover a foto e a capa do perfil público, com "mostrar" desmarcado por padrão
persona: Andreus no celular
journey: J-choose-public-address
expected: Em /candidate, o cartão "Foto e capa do perfil público" aceita JPEG, PNG ou WebP até 5 MB; a prévia mostra a imagem recortada (foto quadrada, capa 4:1) e sobrevive ao refresh; "Mostrar no perfil público" nasce desmarcado; SVG, arquivo acima de 5 MB ou imagem pequena demais são recusados com a razão, sem apagar a imagem que já estava salva; trocar mostra a nova na hora; remover some com a prévia e desmarca o "mostrar"; sem armazenamento configurado a tela diz que o envio não está configurado
entry_points: /candidate
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: PUB-public-photo-cover-opt-in; PUB-public-image-revoked-404; PUB-edit-public-facts
---

Criado com a parte B de #327. Percorra em 375px e no desktop, em pt-BR e em
inglês, com o armazenamento local ligado (MinIO do `docker-compose.local.yml`,
`JHO_STORAGE_DRIVER=s3`; ver `docs/engineering/local-storage.md`). Envie uma
foto de celular com localização (EXIF de GPS): a prévia aparece em pé e,
baixando a imagem pela prévia, ela não tem mais metadados de localização.
Tente um SVG renomeado para `.png`, um arquivo de 6 MB e uma capa de 600×600
px: cada um é recusado com a mensagem própria e a imagem anterior continua.
Troque a foto e confirme que a prévia muda sem recarregar à mão; remova e
confirme que a prévia some e "Mostrar" volta desmarcado depois do refresh.
