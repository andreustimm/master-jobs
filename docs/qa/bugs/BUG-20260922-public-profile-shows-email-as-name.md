# BUG-20260922-public-profile-shows-email-as-name: conta criada por `jho auth add-user` publica o próprio e-mail como nome

- **Status:** fixed <!-- open | fixed | verified | wont-fix | invalid -->
- **Impact (user-side):** Trust-Damage
- **Severity:** High · **Priority:** P1
- **Persona Affected:** Visitante do perfil público (quem lê); a candidata dona da conta (quem é exposta)
- **Journey Step:** J-choose-public-address, passo de tornar o perfil Público; J-open-public-profile, primeira leitura anônima
- **Scenarios:** PUB-public-name-never-email
- **Found:** 2026-09-22 · **Report:** docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md

## Summary

Uma conta de candidato criada pela CLI (`jho auth add-user <email> --role candidate`)
ganha um candidato próprio cujo **nome é o e-mail**. Quando a pessoa escolhe um
endereço e marca o perfil como Público, `/p/<endereço>` mostra o e-mail como
título do perfil, para qualquer visitante sem login — embora a própria tela do
candidato prometa "Nunca aparecem em perfil público: e-mail, telefone, funil e
candidaturas". Não há como corrigir pela interface: trocar o nome em Minha conta
não muda o nome do candidato, e `/candidate` não tem campo de nome.

Contas criadas por `/admin/users` usam o nome completo digitado e não têm o
problema; a primeira conta da instalação usa o `profile.yaml`. O comportamento
nasce em `claimOwnCandidate({ email, name: email })`, chamado por `addUser`
(`src/contexts/auth/app/accounts.ts`), que entrou nesta release (#240/#241).

## Reproduction

- **Charter:** CH-public-address-change · **Tour:** Antisocial Tour
- **Environment:** ambiente de paridade `run-isolated.mjs --manual` (build standalone, PostgreSQL isolado, `JHO_AUTH_MODE=secure`); celular 375×812, en-US

1. Pela CLI do ambiente: `jho auth add-user pia@local.test --role candidate` e `jho auth set-password pia@local.test --stdin`.
2. Entrar como `pia@local.test` e abrir `/candidate`: o bloco de identidade mostra `pia@local.test`.
3. Em Endereço público, salvar `pia-qa` ("Address saved.").
4. Em Quem vê este perfil, marcar Público e salvar.
5. Numa sessão anônima, abrir `/p/pia-qa` e recarregar.
6. (Tentativa de correção) Em Minha conta, trocar o nome de exibição para "Pia Lopes" ("Name saved.") e reabrir `/p/pia-qa`.

**Expected:** o perfil público nunca exibe o e-mail; sem um nome escolhido, a tela pede um nome antes de publicar ou usa outra forma que não seja o endereço.
**Actual:** `/p/pia-qa` responde 200 e o texto inteiro do perfil é `pia@local.test`, antes e depois do reload, e também depois de trocar o nome em Minha conta.

## Evidence

- `docs/qa/evidence/2026-09-22-rc-1.22.0/s3-pia-public-name-is-email.png`
- Log da sessão: `docs/qa/evidence/2026-09-22-rc-1.22.0/log.txt` (linhas "anônimo /p/pia-qa → 200 contém e-mail=true" e "público depois do rename: pia@local.test")

## Fix

<!-- filled when status moves to fixed -->
- **Root cause:** `addUser` cria o candidato com `name: email`, e `publicProfile()` publica o nome do candidato sem filtrar endereço de e-mail.
- **Fix commit:** 2371b8b (`fix/bugs-qa-1.22.0`) — `initialCandidateName` na CLI e em `claimOwnCandidate`; `containsContact` em todo campo de texto de `publicProfile()`; cartão "Nome no perfil" em `/candidate` (`setPublicNameAction`); migration de dados `0014_clear_contact_candidate_names`.
- **Regression test:** `tests/public-name.test.ts` (add-user → público → `/p/` sem o e-mail; campo gravado por fora esvaziado; ação com guarda antes do efeito; migration 0014 idempotente); `tests/e2e/ui.mjs` (título neutro em `/p/e2e-e2e-alvo`, cujo setup grava o e-mail como nome; nome editado aparece no `/p/` anônimo).

## Verification

<!-- filled when status moves to verified -->
- **Retested:**
- **Result:**
