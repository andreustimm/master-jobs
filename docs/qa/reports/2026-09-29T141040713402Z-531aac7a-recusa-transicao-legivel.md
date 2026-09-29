# QA targeted — recusa de transição legível

- Issue: #389; entrega: PR draft para dev, revisão e merge pela coordenadora.
- Branch: fix/recusa-transicao-legivel; base: 36c120c.
- Persona: Andreus em triagem noturna, pt-BR, laptop; prova adicional em 375px.
- Ambiente: build standalone, PostgreSQL descartável, login real; sem produção.
- Driver planejado: agent-browser, interface pública.

## Matriz

| Charter | Cenário | Tour | Estado |
|---|---|---|---|
| CH-refused-transition-draft | PIPE-refused-transition-keeps-draft | Back-Button Tour | Pending |
| CH-save-resume-application | PIPE-save-resume-decision | Back-Button Tour | Pending |

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

Aguardando ambiente manual.

## Limitações

Wi-Fi local; sem telefone físico, leitor de tela ou extensões de terceiros.
Suíte completa será executada pelo CI, conforme G57; esta rodada cobre os testes relacionados.

## Estado final

Em execução.
