# ADR 0010 — Submissão autônoma: preparar sim, enviar não

**Status:** aceita · 2026-08-19

## Contexto

O pedido original previa "submissão autônoma por agentes" (E-03): o sistema
preencheria formulários de ATS e enviaria candidaturas sozinho.

## O argumento contra, que não é técnico

O produto foi construído sobre uma medição: o acervo tem milhares de vagas e o
funil tem um punhado de candidaturas. A leitura óbvia é "falta capacidade de
enviar". A leitura correta, e a que `docs/product/vision.md` sustenta, é que
**o gargalo é a decisão, não o envio**.

Automatizar o envio antes de a triagem estar calibrada acelera exatamente o
gargalo errado — é o que a categoria inteira de *auto-appliers* faz, e é por
isso que a taxa de resposta deles desaba. Mandar 200 candidaturas por dia não
é uma versão melhor de mandar 4 boas; é uma atividade diferente, com resultado
pior.

E há um dado que ainda não existe: `jho stats` mostra o funil com poder
estatístico nulo. Sem saber qual componente do score prediz resposta, um robô
que submete está automatizando um critério que ninguém verificou.

## Os riscos que não são de produto

- **Termos de uso por plataforma.** Cada ATS tem os seus, e vários proíbem
  preenchimento automatizado. O mesmo rigor da ADR 0001 se aplica: ausência de
  cláusula não é permissão, e cada plataforma exigiria avaliação própria.
- **Irreversibilidade.** Uma candidatura enviada não volta. Enviar para a vaga
  errada, com o CV errado, ou duas vezes, custa a impressão que o sistema
  inteiro existe para construir.
- **Representação.** O agente escreveria em nome de uma pessoa real, para um
  empregador real, sobre a carreira dela.

## Decisão

**Preparar é automatizado. Enviar é do usuário.**

`jho prep <id>` monta o dossiê: bloqueadores primeiro, rede na empresa,
evidências do perfil cujo vocabulário aparece naquele anúncio, lacuna de
vocabulário **daquela vaga**, e os requisitos que o anúncio declara.

Isso ataca o custo real. Uma boa candidatura leva de 40 a 90 minutos, e a maior
parte é remontar contexto que o sistema já tem. Preparar é reversível, custa
nada quando erra, e não representa ninguém.

## Quando reavaliar

Três condições, todas objetivas:

1. **≥ 30 candidaturas com desfecho**, para `jho stats` ter poder de dizer o
   que converte.
2. Uma plataforma cujos termos **permitam** submissão automatizada, por escrito.
3. Aprovação explícita por vaga — nunca em lote.

Faltando qualquer uma, a resposta continua sendo não. E ela é revisável: nada
aqui diz que a ideia é ruim para sempre, apenas que hoje ela resolveria o
problema errado com risco irreversível.

## Invariante

**Nada neste sistema envia uma candidatura.** Se algum dia enviar, será após
confirmação explícita, uma vaga por vez, com registro completo do que foi
mandado. `jho track` continua sendo o usuário dizendo o que fez, nunca o
sistema dizendo o que fez por ele.
