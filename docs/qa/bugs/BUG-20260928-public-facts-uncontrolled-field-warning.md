# BUG-20260928-public-facts-uncontrolled-field-warning: console avisa troca de campo não controlado para controlado ao salvar os fatos do perfil público

- **Status:** open
- **Impact (user-side):** Cosmetic
- **Severity:** Low · **Priority:** P3
- **Persona Affected:** Andreus no celular
- **Journey Step:** J-choose-public-address, passo de editar e salvar os sete fatos opt-in em `/candidate`
- **Scenarios:** PUB-edit-public-facts
- **Found:** 2026-09-28 · **Report:** docs/qa/reports/2026-09-28T180205401032Z-d6d772a5-perfil-publico-opt-in-targeted.md

## Summary

Não afeta o que a pessoa vê ou salva — os sete fatos gravam e persistem
corretamente em todos os testes desta sessão. Mas o console do navegador
(modo desenvolvimento) registra um aviso do React/Base UI logo após o
primeiro "Salvar dados" no cartão "Dados do perfil público": um `FieldControl`
muda de não controlado para controlado depois de já ter sido inicializado.
Esse padrão costuma indicar que algum campo novo nasce com valor `undefined`
antes do primeiro carregamento e só recebe um valor definido depois — sinal de
possível fragilidade que vale checar no código, mesmo sem efeito observável
nesta rodada.

## Reproduction

- **Charter:** CH-public-facts-edit-mobile · **Tour:** Feature Tour
- **Environment:** phone-small (375×812), pt-BR, `qa-perfil-publico-opt-in@local.test`, `http://localhost:3101`

1. Entrar em `/candidate` autenticado.
2. No cartão "Dados do perfil público", marcar "Remoto" em Modelo de trabalho,
   ligar "Mostrar no perfil público" nesse fato e em Disponibilidade, Aceita
   mudar, Área e Idiomas (com valores preenchidos).
3. Clicar em "Salvar dados".

**Expected:** Nenhum aviso de console sobre componente não controlado.
**Actual:** Console mostra `[ERROR] Base UI: A component is changing the
default value state of an uncontrolled FieldControl after being initialized.
To suppress this warning opt to use a controlled FieldControl.` logo após o
primeiro salvamento. O salvamento em si funciona (mensagem "Dados do perfil
salvos." aparece e os valores sobrevivem ao refresh).

## Evidence

- `docs/qa/evidence/2026-09-28T180205401032Z-d6d772a5-perfil-publico-opt-in-targeted/CH-public-facts-edit-mobile-step3.png`
- Log bruto do console capturado pela sessão `playwright-cli` local (não
  versionado; timestamp relativo `52563ms` após abrir `/candidate`, coincide
  com o clique em "Salvar dados").
- Não investigado qual campo específico dispara o aviso (não foi lido código
  para atribuir causa, só observado o console) — próxima sessão pode isolar
  campo a campo.

## Fix

<!-- não corrigido nesta rodada — instrução da tarefa foi registrar e reportar, não corrigir -->

## Verification

<!-- pendente -->
