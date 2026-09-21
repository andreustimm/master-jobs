# BUG-20260921-job-detail-labels-untranslated: detalhe da vaga em português com a interface em inglês

- **Status:** verified
- **Impact (user-side):** Trust-Damage
- **Severity:** High · **Priority:** P1
- **Persona Affected:** Recrutadora convidada
- **Journey Step:** J-trust-the-filtered-board, ao abrir uma vaga da lista
- **Scenarios:** JOBS-english-keeps-posting-data; JOBS-detail-owner-view-english
- **Found:** 2026-09-21 · **Report:** docs/qa/reports/2026-09-21-execucao-ingles-detalhe.md
- **Origin:** mesma classe de [BUG-20260823-pipeline-empty-state-mixed-locale](BUG-20260823-pipeline-empty-state-mixed-locale.md) — literal de interface no JSX, fora do dicionário tipado. Aquele foi corrigido e verificado; este é outra tela, e o motivo de ele ter sobrevivido é estrutural, não repetição do mesmo defeito.

## Summary

Com a interface em inglês, a tela de detalhe da vaga — a mais aberta do produto —
serve três textos de interface em português: o link de volta `← vagas`, o botão
principal `Ver vaga na origem` e o rótulo `visto em` na linha da fonte. Mais três
estão no mesmo arquivo em ramos condicionais e apareceriam nas mesmas condições:
`fechada`, `Aplicar →` e `de 100 · cluster`. E dois no cartão de score, que
este inventário deixou passar e a revisão profunda achou: `casadas:` e
`ausentes:` — ver *Inventário ampliado*, abaixo.

Não é regressão: esses literais estão ali desde que a tela existe. O que faltava
era alguém olhar — a guarda de vazamento de português percorre um **array
literal** de rotas, e `/jobs/<id>` nunca entrou nele. Já eram três rotas
descobertas assim (o hub de países, e antes dele a lista), e é a mesma lição que
`docs/qa/README.md` registra: tela nova não herda guarda nenhuma.

E a tela não podia entrar na guarda como estava, porque o caminho de entrada
estava fechado dos dois lados: o nome da empresa, a localização e o rótulo da
fonte vêm do acervo e são acentuados de direito — sem `data-user-content`, a
guarda reprovaria `São Paulo, State of São Paulo, Brazil` como tradução
esquecida. Sem a marca a rota não entrava; e mesmo listada, só `← vagas`
reprovaria — ver *Evidence*.

## Reproduction

- **Charter:** CH-recruiter-english-board · **Tour:** Configuration Tour
- **Environment:** ambiente de paridade do `run-isolated.mjs --manual`, PostgreSQL
  isolado, autenticação real, persona `renata@local.test` (recruiter)

1. Entrar como a recrutadora e trocar a interface para inglês.
2. Abrir `/jobs` e clicar numa vaga — no ambiente, a publicação de São Paulo do
   grupo `Country Fixture Lab`.
3. Ler o cabeçalho e os botões.

**Expected:** todo texto de interface em inglês; só o que o anúncio escreveu
permanece como veio, acento incluído.
**Actual:** `← vagas`, `Ver vaga na origem` e `visto em` em português, duas
ocorrências de cada no HTML servido (marcação e payload do RSC).

## Evidence

- Contagem no HTML servido com `jho_locale=en`, antes da correção:
  `2× ← vagas`, `2× Ver vaga na origem`, `2× visto em`.
- O mesmo documento com zero valores **novos** do dicionário português fora de
  `data-user-content`. A leitura original concluía que literal de JSX escapa do
  critério do dicionário, e isso vale para dois dos três: `← vagas` já era valor
  do dicionário (`jobCountries.back`) e teria sido pego com a rota listada.
  `Ver vaga na origem` e `visto em` não têm acento nem estão no dicionário, e
  passariam mesmo com a rota na lista — a lista decide o que é medido, não o que
  reprova.
- Leitura independente na mesma condição: `/jobs/2/paises` mostra
  `São Paulo, State of São Paulo, Brazil` intacto e sem rótulo em português,
  porque o hub já está na guarda.

## Fix

- **Root cause:** seis textos de interface como literal no JSX de
  `app/jobs/[id]/page.tsx`, e a rota ausente das duas varreduras de inglês em
  `tests/e2e/ui.mjs`.
- **Fix commit:** `23fa064` (os seis literais e a marca); `52ba067` (os dois
  rótulos do cartão de score e a fixture acentuada), ambos na PR #170.
- **Fix:** seis chaves novas na seção `jobDetail` dos dois dicionários
  (`back`, `closed`, `seenOn`, `openAtSource`, `applyAtSource`,
  `outOfHundredCluster`); `compare.matchedKeywords` e `compare.missingKeywords`,
  que já existiam, para os dois rótulos do cartão; `data-user-content` no nome da
  empresa, na localização e no rótulo da fonte; `/jobs/904000103` acrescentada às
  duas varreduras.
- **Regression test:** as duas varreduras de vazamento em `tests/e2e/ui.mjs`,
  na publicação de São Paulo do grupo de países. Tirar `data-user-content`
  reprova pelo acento do acervo. Devolver ao JSX `← vagas` ou
  `Ver vaga na origem` reprova pelo dicionário: depois da correção os dois são
  valores de `jobDetail` e ocupam um nó de texto inteiro, e a proteção dura
  enquanto as chaves existirem. `visto em` só reprova enquanto for um nó de
  texto próprio: na forma original, `{label} · visto em {data}`, o nó é
  `· visto em`, que não é valor exato do dicionário nem tem acento. Um literal
  **novo**, sem acento e fora do dicionário, não reprovaria: contra esse, a
  defesa é a regra 9, não a varredura. A primeira versão desta correção varria
  `/jobs/904000101`, de localização "Netherlands", onde tirar a marca não
  reprovaria nada.

## Verification

- **Retested:** 2026-09-21 · Recrutadora convidada · `J-trust-the-filtered-board`
  · `CH-recruiter-english-board`, no ambiente de paridade reconstruído com a
  correção.
- **Result:** verified — os três textos somem do HTML servido com `jho_locale=en`
  e voltam as formas inglesas (2 ocorrências de cada, marcação e payload do RSC);
  `São Paulo, State of São Paulo, Brazil` segue intacto dentro de
  `data-user-content`; sobrevive a duas recargas; confirmado por leitura
  independente em `/jobs/2/paises`; e com `jho_locale=pt-BR` a tela portuguesa
  não mudou.

## Inventário ampliado

- **Found:** 2026-09-21, pela revisão profunda da PR #170 — não por persona.
- `casadas:` e `ausentes:` eram literais no cartão de score de
  `app/jobs/[id]/page.tsx`. Nenhuma das três provas os via: a recrutadora não
  tem candidato, então a tela não mostra score; a fixture das varreduras
  pontuava toda vaga com listas de palavras-chave vazias, e os dois ramos não
  renderizavam; e nenhum dos dois textos tem acento ou é valor do dicionário.
- **Fix commit:** `52ba067`, na PR #170.
- **Fix:** passam por `compare.matchedKeywords` e `compare.missingKeywords`, e a
  fixture de São Paulo ganhou palavras-chave casadas e ausentes para que as duas
  linhas renderizem sob a varredura.
- **Regression test:** nenhum automatizado reprovaria a volta. As duas linhas
  renderizam sob a varredura, mas `casadas:` não tem acento nem é valor do
  dicionário — contra isso, a defesa é a regra 9.
- **Verification:** pendente. A persona de `JOBS-english-keeps-posting-data` não
  alcança o cartão; a confirmação pela interface está em
  `JOBS-detail-owner-view-english`, criado `untested`.
