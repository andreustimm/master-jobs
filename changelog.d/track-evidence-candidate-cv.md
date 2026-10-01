## Técnico

### Corrigido

- O painel de evidência das trilhas lê as linhas do CV corrente da candidata e preserva o fallback de perfil quando não existe documento próprio.
- O filtro de lacuna assumida (`growth`) deixou de bloquear termo já citado em `evidence:` própria e de repassar o `growth` do perfil padrão a quem herdou o perfil sem revisar.

## pt-BR

### Corrigido

- Ao abrir ou tornar principal uma trilha, o apoio no currículo passa a refletir o CV salvo na conta, sem atribuir a ela a evidência do perfil padrão.
- Um termo já citado na sua própria evidência continua marcado como apoio, mesmo quando o mesmo termo aparece numa lacuna assumida; e quem ainda não revisou o próprio perfil não herda mais a lacuna assumida de outra pessoa.

## en

### Fixed

- Track evidence now reads the signed-in candidate’s current CV instead of showing evidence inherited from the default profile.
- A term already cited in your own evidence stays marked as support even when it also appears in an assumed gap, and inheriting the default profile no longer inherits someone else's assumed gap too.
