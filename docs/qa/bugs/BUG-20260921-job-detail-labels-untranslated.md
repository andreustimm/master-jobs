# BUG-20260921-job-detail-labels-untranslated: detalhe da vaga em português com a interface em inglês

- **Status:** fixed
- **Impact (user-side):** Trust-Damage
- **Severity:** High · **Priority:** P1
- **Persona Affected:** Recrutadora convidada
- **Journey Step:** J-trust-the-filtered-board, ao abrir uma vaga da lista
- **Scenarios:** JOBS-english-keeps-posting-data
- **Found:** 2026-09-21 · **Report:** docs/qa/reports/2026-09-21-execucao-ingles-detalhe.md
- **Origin:** mesma classe de [BUG-20260823-pipeline-empty-state-mixed-locale](BUG-20260823-pipeline-empty-state-mixed-locale.md) — literal de interface no JSX, fora do dicionário tipado. Aquele foi corrigido e verificado; este é outra tela, e o motivo de ele ter sobrevivido é estrutural, não repetição do mesmo defeito.

## Summary

Com a interface em inglês, a tela de detalhe da vaga — a mais aberta do produto —
serve três textos de interface em português: o link de volta `← vagas`, o botão
principal `Ver vaga na origem` e o rótulo `visto em` na linha da fonte. Mais três
estão no mesmo arquivo em ramos condicionais e apareceriam nas mesmas condições:
`fechada`, `Aplicar →` e `de 100 · cluster`.

Não é regressão: esses literais estão ali desde que a tela existe. O que faltava
era alguém olhar — a guarda de vazamento de português percorre um **array
literal** de rotas, e `/jobs/<id>` nunca entrou nele. Já eram três rotas
descobertas assim (o hub de países, e antes dele a lista), e é a mesma lição que
`docs/qa/README.md` registra: tela nova não herda guarda nenhuma.

E a tela não podia entrar na guarda como estava, porque o caminho de entrada
estava fechado dos dois lados: o nome da empresa, a localização e o rótulo da
fonte vêm do acervo e são acentuados de direito — sem `data-user-content`, a
guarda reprovaria `São Paulo, State of São Paulo, Brazil` como tradução
esquecida. O defeito de rótulo e a marca faltante se protegiam um ao outro.

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
- O mesmo documento com zero valores do dicionário português detectados fora de
  `data-user-content` — o que prova que a medição não estava cega, e sim que
  literal de JSX **não é** valor do dicionário e por isso escapa desse critério.
  Quem pega literal é a rota estar na lista; o critério do dicionário pega
  tradução mal feita.
- Leitura independente na mesma condição: `/jobs/2/paises` mostra
  `São Paulo, State of São Paulo, Brazil` intacto e sem rótulo em português,
  porque o hub já está na guarda.

## Fix

- **Root cause:** seis textos de interface como literal no JSX de
  `app/jobs/[id]/page.tsx`, e a rota ausente das duas varreduras de inglês em
  `tests/e2e/ui.mjs`.
- **Fix:** seis chaves novas na seção `jobDetail` dos dois dicionários
  (`back`, `closed`, `seenOn`, `openAtSource`, `applyAtSource`,
  `outOfHundredCluster`); `data-user-content` no nome da empresa, na localização
  e no rótulo da fonte; `/jobs/904000101` acrescentada às duas varreduras.
- **Regression test:** as próprias varreduras. Elas reprovam a tela sem a
  correção por dois motivos independentes — o rótulo em português e o acento do
  acervo sem marca —, e é por isso que a rota entrar na lista é a metade do
  conserto que impede a volta.

## Verification

- **Retested:** 2026-09-21 · Recrutadora convidada · `J-trust-the-filtered-board`
- **Result:** ver o relatório da sessão.
