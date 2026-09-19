---
id: SRCH-save-term-from-jobs
area: SRCH
title: Salvar numa trilha o termo buscado em Vagas
persona: Andreus em triagem
journey: J-save-term-search
expected: A oferta de Vagas abre Buscas com o termo preenchido, e o termo salvo aparece na trilha com um estado por plataforma
entry_points: /jobs?q=laravel; /searches
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: JOBS-term-filter-descriptions
---

Buscar um termo com poucas vagas, aceitar a oferta e salvar. O aviso de
sucesso diz que a busca começou; cada plataforma mostra na fila, buscando,
concluída, aguardando cota ou falhou, com o motivo traduzido. Recarregar
Buscas depois de alguns segundos e conferir que o estado avançou sem
interação. Nenhum texto de termo aparece como HTML interpretado.
