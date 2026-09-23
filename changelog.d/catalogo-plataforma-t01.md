## Técnico

### Adicionado

- Catálogo de fontes governado pelo banco (#223, tarefa 01). Migration aditiva
  `0017_source_catalog`: `source` ganha `retired_at`, `origin`, `config_revision`,
  `secret_ref` e `managed_at`. Linha não gerida espelha `config/sources.yaml`,
  inclusive `enabled: false`, e é desabilitada quando sai do arquivo; linha
  gerida (importada ou editada) nunca é sobrescrita pelo YAML.
- `jho sources import [--apply]` (simula por padrão) e `jho sources diff` (nunca
  grava). O plano é puro (`planCatalogImport` em
  `src/contexts/sourcing/domain/catalog.ts`), com `capabilitiesOf`,
  `classifySourceProbe`, `validateCatalogWrite` e `validateSecretRef`.
- Cada adapter declara `snapshot` (`complete` quando pode provar o fim da
  listagem, `partial` quando nunca). Casos de uso do catálogo no contexto
  `sourcing`: cadastrar, editar, desabilitar, aposentar e sondar sem gravar.

### Alterado

- O sync (`jho jobs sync`, `jho jobs sweep` e a fatia `sync` da varredura)
  seleciona as fontes do banco por `catalogForSync()`: habilitada, não
  aposentada, kind com adapter e handle fora de `~terms`. `loadSources()`
  devolve toda entrada com `enabled`; saúde e captura por termo filtram as
  habilitadas explicitamente.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
