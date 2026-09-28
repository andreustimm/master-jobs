---
id: PUB-public-image-revoked-404
area: PUB
title: Link guardado da foto responde 404 depois que o perfil deixa de ser público ou a foto deixa de ser mostrada
persona: Visitante do perfil público
journey: J-open-public-profile
expected: Com o perfil público e a foto ligada, /p/<slug>/image/photo abre a imagem sem sessão; depois de tornar o perfil privado, desligar "mostrar", remover a foto ou trocar o endereço, a MESMA URL copiada antes responde 404 vazio, igual ao de um endereço que nunca existiu, e continua 404 depois do refresh; a URL do perfil antigo também é 404
entry_points: /candidate; /p/[slug]/image/[kind]
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: PUB-public-photo-cover-opt-in; PUB-public-address-private-404
---

Criado com a parte B de #327. É a garantia de privacidade da issue: a imagem
não é servida por URL do provedor, e sim por uma rota do app que reconfere a
visibilidade a cada pedido. Copie a URL da foto numa janela anônima, depois
revogue de cada um dos quatro jeitos (privado, "mostrar" desligado, remover,
trocar o endereço) e recarregue a URL copiada: tem de ser 404, sem corpo,
com o mesmo cabeçalho de um endereço inventado. Religar tudo volta a servir
a foto na mesma URL do endereço atual.
