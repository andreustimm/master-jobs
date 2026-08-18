---
description: Monta o kit completo de candidatura para uma vaga (currículo adaptado, carta e mensagem de contato)
---

Monte o kit de candidatura para a vaga indicada em $ARGUMENTS (id da vaga).

1. `pnpm jho jobs show <id>` — leia cluster, keywords casadas/ausentes e blockers.
2. Se houver blocker duro (autorização de trabalho, presencial, W2), **pare** e
   diga ao usuário antes de gastar trabalho.
3. Carregue `profile/profile.yaml`. Só use experiência que esteja em `evidence:`.
4. Gere em `out/<empresa>-<cargo>/`: `cv.md`, `cover-letter.md`, `outreach.md`
   e `notes.md` (o que foi enfatizado e por quê).
5. Sinalize explicitamente qualquer requisito da vaga que caia em `growth:`.
6. Registre: `pnpm jho track <id> preparing -n "kit em out/<dir>"`.

Use as skills `application-kit` e `candidate-profile`.
