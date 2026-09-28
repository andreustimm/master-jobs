## Técnico

### Adicionado

- Porta `ObjectStorage` em `src/core/storage/` na semântica do S3 (bucket + key, `putObject`/`getObject`/`headObject`/`deleteObject`, `ContentType`, `ContentLength`, metadados, ETag), escolhida por `JHO_STORAGE_DRIVER=vercel-blob|s3` em `openStorage()`; ausente é "sem armazenamento", valor desconhecido falha fechado (ADR 0029, #327 parte B).
- Adapter Vercel Blob (`@vercel/blob` 2.x) sempre privado, bucket/key → pathname `<bucket>/<key>`, metadados num objeto irmão `.metadata/…`, leitura sem cache de CDN; adapter S3 (`@aws-sdk/client-s3`) com `S3_ENDPOINT` e `S3_FORCE_PATH_STYLE`. Os dois apagam o valor da credencial de todo erro e entram no inventário de transporte de saída.
- Suíte de contrato única (`tests/support/storage-contract.ts`) para os dois adapters: SDK do Blob dublado (recusa chamada não privada), `send` do S3 dublado e S3 contra MinIO real quando há Docker, com PULADO e motivo no nome quando não há.
- MinIO no `docker-compose.local.yml` (`pgsty/minio`, fork comunitário fixado por tag), portas só em `127.0.0.1` e bucket criado por um serviço de bootstrap idempotente.
- Migração `0029_perfil_publico_foto_capa` (aditiva, veredito `[]`): `photo_key`, `cover_key` (nulas) e `public_photo`, `public_cover` (`boolean default false`, anuláveis; nulo é desligado). `postSnapshotColumns` declara nulo/`false`.
- `savePublicImageAction` (`guardOwnCandidate` antes de ler o formulário): tipo pela assinatura (JPEG, PNG, WebP), 5 MB, lado máximo de 8000 px e mínimo por tipo; reencode em WebP com `sharp` (orientação aplicada, EXIF/XMP/IPTC/ICC fora), foto 512×512 e capa 1600×400; chave nova por envio e objeto antigo apagado na troca e na remoção, com a linha travada. `sharp` vira dependência direta na versão que o Next já resolvia.
- `/p/[slug]/image/[kind]` sem sessão (exceção registrada no inventário de G39): reconfere `public_slug`, visibilidade e opt-in a cada requisição, mesmo 404 vazio para qualquer recusa, `no-store`, `Cross-Origin-Resource-Policy: same-origin`, balde próprio no limite por IP do proxy. `/candidate/image/[kind]` é a prévia do dono, com sessão. `PublicProfile.images` traz só versão opaca (hash da chave). CSP inalterada (`img-src 'self' data:`); o service worker não guarda nenhuma das rotas.

## pt-BR

### Adicionado

- Na Área do candidato há um cartão novo, "Foto e capa do perfil público", para enviar uma foto e uma imagem de capa (JPEG, PNG ou WebP, até 5 MB). A imagem é recortada e regravada no envio, sem metadados como a localização da câmera. Cada uma só aparece no perfil público quando você marca "Mostrar no perfil público" — começam desmarcadas —, e dá para trocar ou remover quando quiser.
- O perfil público mostra a capa acima do nome e a foto ao lado dele. Se o perfil deixar de ser público ou a imagem deixar de ser mostrada, o link da imagem para de funcionar na hora, mesmo para quem o guardou.

## en

### Added

- The candidate area has a new "Public profile photo and cover" card to upload a photo and a cover image (JPEG, PNG or WebP, up to 5 MB). The image is cropped and re-encoded on upload, without metadata such as the camera location. Each one only appears on the public profile when you tick "Show on public profile" — both start unticked — and you can replace or remove them at any time.
- The public profile shows the cover above the name and the photo beside it. If the profile stops being public or the image stops being shown, the image link stops working right away, even for someone who saved it.
