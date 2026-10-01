# Techspec — evidência da trilha usa o CV da candidata (#393)

## Tamanho e entrega

- **Tamanho:** M.
- **Entrega:** PR draft para `dev`, com correção no leitor de evidência e
  regressão de integração.
- **Worktree:** `.claude/worktrees/track-evidence-candidate-cv`.
- **Branch:** `fix/track-evidence-candidate-cv`.

## Problema e causa

O editor de trilha chama `trackSupport()`, que monta `ownEvidence()` a partir
de `profile.evidence` do perfil de matching persistido. A derivação por CV
reaproveita o perfil padrão para os campos que o currículo não informa e deixa
esse `evidence` intacto. Para uma candidata que tem CV, a leitura portanto
compara a trilha com evidência de outra pessoa, marca `inherited` e ignora o
texto que a candidata salvou.

## Contrato

1. Quando existir um CV corrente não vazio para o `candidateId`, suas linhas
   entram em `OwnEvidence.lines` para `trackOverview`, `trackSuggestion` e
   `trackSupport`: substituem a evidência do perfil quando ela é herdada do
   padrão ou quando não existe perfil próprio; somam à evidência quando ela é
   própria da pessoa (dono, ou candidata que já revisou a sua) — o CV nunca
   apaga `evidence:` que é da própria pessoa.
2. A presença do CV corrente impede que a evidência herdada do perfil padrão
   seja marcada como tal; `inherited` fica `false` nesse caso.
3. Skills confirmadas continuam somando suporte mesmo quando o texto do CV não
   contém o termo.
4. Termo presente só em `growth:` do perfil da pessoa nunca sustenta (regra 7
   do AGENTS.md), nem quando o texto bruto do CV o menciona.
5. Sem CV corrente, o comportamento existente permanece: um perfil próprio
   pode fornecer `evidence`, e evidência copiada do perfil padrão continua sem
   sustentar a trilha (`inherited=true`).
6. O ajuste não muda o scorer, `profile.yaml`, persistência de matching,
   autorização ou texto de interface.

## Implementação mínima

- Reutilizar `currentDocument`, a porta já usada pelo matching para ler o CV
  corrente, no adapter de evidência.
- Transformar o conteúdo em linhas apenas no caso de conteúdo não vazio.
- Usar o perfil persistido como fallback sem documento próprio.
- Cobrir o caso com CV e evidência herdada em `tests/target-tracks.test.ts`.
