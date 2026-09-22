# Plano de governança das regras

## Problema

O repositório acumula invariantes, relatos de incidentes, instruções operacionais, comandos e estado do produto no mesmo ponto de entrada. Há cópias normativas em skills e documentos de produto, algumas já contraditórias. Encontrar uma frase em um teste não significa que a violação da regra seja impedida: parte das verificações usa expressões regulares, listas fixas ou configuração local que pode ser contornada no servidor.

O problema tem dois lados: diminuir a ambiguidade para quem implementa e fazer com que erros relevantes produzam reprovação no lugar certo. Encurtar `AGENTS.md` sem preservar suas obrigações, ou criar skills que só protejam quando invocadas, não atende ao objetivo.

## Objetivo e usuários

Mantenedores, implementadores humanos/agentes e revisores devem conseguir determinar a regra aplicável, sua fonte normativa, seu procedimento e a evidência exigida, sem depender de conhecer o histórico de incidentes.

O resultado esperado da implementação futura é uma entrada curta e suficiente para trabalho seguro, referências por domínio com responsabilidade clara e verificações proporcionais ao risco. O resultado desta tarefa é apenas o plano revisável para chegar lá.

## Escopo entregue nesta auditoria

- Inventário das 23 regras numeradas, invariantes intercaladas e obrigações de fluxo, arquitetura, harnesses e documentação em `AGENTS.md`.
- Cruzamento com as 14 skills locais, comandos, configurações, docs operacionais e de QA, hooks, workflows e testes pertinentes.
- Leitura das asserções dos testes usados como evidência, incluindo escopo descoberto ou enumerado, casos negativos e condições de execução.
- Consulta somente leitura às proteções do GitHub.
- Proposta de organização, resolução explícita de contradições, grafo de tarefas e critérios de aceitação.

O inventário é de obrigações de desenvolvimento e salvaguardas. Não pretende recatalogar todos os requisitos funcionais de cada feature histórica, nem certificar a implementação inteira do produto.

## Fora do escopo da etapa original de auditoria

Não mover ou editar regras atuais; não alterar skills, código, testes, hooks, CI, secrets ou proteções; não executar migrations, sync, scoring, candidatura, publicação ou QA no produto; não abrir PR, criar release ou implantar mudanças. Não verificar conteúdo de secrets ou dados pessoais. Não executar as tarefas planejadas.

Depois da auditoria, o usuário autorizou o commit, a PR deste pacote e o cadastro das ações de melhoria. Essa autorização substitui a restrição de publicação acima. A PR documental registra o plano; implementação e configuração são entregas das issues correspondentes, com os gates aplicáveis.

## Requisitos da implementação futura

| ID | Requisito | Evidência de aceitação |
|---|---|---|
| RQ-01 | Toda obrigação inventariada deve ter destino e tratamento explícitos. | Mapeamento completo dos IDs `G`; nenhuma remoção silenciosa. |
| RQ-02 | Regras críticas devem ser visíveis na entrada e aplicáveis sem skill. | Leitura inicial dos três harnesses; skills referenciam, não redefinem a política. |
| RQ-03 | Preservar uma cópia canônica de instruções e de skills. | `CLAUDE.md → AGENTS.md`, `.codex/skills` e `.opencode/skills → ../.claude/skills`; não copiar árvores. |
| RQ-04 | Cada alegação de cobertura deve dizer o que mede, o que não mede e onde roda. | Evidência comportamental ou estrutural qualificada, com casos negativos e gatilhos. |
| RQ-05 | Promoção, autenticação, privacidade e decisões do usuário devem falhar de forma segura. | Casos adversos atribuídos às tarefas P0; configuração remota observada separadamente de fixtures. |
| RQ-06 | Migração PostgreSQL deve ter procedimento compatível com o banco e prova sobre dados anteriores. | Upgrade de fixture, FKs aplicadas, credenciais e sequência de deploy verificados. |
| RQ-07 | Documentação de estado, história e procedimento deve ter lugares distintos. | Regras por domínio; estado em `docs/`; razões em ADRs; execução em skills; especificações no slug. |
| RQ-08 | Gates não devem virar cerimônia para alterações sem risco de runtime. | Markdown/metadados recebem validação estrutural; alteração funcional recebe checks, E2E/QA aplicáveis. |
| RQ-09 | Exceções devem ter escopo e salvaguarda substituta explícitos. | Login/reset/callback/cron, retenção e hotfix não criam dispensas genéricas. |
| RQ-10 | O plano deve ser executável por entregas independentes. | Grafo acíclico, tarefas pendentes, aceitação e validações com dono único. |

## Critérios de sucesso

Na implementação: nenhuma regra válida perdida; nenhum segredo ou dado de produção usado em testes; nenhum controle forte substituído por grep; branches permanentes preservadas; promoção sem CI do commit alvo e produção sem intervenção humana recusadas; migrations orientadas a PostgreSQL; novas rotas/actions incluídas na verificação; links e symlinks íntegros; exceções documentadas sem ampliar acesso.

Nesta auditoria: todos os documentos ficam no slug; os achados distinguem observação de inferência; a matriz referencia evidências reais; cada tarefa possui critérios verificáveis; o pacote passa pela validação estrutural registrada em `_validation.md`.

## Riscos e decisões em aberto

- Proteções remotas precisam acomodar as automações de versão/promoção com privilégios mínimos. Uma regra genérica que bloqueie todo push pode paralisar o fluxo; um bypass geral do bot anula a proteção.
- A forma de garantir intervenção humana precisa funcionar com os mantenedores disponíveis e recursos do repositório. Não presumir que o autor possa aprovar sua própria PR nem que um plano do GitHub ofereça qualquer configuração.
- O commit automático de versão altera o alvo da promoção. A tarefa 01 deve definir e provar qual commit recebe os checks necessários; não chamar uma transformação de segura sem validar seu resultado.
- Garantir privacidade de campos estruturados não equivale a higienizar todo texto de CV autorizado para publicação. Segundo consentimento não revoga a proibição de expor piso/contatos protegidos. A implementação precisa tratar o texto público e sua prévia sem prometer sanitização perfeita nem aceitar uma exceção tácita.
- Há trabalho paralelo em outras worktrees. Revalidar baseline e estados antes de implementar; não usar esta fotografia como autorização para sobrescrever mudanças.

Nenhuma dessas decisões bloqueia a entrega deste plano. Elas são critérios das tarefas correspondentes, sem alterar a política vigente durante a auditoria.
