# Contrato de testes — `perfil-publico-limite`

Cada caso abaixo cai em exatamente uma tarefa de `_tasks.md`. Caso órfão e caso
contado duas vezes são o que esta contagem existe para impedir.

| # | Caso | Por que importa |
|---|---|---|
| T1 | Abaixo do limite, todas as requisições passam | Quem chega pelo link não pode ser barrado |
| T2 | Acima do limite, a requisição seguinte é recusada | É a feature |
| T3 | A janela desliza: passado o intervalo, volta a passar | Bloqueio permanente puniria IP compartilhado para sempre |
| T4 | IPs diferentes têm baldes independentes | Um varredor não pode derrubar o acesso de terceiros |
| T5 | Requisição que resulta em 404 conta igual à que resulta em 200 | Contar só uma diria ao varredor qual caminho seguir |
| T6 | Sem cabeçalho de proxy, tudo cai num balde só | Degradação conservadora, sem confiar em cabeçalho ausente |
| T7 | `x-forwarded-for` com lista usa o PRIMEIRO valor | É o cliente; os demais são a cadeia de proxies |
| T8 | O contador não vaza memória: entradas velhas são descartadas | Um processo longo com muitos IPs cresceria sem teto |
| T9 | A resposta recusada é 429 com `Retry-After` | 429 é o código correto; sem `Retry-After` o cliente não sabe quando voltar |
| T10 | Perfil público continua abrindo para quem não excedeu (e2e) | A prova de que a barreira é invisível para o uso legítimo |
