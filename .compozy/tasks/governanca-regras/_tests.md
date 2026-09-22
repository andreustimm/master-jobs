# Contrato de validação da implementação futura

**Todos os casos abaixo são planejados e não executados.** A validação do pacote documental entregue nesta auditoria está em [_validation.md](_validation.md). Os casos têm dono único pelo prefixo: `V01-*` pertence a `task_01`, e assim por diante. Uma verificação existente que já satisfaz o observável deve ser reutilizada, com resultado atual registrado.

Para cada execução futura, registrar comando/ambiente, commit ou diff, resultado e evidência pertinente. “Arquivo existe”, nome de teste e trecho de YAML não substituem o observável indicado. Testes destrutivos ou de autorização remota usam fixtures/ambiente descartável; nunca publicar produção, enviar candidatura ou acessar LinkedIn para provar uma recusa.

## task_01 — Proveniência da promoção

| Caso | Entrada ou falha provocada | Resultado exigido / método |
|---|---|---|
| V01-01 | CI aprova A enquanto a ponta de dev avança para B sem CI. | Planejador/execução em repo temporário recusa B ou mantém alvo A conforme contrato; nunca promove B apenas pela conclusão de A. |
| V01-02 | Dispatch com checks ausentes, falhos, pendentes ou de outro SHA; caminho positivo com todos aprovados. | Recusa antes de push/tag/PR nos negativos; aceita só o alvo validado no positivo. Mock de API verifica consultas e ausência de escrita. |
| V01-03 | Schema muda entre staging e o alvo; apenas a ponta posterior tem outra mudança. | Gate compara intervalo correto; sem confirmação de migração não promove; dispatch não dispensa o CI. |
| V01-04 | Versionamento cria commit novo; retry ocorre depois de dev avançar. | SHA de release e checks seguem política explícita; retry não reescolhe alvo. Tag aponta para commit exato e operações permanecem idempotentes. |
| V01-05 | Staging divergiu; retorno main→dev precisa PR; release já existe. | Nenhum force-push/merge indevido em staging/main; preservar retorno e release existente. Exercitar helpers em Git temporário e executar regressões de release. |

## task_02 — Proteções do servidor

| Caso | Entrada ou falha provocada | Resultado exigido / método |
|---|---|---|
| V02-01 | Consultar configuração antes e depois, incluindo rulesets, branches e ambiente. | Evidência GET identifica recursos, regras efetivas, checks e atores com bypass; valores de secrets nunca coletados. Não chamar plano de proteção de configuração aplicada. |
| V02-02 | Usuário/bot tenta delete, force-push ou integração sem checks/política de PR. | Recusa demonstrada em ambiente descartável que reproduz as regras, mais conferência da configuração efetiva no repo alvo; nenhuma tentativa destrutiva contra branches reais. |
| V02-03 | Automação tenta publicar main/produção sem a decisão humana exigida. | Estado fica bloqueado; ator automatizado não tem bypass amplo. Caminho humano é viável com os mantenedores/recursos disponíveis, sem depender de autoaprovação inválida. |
| V02-04 | Fluxos legítimos: PR→dev, dev→staging, versão, main→dev e hotfix autorizado. | Permissões mínimas permitem o fluxo definido em T01; não remover proteção para fazer o bot passar. Simulação e revisão das permissões comprovam compatibilidade. |

## task_03 — Superfícies e privacidade

| Caso | Entrada ou falha provocada | Resultado exigido / método |
|---|---|---|
| V03-01 | Adicionar página/handler/action exportada com nome e formato fora dos padrões antigos. | Descoberta inclui a entrada e falha sem política/exceção nominada; fixture negativa comprova que não depende de `actions.ts` ou lista fixa. |
| V03-02 | Sessão ausente/forjada/expirada ou ID de outro candidato via FormData, JSON e parâmetros. | Nenhuma leitura privada/efeito ocorre antes da negação; spies/DB e HTTP provam ordem e status. |
| V03-03 | Papéis admin/candidate/recruiter, vínculo alheio, cadastro vinculado a candidato existente e impersonação de admin. | Matriz de autorização preservada na composição, com ações administrativas negadas à sessão emprestada. |
| V03-04 | Perfil privado/inexistente/revogado, CV benigno e CV com piso/contatos protegidos, com e sem segundo consentimento; ambiente público com `open`. | HTTP 404 adequado e allowlist; consentimento não libera sentinelas protegidas no texto; versão pública/prévia respeita a regra; modo aberto recusado no ambiente público antes de servir dado. |
| V03-05 | Duas redenções simultâneas do mesmo reset, hash inválido, e-mail desconhecido/erro de envio. | Um único consumo efetivo, sessões antigas revogadas, senha válida apenas no sucesso; respostas não enumeram conta; regressão de hash preservada. |
| V03-06 | Chave fictícia percorre configuração/erro/persistência/log; navegação autenticada toca cache. | Sentinela não chega a DB/log/cache; nome de env é permitido; manter Chromium de PWA e distinguir fixture SW da composição Next. |

## task_04 — Aquisição permitida e preparação sem envio

| Caso | Entrada ou falha provocada | Resultado exigido / método |
|---|---|---|
| V04-01 | URL LinkedIn direta, subdomínio e redirect a ele em cada aquisição relevante. | Transportes de fixture não recebem chamada proibida; não usar requisição real. Texto de alerta por e-mail e URL de referência manual continuam aceitos. |
| V04-02 | Preparar dossiê/kit por entradas suportadas, com transporte externo instrumentado. | Saída é artefato/rascunho; nenhuma candidatura, documento ou mensagem é enviado ao empregador ou ATS. Não introduzir adapter de candidatura como solução. |
| V04-03 | Perfil traz alegação falsa somente em `growth`; anúncio contém termos iguais. | Alegação não vira experiência afirmada; saída só cita evidence e informa lacuna. Revisão de texto livre continua exigida. |
| V04-04 | URL privada, DNS misto, redirect privado, robots restritivo e ambiente de ingestão negado. | Negar no ponto apropriado antes de I/O indevido; preservar testes SSRF, guard e quota; operação JSON/HEAD/HTML mantém contrato específico. |

## task_05 — PostgreSQL e decisões

| Caso | Entrada ou falha provocada | Resultado exigido / método |
|---|---|---|
| V05-01 | Ler/exercitar comandos de skill e playbook em projeto PostgreSQL descartável. | Journal e DDL corretos; nenhum passo SQLite/pragma instrui operação atual; backfill antecede constraint. Exemplos históricos ficam identificados. |
| V05-02 | Fixture populada na versão anterior recebe migration com backfill/constraint. | Upgrade conserva decisões e dados válidos, transforma os previstos e rejeita inconsistências; falha/retomada/estratégia de reversão documentadas. Banco vazio sozinho não basta. |
| V05-03 | FK sem `onDelete` explícito ou DDL com ação diferente. | Primeira falha por intenção ausente, segunda por paridade em `pg_constraint`; FKs válidas continuam passando. |
| V05-04 | Sync/import/mail repetidos; descarte concorre com criação/transição de candidatura; evento falha. | Decisões/eventos preservados; descarte não vence apagando decisão; rollback e concorrência do funil permanecem corretos. |
| V05-05 | Runtime tenta DDL/escalada; migration aponta alvo errado; URL inclui TLS permitido/proibido. | Fixture prova privilégio mínimo e destino/TLS; se houver alteração operacional, registrar role efetiva por metadados sem segredo. Sem observação remota, declarar implantação não comprovada. |

## task_06 — Organização sem perda

| Caso | Entrada ou falha provocada | Resultado exigido / método |
|---|---|---|
| V06-01 | Cruzar G01–G84 com documentos resultantes. | Cada obrigação tem um destino primário e fonte original; nenhuma desaparece ou perde salvaguarda; fusões/ajustes têm justificativa. |
| V06-02 | Abrir entrada em Codex/Claude/OpenCode e resolver os caminhos. | Mesmas regras críticas legíveis sem invocar skill; symlinks preservados; referências por área claras; bloco Next intacto. |
| V06-03 | Revisar C01–C22 e as versões/contagens/estado atuais. | Cada conflito resolvido ou explicitamente marcado como dívida com tarefa; nenhuma fonte antiga continua apresentando regra oposta como vigente. |
| V06-04 | Verificar links, precedência, destinos e diff documental. | Nenhum link quebrado ou norma duplicada por harness; estado em docs, história em ADR/changelog e feature no slug. Validação estrutural, sem produto/E2E para puro Markdown. |

## task_07 — Procedimentos

| Caso | Entrada ou falha provocada | Resultado exigido / método |
|---|---|---|
| V07-01 | Inventariar S01–S14, referências, cinco comandos e fit-analyst. | Todos apontam à política canônica e preservam gatilhos/entradas/saídas relevantes; nenhum SQLite, base errada ou autorização divergente remanescente. |
| V07-02 | Percorrer cenários de envio, triagem, docs-only, nova fonte vazia, revisão não SHIP e QA bloqueado. | Procedimentos respeitam autorização existente, não enviam candidatura, não tratam zero vagas como erro certo e não declaram Pass/SHIP por conveniência. |
| V07-03 | Verificar frontmatter, links e comandos sem executá-los contra produção. | Harnesses descobrem as mesmas skills; exemplos usam RTK onde aplicável; nenhum script executável alterado fica sem teste próprio. |
| V07-04 | Tarefa pequena e tarefa visível seguem os procedimentos. | Checks proporcionais; QA/revisão/auditoria têm saídas distintas; exceção humana não vira permissão automática do agente. |

## task_08 — Browser e QA

| Caso | Entrada ou falha provocada | Resultado exigido / método |
|---|---|---|
| V08-01 | Nova rota, rota dinâmica e página que redireciona ao login durante scan. | Inventário exige fixture/perfil ou exceção; teste não passa olhando login em lugar da tela esperada. |
| V08-02 | Executar lane de CI com DB isolado, build de produção e autenticação real; induzir falha de E2E. | CI chama UI/axe aplicáveis e fica vermelho na falha; preserva PWA browser; não usa secrets/dados de produção. |
| V08-03 | Texto literal sem acento, conteúdo de usuário acentuado, overflow e contraste ruim em tema pertinente. | Detectar violações reais sem tratar dado do usuário como tradução; documentar dimensões/limites do scan e da análise estática complementar. |
| V08-04 | Tracker aponta evidência/relatório inexistente ou resultado anterior ao escopo alterado. | Referência inválida reprova; cenário afetado retorna a untested; nenhuma regra de formato concede Pass de jornada. |
| V08-05 | Jornada visível executada, seguida de refresh/leitura independente; trecho requer pessoa. | Resultado reproduzível conforme QA README, ou Blocked com instrução exata; full só quando o escopo for RC de produção. |

## task_09 — Gates de governança

| Caso | Entrada ou falha provocada | Resultado exigido / método |
|---|---|---|
| V09-01 | Symlink trocado por cópia, destino quebrado ou instrução duplicada por harness. | Gate estrutural detecta regressão; ponteiros legítimos e referências cruzadas passam. |
| V09-02 | Link/ID de regra/exceção inexistente; referência histórica rotulada. | Erro acionável para referência inválida; histórico legítimo não é apagado para silenciar o gate. |
| V09-03 | PR de trabalho, promoção nova/reutilizada e retorno sem assignee; base inadequada. | Todos os criadores atribuem responsável e validam base/metadata conforme tipo; fixture da API prova caminhos e permissões, sem criar PR de teste real por acidente. |
| V09-04 | Revisão pertence a diff/SHA antigo; FIX_BEFORE_SHIP sem decisão válida; falta impacto docs/QA. | Não apresentar revisão antiga como aprovação atual; declaração ausente falha; exceção legítima tem responsável/escopo/razão. Gate não afirma ter julgado verdade de texto livre. |
| V09-05 | Diff só Markdown/metadados versus script, workflow ou runtime. | Seleção proporcional exige estrutura no primeiro e verificações pertinentes no segundo; usa validadores existentes de release/QA sem duplicá-los. |

## task_10 — Fitness complementar

| Caso | Entrada ou falha provocada | Resultado exigido / método |
|---|---|---|
| V10-01 | Mudança semântica de scorer/perfil sem bump; conteúdo de vaga muda; apenas applyUrl muda. | Gate detecta versão faltante; invalidação por conteúdo e preservação de metadado são comprovadas; rescore em fixture, nunca produção automática. |
| V10-02 | Domínio importa rede/DB/relógio por alias/reexport ou usa default `Date.now()`; import relativo usa outra sintaxe. | Descoberta não depende de aspas/sufixo antigo; mesmo `asOf` produz mesmo score sob relógios ambientes diferentes; compatibilidade fica na composição. Não criar porta sem variação real. |
| V10-03 | Componente usa hex curto/rgb/token bruto/tamanho fora da escala, enquanto tema define paleta. | Regra distingue uso proibido de definição legítima; regressões de contraste/CodeMirror/mobile preservadas. |
| V10-04 | Adapter recebe alias vazio/board vazio/falha isolada; YAML inválido; re-seed após progresso. | Contratos preservam valor válido, board/histórico e status; entrada inválida falha legivelmente; localizar e reutilizar teste existente quando suficiente. |
| V10-05 | Nova composição de página excede pool menos uma consulta ou repete câmbio. | Inventário/medição alcança nova composição; falha por pico/duplicação e aceita versão corrigida; teste não se vende como benchmark de carga. |

## task_11 — Encerramento

| Caso | Entrada ou falha provocada | Resultado exigido / método |
|---|---|---|
| V11-01 | Confrontar matriz com diff final e evidências da execução. | Toda alteração e obrigação têm estado verdadeiro; não chamar teste lido de teste passado nem plano remoto de proteção aplicada. |
| V11-02 | Executar checks e E2E/QA pertinentes ao diff final no runtime suportado. | Registrar resultados atuais, CI e falhas remanescentes; não repetir suites sem causa nem substituí-las por cobertura percentual. |
| V11-03 | Reconsultar proteções/configuração operacional que tenha sido alterada. | Evidência datada sem segredo; diferenças pendentes são explícitas; nenhuma tentativa destrutiva/produção para provar o teste. |
| V11-04 | Preparar entrega para dev com docs/changelogs, revisão e responsável. | Deslop e deep-review conforme escopo, PR atribuída se autorizada, pendências de validação humana visíveis; nenhuma publicação automática em main. |

## Regressões que devem ser preservadas

O pacote não pede reescrever toda a suíte. Manter especialmente as provas comportamentais descritas em E04–E10, E12–E17, E20–E24, E30–E34. Criar caso novo somente quando revelar uma falha não observada pelo recorte existente; uma asserção que espelha a implementação sem poder acusar a violação não satisfaz este contrato.
