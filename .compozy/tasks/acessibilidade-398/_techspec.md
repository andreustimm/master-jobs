# #398 — estado acessível dos filtros e retorno ao cabeçalho

Complexidade M; revisão L1. Posse bootstrap da coordenadora confirmada em tasks show.

A ordem e o agrupamento só expõem cor. Adicionar aria-current ao estado
real, incluindo relevância sem consulta que recai em aderência. Toggle
propaga testId e estado, sem alterar a URL.

Reprodução pública de baseline: login por Enter da conta sintética Alex
pousou em BODY e o primeiro Tab foi ao cartão `6 open jobs`, pulando cabeçalho.
Adicionar atalho de teclado visível ao foco no início do conteúdo do cockpit
e da lista; destino é cabeçalho global focável por fragmento. É alternativa
explícita aceita pela issue; não muda autenticação ou roteamento.

UI usa dicionário e tokens semânticos. Nenhuma escrita em produção.
O cenário conserva a pendência de VoiceOver/pinch em iPhone físico.
