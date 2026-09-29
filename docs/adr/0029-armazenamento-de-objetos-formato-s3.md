# ADR 0029 — Armazenamento de objetos no formato S3: Vercel Blob em deployment, S3/MinIO local

**Status:** aceita · 2026-09-28 · issue #327 (decisões do dono de 2026-09-25)

## Contexto

A foto e a capa do perfil público (#327) são o primeiro arquivo que o produto
precisa guardar. Até aqui não havia armazenamento nenhum: o PDF importado é
lido em memória e descartado. O dono decidiu, em 25/09:

- **Vercel Blob** para os uploads em produção;
- **tudo no formato do S3**: o código do app só conhece bucket + key,
  `PutObject`/`GetObject`/`HeadObject`/`DeleteObject`, `ContentType`,
  `ContentLength`, metadados e ETag, e nada fora do adapter importa SDK ou
  depende de URL pública do provedor;
- **estrutura para S3**: adapter `@aws-sdk/client-s3` com endpoint
  configurável, usado localmente com **MinIO** e pronto para AWS S3 só por
  configuração.

A #327 também apontou o risco: blob público é legível por quem tiver a URL,
mesmo depois de o perfil deixar de ser público.

## Decisão

1. **Porta `ObjectStorage`** em `src/core/storage/ports.ts`, na semântica do
   S3. Chave inexistente é `null` em `getObject`/`headObject`, `deleteObject` é
   idempotente e `putObject` na mesma chave substitui conteúdo, tipo e
   metadados. As regras de nome do S3 (bucket, chave, metadado) são conferidas
   pela porta, então os dois adapters recusam o mesmo endereço. A variação é
   real (G04): dois provedores hoje, um terceiro previsto.
2. **Seleção por `JHO_STORAGE_DRIVER=vercel-blob|s3`**, composição por função
   (`openStorage()`), sem container. Ausente é "sem armazenamento" (o upload
   responde que o ambiente não tem, e o perfil segue sem imagem); valor
   desconhecido **falha fechado**, nunca cai no outro driver. Só o SDK do
   driver escolhido é carregado.
3. **Adapter Vercel Blob sempre privado** (`access: "private"`, disponível no
   `@vercel/blob` 2.x). bucket + key vira o pathname `<bucket>/<key>`; o Blob
   não guarda metadado de usuário, então o adapter o grava num objeto irmão
   `.metadata/<bucket>/<key>.json` (bucket de S3 nunca começa com ponto, então
   não colide). Leitura com `useCache: false`, como a consistência do S3.
4. **Adapter S3** com `S3_ENDPOINT` e `S3_FORCE_PATH_STYLE` (ligado por padrão
   quando há endpoint): MinIO no `docker-compose.local.yml`, AWS S3 sem
   endpoint. `NoSuchBucket` é erro, não "sem imagem".
5. **A imagem sai pelo app, nunca por URL do provedor.** A rota
   `/p/<endereço>/image/<tipo>` reconfere `public_slug`, `visibility = public`
   e o opt-in a cada requisição, responde o mesmo 404 para qualquer recusa
   (G22) e manda `no-store`. A CSP continua `img-src 'self' data:`: nenhuma
   origem de provedor é aberta.
6. **O banco guarda só a chave** (`candidate.photo_key`/`cover_key`), nova a
   cada envio; a antiga é apagada na troca e na remoção. Credencial
   (`BLOB_READ_WRITE_TOKEN`, `S3_*`) só em variável de ambiente; o adapter
   apaga o valor de todo erro que sai dele (G41).
7. **Mesma suíte de contrato** (`tests/support/storage-contract.ts`) para os
   dois adapters: Blob com o SDK dublado (o dublê recusa chamada não privada),
   S3 com o `send` dublado, e S3 contra MinIO de verdade quando há Docker —
   sem ele, o bloco aparece como PULADO com o motivo.

## Consequências

- Trocar de Vercel Blob para S3 (AWS ou compatível) é configurar
  `JHO_STORAGE_DRIVER=s3` e as `S3_*`; a chave gravada no banco vale nos dois,
  mas os objetos precisam ser copiados de um provedor para o outro — não há
  migração automática de conteúdo.
- O metadado no Blob custa uma leitura a mais (em paralelo) por `get`/`head`
  — exceto no caminho de serviço, que pede `getObject(…, { metadata: false })`
  e lê só o corpo. A escrita do objeto e do irmão não é atômica: irmão
  truncado ou corrompido vale como "sem metadado", e se só o irmão falhar na
  leitura o stream do objeto é cancelado. Aceito: os objetos do produto são
  poucos e imutáveis por chave.
- Cada visita ao perfil lê a imagem do provedor (`no-store`, sem CDN). O
  reencode deixa a foto em ~dezenas de KB; se o custo aparecer, a próxima
  decisão é cache com revalidação que ainda reconfira a visibilidade — nunca
  URL pública.
- Objeto antigo que falhar ao ser apagado fica órfão, mas inalcançável:
  privado no provedor e fora do que o banco aponta. A linha no log permite
  apagá-lo à mão.
- A rota da imagem tem balde próprio no limite por IP do proxy (60 em 5
  min), e a sonda por ela não gasta o balde da página: uma varredura de
  endereços ganha até 60 tentativas a mais por IP. O proxy decide antes de a
  rota saber a resposta, e os dois não compartilham memória confiável na
  Vercel; custo declarado em `proxy.ts` e `docs/security.md`.
- O teto do upload é 4 MiB, abaixo do limite de corpo de 4,5 MB da Vercel
  (413 antes de a action rodar); o seletor avisa no navegador acima dele.

## Imagem do MinIO local

A imagem oficial `minio/minio` saiu do Docker Hub, e a de `quay.io/minio`
passou a pedir login (verificado em 28/09/2026). Alternativas avaliadas:

| Opção | Por que não (ou quando) |
|---|---|
| `quay.io/minio/minio` fixada por digest | exige credencial para baixar; o CI e o E2E sobem o contêiner sem segredo nenhum |
| SeaweedFS (`chrislusf/seaweedfs`) | S3 compatível e mantido, mas é outro servidor — o dono decidiu por MinIO |
| Garage (`dxflrs/garage`) | leve e mantido, mas exige layout de cluster no bootstrap e não é MinIO |
| `bitnamilegacy/minio` | congelada: sem atualização de segurança |
| **`pgsty/minio`** (escolhida) | fork comunitário mantido do mesmo código, com `minio` e `mc` na imagem; baixa sem login |

A imagem é fixada por **tag e digest** (`pgsty/minio:RELEASE…@sha256:…`) no
compose e em `tests/support/minio.ts`, e um teste confere que as duas
referências são iguais: a tag de um fork pode ser republicada, o digest não.
Trocar de imagem (outra tag, ou SeaweedFS/Garage se o fork parar) é trocar a
referência nos dois lugares e rodar a suíte de contrato contra ela — a porta
não muda.
