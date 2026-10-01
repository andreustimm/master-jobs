## Técnico

### Corrigido

- `analyseGap` (`src/core/candidate.ts`) deixa de montar os termos com o `profile.yaml` da instalação para qualquer candidato. Termos e vagas passam a vir da mesma trilha principal do candidato, pelo perfil efetivo que o scorer usa (`trackScoringProfiles`): as `keywords` do alvo da principal e as notas dessa trilha (`scoreTrackFilter`). O perfil de matching gravado não entra, porque a fila o deriva do currículo (dono incluído) e as `keywords` dele já estão no CV, o que esvaziaria "faltante". Limite conhecido: a principal de quem nunca a editou também foi montada a partir do currículo, então a lista de faltantes dessa pessoa fica vazia até ela definir a busca. O dono continua com o vocabulário do `profile.yaml` enquanto a principal dele vier dele; editar ou promover a principal muda termos e vagas juntos; principal pendente (sem perfil próprio) devolve relatório vazio. Não muda o scorer nem `SCORER_VERSION`. Testes de banco com dono e convidada em `tests/cov-core-candidate-gap.test.ts` e área E2E `candidate-gap` (#427).

## pt-BR

### Corrigido

- A análise de lacunas de vocabulário na Área do candidato compara o seu currículo com os termos da sua busca principal, e não mais com os do dono do sistema. Editar ou trocar a busca principal muda a comparação; enquanto a sua busca principal ainda for a que o sistema montou a partir do currículo, a lista de termos que faltam tende a ficar vazia, e ela só passa a apontar lacunas quando você define o que procura. Se você ainda não tem um perfil de busca, a seção mostra que não há vagas para comparar.

## en

### Fixed

- The vocabulary gap analysis in the Candidate area now compares your CV with the terms of your primary search, no longer with the system owner's. Editing or switching your primary search changes the comparison; while your primary search is still the one the system built from your CV, the list of missing terms tends to stay empty, and it only points out gaps once you define what you are looking for. If you do not have a search profile yet, the section says there are no jobs to compare.
