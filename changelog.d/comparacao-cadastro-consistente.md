## Técnico

### Corrigido

- `/compare` mantém o cadastro manual bem-sucedido mesmo quando o score ainda
  não pode ser calculado para a conta; o fingerprint existente continua
  evitando duplicação em novas tentativas.

## pt-BR

### Corrigido

- Corrigida a mensagem enganosa de falha ao cadastrar uma vaga manual sem
  perfil próprio para pontuação. A ficha agora informa o estado sem score e
  repetir o mesmo cadastro reaproveita a vaga.

## en

### Fixed

- Fixed the misleading failure shown when a manual comparison is saved before
  a candidate has a scoring profile. The job record now opens with an honest
  no-score state, and retrying the same comparison reuses the existing job.
