## Técnico

### Corrigido

- O campo de termo em `/searches` deixa o domínio receber entradas acima de 60 caracteres, para que a validação `term_too_long` recuse o valor completo sem criar um termo truncado. A regressão cobre o contrato do campo e a jornada E2E após recarregar.
- A recusa de termo (longo, curto, duplicado) não apaga mais o que a pessoa digitou — só o envio aceito limpa o campo (`MutationFeedbackForm` ganha `clearOnSuccess`, usado junto de `keepFields` em `/searches`).

## pt-BR

### Corrigido

- Colar um termo longo em Buscas agora mostra o aviso de limite e não salva uma versão cortada.
- Quando o termo é recusado, o texto digitado continua no campo para corrigir — antes, era preciso colar tudo de novo.

## en

### Fixed

- Pasting a long term in Searches now shows the length warning and does not save a truncated version.
- When a term is refused, the typed text stays in the field to fix — it used to be lost and had to be pasted again.
