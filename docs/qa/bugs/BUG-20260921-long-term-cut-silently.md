# BUG-20260921-long-term-cut-silently: termo colado acima de 60 caracteres é cortado e salvo sem aviso

- **Status:** open <!-- open | fixed | verified | wont-fix | invalid -->
- **Impact (user-side):** Friction
- **Severity:** Medium · **Priority:** P2
- **Persona Affected:** Andreus em triagem
- **Journey Step:** J-save-term-search, passo 2 (salvar o termo numa trilha)
- **Scenarios:** SRCH-term-validation
- **Found:** 2026-09-21 · **Report:** docs/qa/reports/2026-09-21T175034729239Z-e901131e-qa-buscas.md

## Summary

Quem cola em Buscas um termo mais longo que o limite não recebe a mensagem de
termo longo: o campo corta o texto em 60 caracteres, e o que sobrou é salvo com
"Salvo." A pessoa não fica sabendo que o termo gravado não é o que ela colou. O
cenário pede o contrário — o termo longo mostra a mensagem própria e nenhum caso
cria termo.

## Reproduction

- **Charter:** CH-term-input-mistreated · **Tour:** Garbage Tour
- **Environment:** laptop 1280×800 / wifi-fast / pt-BR, ambiente de paridade `run-isolated.mjs --manual`, conta `alex@local.test`

1. Entrar como o dono e abrir Buscas.
2. Colar no campo Termo um texto de 61 caracteres.
3. Clicar em SALVAR TERMO.

**Expected:** a mensagem de termo longo, e nenhum termo criado.
**Actual:** "Salvo. As capturas estão desligadas neste ambiente." e um termo novo com os primeiros 60 caracteres.

## Evidence

- O campo tem `maxlength=60`: o navegador descarta o 61º caractere antes do envio, então a validação de tamanho do servidor nunca é alcançada pela tela.
- Leitura independente: depois de recarregar Buscas, o termo gravado tem 60 caracteres.
- Os outros casos do cenário passaram: `a` ("O termo precisa de pelo menos 2 caracteres."), `<script>`, emoji e aspas curvas ("O termo tem um caractere não aceito…"), `Tech Lead` depois de `techlead` e `  rust  ` ("Esse termo já está salvo." com o link "ver o termo"), e o 21º termo ativo ("Você já tem 20 termos ativos. Pause ou apague um antes.").

## Fix

<!-- filled when status moves to fixed -->
- **Root cause:** o sintoma é o termo cortado sem aviso; a causa é o `maxlength` do campo, que impede o envio do texto inteiro e com ele a mensagem de termo longo que o servidor já tem.
- **Fix commit:**
- **Regression test:**

## Verification

<!-- filled when status moves to verified -->
- **Retested:**
- **Result:**
