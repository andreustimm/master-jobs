---
id: CLI-term-search-commands
area: CLI
title: Repetir as buscas salvas e ler a saúde delas pelo terminal
persona: Andreus em triagem
journey: J-save-term-search
expected: terms run busca cada termo ativo uma vez no dia, esperando a janela por minuto, e terms status e tracks list mostram só agregados
entry_points: pnpm jho terms run; pnpm jho terms status; pnpm jho tracks list; pnpm jho sources probe remotive --term laravel
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: SRCH-save-term-from-jobs
---

Com dois ou mais termos ativos, `terms run` não sai enquanto houver captura de
hoje esperando a janela de um minuto do RemoteOK, e cada termo aparece como
concluído na tela Buscas depois. Sem `JHO_ENV` o comando e o probe recusam com
o motivo da guarda. A saída nunca traz termo, consulta ou candidato.
