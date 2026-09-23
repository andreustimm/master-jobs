## Técnico

### Alterado

- Governança (#196): rulesets do GitHub aplicados. `main`, `staging` e `dev` recusam exclusão e force-push para todos. `main` exige PR com 1 aprovação e os checks `qualidade` e `schema-e-migracao`, sem modo estrito e sem bypass de CI; o admin só dispensa a aprovação dentro de PR, e o `GITHUB_TOKEN` não tem bypass. O ambiente `Production` só aceita `main`, e `can_admins_bypass` está desligado. O push direto do commit de versão de hotfix em `main` passa a ser recusado e segue por PR humana. `dev` e `staging` ficam sem PR/CI obrigatório no remoto porque a API recusa o GitHub Actions como bypass em repositório de conta pessoal. `scripts/github/verify-protections.ts` confere o estado efetivo; limites da plataforma e reversão em `docs/engineering/github-protections.md`.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
