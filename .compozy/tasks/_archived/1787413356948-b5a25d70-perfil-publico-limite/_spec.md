# Limite de requisição no perfil público

**Slug:** `perfil-publico-limite` · **Origem:** AUTH-04, "o que ficou de fora"
· **ADR relacionada:** [0011](../../../../docs/adr/0011-fronteira-compozyos-e-docs.md)

> Primeira jornada real do CompozyOS neste repositório. A feature foi escolhida
> por ser pequena, verificável e genuinamente pendente — não por ser
> conveniente. O objetivo aqui é duplo: entregar o limite **e** descobrir onde o
> ciclo atrita, que é o que a ADR 0011 diz ser precondição para adotar mais.

## Parte de produto

`/p/[slug]` é a única rota do sistema que responde sem sessão. Cada requisição
abre uma consulta ao banco, e não há conta para limitar — a definição de alvo.

Um varredor de slugs custa quase nada a quem varre e uma consulta a cada
tentativa a quem hospeda. Pior: como perfil não público responde 404 e público
responde 200, a rota é um oráculo de existência para quem tem paciência de
tentar nomes.

O que se quer: que o custo de varrer suba o suficiente para deixar de valer, sem
atrapalhar quem legitimamente abriu o link que o candidato mandou.

**Não se quer** CAPTCHA, conta, nem bloqueio permanente de IP. O perfil é um
portfólio; a barreira precisa ser invisível para quem chega pelo link.

## Parte técnica

Limite por IP, em janela deslizante, na memória do processo.

**Na memória, e não em tabela.** A fila de raspagem mora em tabela porque a
tarefa precisa sobreviver a um reinício (ADR 0009). Um contador de requisição é
o oposto: perdê-lo no reinício é aceitável e até desejável — a janela recomeça
e ninguém fica bloqueado por causa de um deploy. Gravar em banco acrescentaria
uma escrita por leitura de página pública, que é exatamente o custo que a
feature existe para reduzir.

**O IP vem do proxy, com cuidado.** `x-forwarded-for` é falsificável por quem
fala direto com o servidor. Em desenvolvimento não há proxy e o cabeçalho não
existe; em produção há, e o primeiro valor da lista é o cliente. Sem proxy
confiável, o limite degrada para "todos no mesmo balde", que é conservador na
direção certa.

**404 e 429 contam igual.** Contar só o 404 diria ao varredor que ele foi
detectado; contar só o 200 deixaria a varredura de slugs inexistentes livre —
que é justamente a varredura.

---

## Atrito descoberto na jornada

Registrado aqui porque a ADR 0011 diz que descobrir onde o ciclo atrita é metade
do objetivo desta primeira volta.

**Sem proxy, o balde é um só.** `clientKey` devolve `"sem-proxy"` quando não há
`x-forwarded-for` nem `x-real-ip`, e isso significa que **todos os visitantes
compartilham o mesmo contador**. Um único cliente insistente esgota o limite do
portfólio para todo mundo.

Apareceu na verificação em browser: a rajada de 45 requisições, rodando antes
das checagens de portfólio, derrubou quatro delas com 429 no lugar de 200. O
teste foi movido para o fim da suíte, e isso é sintoma, não solução.

A degradação continua conservadora de propósito — limitar demais é o erro certo
a cometer quando não se sabe de quem é a requisição, porque a alternativa é
confiar num cabeçalho que qualquer um forja. Para a forma de implantação atual,
que é um operador local, o efeito é nenhum. **Para uma instalação exposta sem
proxy à frente, é auto-negação de serviço**, e essa combinação precisa ser
evitada explicitamente:

- atrás de proxy (Vercel, Cloudflare, nginx) → `x-forwarded-for` existe e cada
  IP tem o próprio balde;
- exposto direto, sem proxy → o limite protege o banco, mas um visitante
  insistente fecha o portfólio para os demais.

O que **não** foi feito, e por quê: usar o IP do socket resolveria, mas o
middleware do Next não o expõe de forma estável — `NextRequest.ip` saiu, e ler
`request.headers` é o que sobra. Contornar isso exigiria sair do middleware, que
é justamente a camada capaz de devolver 429.

## Contrato cumprido

T1–T9 em `tests/rate-limit.test.ts`, cada caso nomeado com o identificador do
contrato. T10 em `tests/e2e/ui.mjs`, no fim da suíte, pelo motivo acima.
