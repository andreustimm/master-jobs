# BUG-20260921-long-term-cut-silently: termo colado acima de 60 caracteres é cortado e salvo sem aviso

- **Status:** fixed <!-- open | fixed | verified | wont-fix | invalid -->
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
- **Fix commit:** e6ff264 (`fix: validar termo longo sem corte`); `<FIXER_SHA>` (`fix: manter o termo digitado na recusa e limpar só no sucesso`) — a correção de e6ff264 deixava a validação do servidor alcançável, mas o `MutationFeedbackForm` ainda reiniciava o campo em qualquer desfecho (React reseta formulário não controlado quando a action assenta); a pessoa recusada perdia o texto colado e tinha de colar e cortar de novo às cegas.
- **Regression test:** `tests/mobile.test.ts` (o campo não corta antes da validação; localizado por `data-testid`, não por `name="term"` ser o primeiro atributo); `tests/e2e/ui/searches.mjs` (termo de 65 caracteres mostra `term_too_long`, **mantém os 65 caracteres no campo** depois da recusa, some do campo depois de um envio aceito, e não aparece — inteiro nem cortado em 60 — após recarregar).

## Verification

<!-- filled when status moves to verified -->

## Re-found (2026-09-29)

- **Charter:** CH-term-input-mistreated · **Report:** docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md (QA full do release candidate 1.29)
- Mesmo sintoma reproduzido: colar 61 caracteres em Buscas corta para 60 e
  salva sem a mensagem de termo longo. `maxlength=60` continua no campo.
- **Evidence:** `docs/qa/evidence/2026-09-29T035351654581Z-97f37e1c-full/CH-term-input-mistreated/01-61-chars-cortado-salvo.png`
