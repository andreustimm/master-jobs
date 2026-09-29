# QA targeted — recusa de transição legível

- Issue: #389; entrega: PR draft para dev, revisão e merge pela coordenadora.
- Branch: fix/recusa-transicao-legivel; base: 36c120c.
- Persona: Andreus em triagem noturna, pt-BR, laptop; prova adicional em 375px.
- Ambiente: build standalone, PostgreSQL descartável, login real; sem produção.
- Driver: agent-browser, interface pública.

## Matriz

| Charter | Cenário | Tour | Estado |
|---|---|---|---|
| CH-refused-transition-draft | PIPE-refused-transition-keeps-draft | Back-Button Tour | Pass |
| CH-save-resume-application | PIPE-save-resume-decision | Back-Button Tour | Pass |

## Plano de sessão

Provocar recusa entre duas abas, ler mensagem e rascunho após seis segundos,
dispensar aviso, salvar a nota sem redigitar numa transição válida, recarregar,
reabrir pelo funil e reler pela CLI pública. Explorar voltar/avançar, recarga,
nota com acentos, abandono sem salvar e viewport estreito.

## Validação automatizada

- Regressão antes da correção: 25/26 checks; apenas permanência aos seis segundos falhou.
- Primeira execução após correção: 26/27; regressão passou, mas leitura da URL após login permaneceu na URL anterior apesar da sessão válida e de todo o funil passar. Repetição sem mudança de código: **27/27 verificações passaram**, exit 0, Node 24.19.
- Vitest relacionado: 2 arquivos, 7 testes passaram.
- Typecheck com Node 24.19: exit 0.

## Sessões e observáveis

Reteste em 29/09/2026 sobre `5b70e2c`, login real como Alex no ambiente descartável. Duas abas: a segunda voltou a candidatura para A fazer; a primeira tentou Preparando com nota. O aviso nomeou os estágios e permaneceu visível aos seis segundos; o campo conservou o texto. Screenshot: `docs/qa/evidence/2026-09-29T141040713402Z-531aac7a-recusa-transicao-legivel/recusa-6s.png`.

Na repetição, sem redigitar a nota recusada, selecionei Pré-selecionada e salvei pelo teclado. A nota ‘Confirmar com recrutadora na sexta-feira às 14h.’ apareceu no histórico após refresh, retorno pelo Funil, voltar/avançar e novo login. A CLI pública `jobs show 1` confirmou `Pipeline shortlisted`; ela não exibe notas. Evidência: `docs/qa/evidence/2026-09-29T141040713402Z-531aac7a-recusa-transicao-legivel/persistencia.png`.

Probes: concorrência em duas abas, acentos e horário, refresh, voltar/avançar, abandono de nota antes de sair e 375px (scrollWidth 360, innerWidth 375). A edição abandonada não substituiu a nota salva.

O driver não ativou alguns controles por clique; a jornada prosseguiu por foco e Enter. Uma tentativa com localizador de foco inválido acionou Desfazer; repeti a preparação e a recusa, e só a repetição completa sustenta a persistência. Dispensa do toast está coberta pelo E2E, sem atribuir prova manual inexistente.

## Limitações

Wi-Fi local; sem telefone físico, leitor de tela ou extensões de terceiros.
Suíte completa será executada pelo CI, conforme G57; esta rodada cobre os testes relacionados.

## Estado final

Pass nos dois cenários sobre o commit indicado. PR #407 permanece draft para revisão da coordenadora.
