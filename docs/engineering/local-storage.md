# Armazenamento de objetos local (MinIO) e AWS S3

A foto e a capa do perfil público (#327) passam pela porta `ObjectStorage`
(`src/core/storage/`), no formato do S3. Qual provedor atende é decidido por
`JHO_STORAGE_DRIVER`, sem mudar código ([ADR 0029](../adr/0029-armazenamento-de-objetos-formato-s3.md)):

| Onde | Driver | Provedor |
|---|---|---|
| Máquina local | `s3` | MinIO do `docker-compose.local.yml` |
| Preview e produção (Vercel) | `vercel-blob` | Vercel Blob, sempre privado |
| Futuro | `s3` | AWS S3 (ou outro compatível), só por configuração |

Sem `JHO_STORAGE_DRIVER`, o ambiente não tem armazenamento: `/candidate`
responde "o envio de imagens não está configurado neste ambiente" e o perfil
público sai sem foto. Valor desconhecido falha fechado.

## Subir o MinIO local

O Compose sobe o MinIO com portas **só em `127.0.0.1`** (regra 12) e um
serviço de bootstrap (`minio-init`) que cria o bucket e sai. O bootstrap é
idempotente: rodar de novo não apaga nada.

```bash
docker compose -f docker-compose.local.yml up -d minio minio-init
docker logs master-jobs-local-minio-init   # "Bucket created successfully `local/master-jobs`."
```

A API fica em `http://127.0.0.1:9000` e o console em `http://127.0.0.1:9001`.
As credenciais padrão são só de desenvolvimento (`master_jobs_local` /
`master_jobs_local_only`) e podem ser trocadas por `LOCAL_MINIO_USER`,
`LOCAL_MINIO_PASSWORD`, `LOCAL_MINIO_PORT`, `LOCAL_MINIO_CONSOLE_PORT` e
`LOCAL_MINIO_BUCKET` num `.env` não versionado.

Aponte o app para ele no `.env` local:

```bash
JHO_STORAGE_DRIVER=s3
S3_ENDPOINT=http://127.0.0.1:9000
S3_REGION=us-east-1
S3_BUCKET=master-jobs
S3_ACCESS_KEY_ID=master_jobs_local
S3_SECRET_ACCESS_KEY=master_jobs_local_only
```

Com `S3_ENDPOINT` presente, o path style (`endpoint/bucket/key`) liga
sozinho; `S3_FORCE_PATH_STYLE=true|false` sobrepõe. A imagem é o fork
comunitário `pgsty/minio`, porque a `minio/minio` saiu do Docker Hub; ela é
fixada por tag e digest no compose e em `tests/support/minio.ts`, e um teste
confere que as duas referências são iguais (alternativas na ADR 0029).

## Suíte de contrato

`tests/storage-contract.test.ts` roda a mesma suíte contra os dois adapters.
O bloco "S3 contra MinIO" usa `JHO_TEST_S3_ENDPOINT`,
`JHO_TEST_S3_ACCESS_KEY_ID` e `JHO_TEST_S3_SECRET_ACCESS_KEY` quando dadas (o
MinIO do Compose, por exemplo); sem elas, sobe um contêiner descartável com
credencial aleatória em `127.0.0.1`, como o PostgreSQL de teste. Sem Docker ou
sem a imagem, o bloco aparece como **PULADO** com o motivo no nome e um aviso
no console — nunca passa em silêncio.

## Apontar para AWS S3

Nada muda no código. Crie o bucket privado (Block Public Access ligado; a
imagem nunca é lida por URL do bucket, só pela rota do app) e uma credencial
IAM limitada a ele:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::<bucket>/*"
    },
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::<bucket>"
    }
  ]
}
```

`s3:ListBucket` no **bucket** (sem `/*`) não é para listar nada: sem ela, a
AWS responde **403 AccessDenied**, e não 404 `NoSuchKey`, a `GetObject` e
`HeadObject` de chave inexistente — para não revelar o que existe a quem não
pode listar. O adapter trata 403 como erro, não como "sem imagem", e a rota
pública viraria 500 onde deveria ser 404. Depois, no ambiente:

```bash
JHO_STORAGE_DRIVER=s3
S3_REGION=<região do bucket>
S3_BUCKET=<bucket>
S3_ACCESS_KEY_ID=<id da credencial>
S3_SECRET_ACCESS_KEY=<segredo da credencial>
# sem S3_ENDPOINT: o SDK usa o endpoint da AWS e o bucket no host
```

Os objetos já gravados no Vercel Blob não migram sozinhos: as chaves do banco
valem nos dois provedores (`<bucket>/<key>` no Blob, `key` no bucket S3), mas
o conteúdo precisa ser copiado antes da troca. Credencial só em variável de
ambiente, nunca em banco nem em log (regra 16).
