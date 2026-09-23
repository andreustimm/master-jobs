## Técnico

### Adicionado

- `scripts/github/verify-protections.ts` confere o estado efetivo dos rulesets e do ambiente `Production` contra a política versionada (#196); limites da plataforma, caminho humano e reversão em `docs/engineering/github-protections.md`.

### Alterado

- Governança (#196): `main`, `staging` e `dev` recusam exclusão e force-push para todos.
- `main` exige PR com 1 aprovação e os checks `qualidade` e `schema-e-migracao`, sem modo estrito e sem bypass de CI; o admin só dispensa a aprovação dentro de PR, e o `GITHUB_TOKEN` não tem bypass.
- O ambiente `Production` só aceita `main`, e `can_admins_bypass` está desligado.
- O push direto do commit de versão de hotfix em `main` passa a ser recusado; a versão do hotfix fecha por PR humana, com a tag criada antes dela.
- `dev` e `staging` ficam sem PR/CI obrigatório no remoto porque a API recusa o GitHub Actions como bypass em repositório de conta pessoal.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
