# ADR 0022: Compilar as novidades no build

## Status

Aceita. Substitui a leitura e o parsing no rodapé da [ADR 0015](0015-modal-nativo-com-ilha-cliente.md)
e o renderer cliente/tracing dos Markdown da [ADR 0016](0016-changelogs-localizados-e-react-markdown.md).

## Data

2026-09-22

## Contexto

Os históricos só mudam junto dos commits de uma versão. Ler os mesmos arquivos,
interpretar as entradas e converter Markdown em cada requisição repetia trabalho
fixo. O modal também renderizava todos os corpos enquanto estava fechado.

## Decisão

`scripts/build-changelog.ts` gera `src/generated/changelog.ts` antes do build.
O módulo contém metadados de publicação e HTML das duas edições, sem os corpos
Markdown. Não é versionado nem publicado em `public/`; o rodapé o importa no
servidor e envia somente o idioma ativo, depois de confirmar a sessão.

O renderer continua usando `react-markdown`, agora somente na geração, com a
mesma lista de elementos, bloqueio de HTML de origem, imagens e URLs inseguras.
O único HTML inserido pelo modal é esse resultado compilado. Nenhum texto de
usuário ou Markdown bruto entra nessa inserção.

O build sempre regenera o artefato a partir do checkout, sem TTL, relógio ou
cache entre versões. Fonte ausente interrompe a geração; entradas malformadas
são isoladas com diagnóstico no build, preservando as válidas, como antes.
`Unreleased` e versões sem nota de usuário continuam fora do histórico.

O cliente monta os cards ao abrir o diálogo e o corpo de cada versão ao
expandir. A precisão das datas permanece nos metadados; instantes continuam
sendo formatados no fuso do dispositivo, após hidratação. Autenticação,
seleção de idioma, foco, Escape e expansão independente permanecem iguais.

## Consequências e verificação

- Requisições não leem nem interpretam os Markdown, e o parser Markdown sai
  da dependência do modal cliente.
- Não é necessário Redis, ISR ou cache público de conteúdo autenticado.
- `pnpm build` e `pnpm dev` preparam o artefato; no desenvolvimento, editar
  as notas exige `pnpm changelog:build` ou reiniciar o servidor.
- O histórico compilado do idioma ativo ainda viaja nas props autenticadas.
  Esta decisão elimina processamento repetido e montagem antecipada, sem
  introduzir uma nova requisição ao abrir o modal.
- Testes do gerador cobrem entradas, regeneração, diagnósticos e ausência de
  fonte. O E2E remove ambos os Markdown depois do build e percorre o modal
  no standalone, incluindo idiomas, segurança, teclado, temas e celular.
