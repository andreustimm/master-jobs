# Regras canônicas por domínio

[AGENTS.md](../../../AGENTS.md) é a entrada comum dos três harnesses (Claude
Code lê pelo symlink `CLAUDE.md`). Ela traz as invariantes críticas por escrito
e o roteador; os seis arquivos abaixo trazem o detalhe normativo — obrigação,
escopo, exceções, origem e prova. Procedimento (como executar) fica nas skills
em `.claude/skills/` e no [roteiro de trabalho](../workflow.md); estado atual do
produto fica em `docs/`; razão das decisões, em `docs/adr/`.

| Domínio | Arquivo | O que cobre |
|---|---|---|
| Segurança, privacidade e ação externa | [security.md](security.md) | LinkedIn, evidência, não envio, autenticação e escopo, perfil público, cache, credenciais, rede, ambientes |
| Arquitetura e runtime | [architecture.md](architecture.md) | Portas, domínio puro, TypeScript apagável, UI como adaptador, idempotência, pool |
| Dados, ingestão e sourcing | [data-and-sourcing.md](data-and-sourcing.md) | Decisões do usuário, fechamento e retenção, FKs, PostgreSQL, TLS, fontes, cota |
| Matching e score | [matching-and-evidence.md](matching-and-evidence.md) | Versão do scorer, dado ausente neutro, rubrica determinística |
| Interface | [frontend.md](frontend.md) | Dicionário i18n, tokens e temas, escala, celular, URL como estado |
| Entrega e harnesses | [delivery.md](delivery.md) | Project/issue, branches e promoção, revisão, QA, docs e changelogs, skills, RTK |

## Precedência e conflito

1. As regras deste diretório e da entrada comum prevalecem sobre exemplos
   genéricos de skills, comandos e documentos de feature.
2. Entre a entrada e um arquivo de domínio, eles não podem divergir: a entrada
   resume, o domínio detalha. Divergência é defeito a corrigir na mesma PR.
3. Encontrou regra oposta em outro lugar? **Não enfraqueça a proteção para
   seguir o exemplo mais fraco.** Registre a discrepância com evidência (arquivo,
   linha, teste) e corrija a fonte responsável — ou abra issue quando a
   correção exigir código.
4. Mudar uma regra é mudar este diretório **e** a linha da entrada, no mesmo
   commit, preservando a razão. Remover obrigação exige decisão explícita do
   dono, registrada na PR (e em ADR quando restringe o futuro).
5. Estado, prioridade e dependências das tarefas não moram aqui: vêm da issue e
   do Project 3 ([delivery.md](delivery.md#r24)).

## Inventário de equivalência

A reorganização de [#200](https://github.com/andreustimm/master-jobs/issues/200)
partiu da [matriz da auditoria](../../../.compozy/tasks/governanca-regras/_audit.md)
(G01–G84) e do texto de `AGENTS.md` em `origin/dev` no dia da migração.
Cada obrigação tem **um** destino primário; referências cruzadas não criam uma
segunda definição. "Regra N" é a numeração mantida na entrada comum.

| ID | Obrigação | Destino | Origem | Situação |
|---|---|---|---|---|
| G01 | Nunca adquirir dados do LinkedIn | [security](security.md#g01) | regra 1 | preservada; limites de runtime explicitados |
| G02 | Ingestão nunca escreve em `application` | [data](data-and-sourcing.md#g02) | regra 2 | preservada |
| G03 | Vaga que some é fechada, não deletada | [data](data-and-sourcing.md#g03) | regra 3 | preservada; exceção de retenção nomeada (C04) |
| G04 | Variação real entra por porta | [architecture](architecture.md#g04) | regra 4 | preservada |
| G05 | Domínio puro; adapter burro | [architecture](architecture.md#g05) | regra 4 | preservada; tempo explícito no núcleo (C22) |
| G06 | Só TypeScript apagável | [architecture](architecture.md#g06) | regra 5 | preservada; versão aponta para `package.json` |
| G07 | Import relativo com `.ts` | [architecture](architecture.md#g07) | regra 5 | preservada |
| G08 | Bump de `SCORER_VERSION` e rescore | [matching](matching-and-evidence.md#g08) | regra 6 | preservada; número copiado removido (C09) |
| G09 | Não inventar evidência | [security](security.md#g09) | regra 7 | preservada |
| G10 | Dado faltante pontua neutro | [matching](matching-and-evidence.md#g10) | regra 8 | preservada; limite para dado negativo explícito |
| G11 | Score é rubrica, não similaridade | [matching](matching-and-evidence.md#g11) | invariante do score | preservada |
| G12 | Apelido decide pelo valor | [data](data-and-sourcing.md#g12) | invariante de apelidos | preservada |
| G13 | Reservar slot antes do `await` | [data](data-and-sourcing.md#g13) | invariante de concorrência | preservada |
| G14 | Service worker sem nada autenticado | [security](security.md#g14) | invariante do SW | preservada |
| G15 | Feature no slug; durável em `docs/` | [delivery](delivery.md#g15) | invariante ADR 0011 | preservada |
| G16 | Política precisa funcionar na composição | [security](security.md#g16) | invariante "Política correta" | preservada |
| G17 | Recuperação não revela cadastro | [security](security.md#g17) | invariante de recuperação | preservada |
| G18 | Token de reset e sessões | [security](security.md#g18) | invariante de recuperação | preservada, com `withheldMailer` |
| G19 | Hash corrompido nega | [security](security.md#g19) | invariante de hash | preservada |
| G20 | FK declara `ON DELETE` | [data](data-and-sourcing.md#g20) | invariante de FKs | preservada; intenção além de paridade (C05) |
| G21 | `/p/` mostra só lista de permissão | [security](security.md#g21) | invariante `/p/` | preservada; "única rota sem sessão" reescrita (C02) |
| G22 | Perfil não público: 404 | [security](security.md#g22) | invariante `/p/` | preservada |
| G23 | CV público: segundo consentimento e filtro | [security](security.md#g23) | invariante `/p/` | preservada; limite do filtro declarado |
| G24 | Admin assume identidade | [security](security.md#g24) | invariante de admin | preservada |
| G25 | Sem acesso por procuração | [security](security.md#g25) | invariante de admin | preservada |
| G26 | Só 404/410 fecham vaga | [data](data-and-sourcing.md#g26) | invariante de probe | preservada |
| G27 | Guarda recusa quem pede menos | [data](data-and-sourcing.md#g27) | invariante de TLS | preservada (C07 já resolvido em `deploy.md`) |
| G28 | Sensitive não é legível | [data](data-and-sourcing.md#g28) | invariante de provedor | preservada |
| G29 | Texto de UI do dicionário | [frontend](frontend.md#g29) | regra 9 | preservada |
| G30 | Rota nova na varredura de idioma | [frontend](frontend.md#g30) | regra 9 | preservada; contagem copiada removida (C13) |
| G31 | Controle por `data-testid` | [frontend](frontend.md#g31) | regra 9 | preservada |
| G32 | Só token semântico em componente | [frontend](frontend.md#g32) | regra 10 + invariante de token | preservada; contradição removida (C08) |
| G33 | Escala fechada; sem `xs`…`xl` | [frontend](frontend.md#g33) | regra 10 | preservada |
| G34 | Três temas; tema novo não toca componente | [frontend](frontend.md#g34) | regra 10 | preservada |
| G35 | Toda tela no celular | [frontend](frontend.md#g35) | regra 11 | preservada |
| G36 | Bind local em `127.0.0.1` | [security](security.md#g36) | regra 12 | preservada; justificativa atualizada (C01) |
| G37 | Nada envia candidatura | [security](security.md#g37) | regra 13 | preservada |
| G38 | Autenticação por omissão | [security](security.md#g38) | regra 14 | preservada |
| G39 | Guarda antes de dado ou efeito | [security](security.md#g39) | regra 15 | preservada; classes de superfície (C02, C03) |
| G40 | `can()` e escopo da sessão | [security](security.md#g40) | regra 15 | preservada |
| G41 | Chave de API fora do banco | [security](security.md#g41) | regra 16 | preservada |
| G42 | `??` não protege contra `""` | [data](data-and-sourcing.md#g42) | regra 17 | preservada |
| G43 | Worktree de `dev`, PR para `dev` | [delivery](delivery.md#g43) | regra 18 | preservada; exceções de automação nomeadas (C21) |
| G44 | Conferir estado e preservar WIP | [delivery](delivery.md#g44) | "Fluxo de trabalho" | preservada |
| G45 | `dev`→`staging` por SHA validado | [delivery](delivery.md#g45) | "Fluxo de trabalho" | preservada; contrato de SHA (C20) |
| G46 | Produção não sai sem gente | [delivery](delivery.md#g46) | "Fluxo de trabalho" | preservada; proteção remota em `main`, parcial em `dev`/`staging` (C19) |
| G47 | Toda PR com responsável | [delivery](delivery.md#g47) | "Fluxo de trabalho" | preservada |
| G48 | Branches permanentes | [delivery](delivery.md#g48) | "Fluxo de trabalho" | preservada |
| G49 | Branch `<tipo>/<slug>` | [delivery](delivery.md#g49) | "Fluxo de trabalho" | preservada |
| G50 | Limpar branch mesclada | [delivery](delivery.md#g50) | "Fluxo de trabalho" | preservada |
| G51 | Migração suspende promoção | [delivery](delivery.md#g51) | "Fluxo de trabalho" | preservada |
| G52 | Retorno `main`→`dev` | [delivery](delivery.md#g52) | "Fluxo de trabalho" | preservada |
| G53 | Deep-review antes da PR | [delivery](delivery.md#g53) | regra 19 + "Revisão profunda" | preservada; revisão vale para o diff atual |
| G54 | FIX_BEFORE_SHIP não é aprovação | [delivery](delivery.md#g54) | regra 19 | reformulada sem enfraquecer (C11) |
| G55 | QA vivo para mudança visível | [delivery](delivery.md#g55) | regra 20 + "QA de jornada" | preservada |
| G56 | Cadência única; `Pass` com prova | [delivery](delivery.md#g56) | "QA de jornada" | preservada |
| G57 | Validação proporcional | [delivery](delivery.md#g57) | regra 20 | preservada; extensão não decide sozinha |
| G58 | Nota releaseável em fragmento de changelog | [delivery](delivery.md#g58) | regra 21 | preservada; formato de fragmento (#263) substitui a edição do `Unreleased` |
| G59 | Tag SemVer tem GitHub Release | [delivery](delivery.md#g59) | regra 22 | preservada |
| G60 | Changelog vs `docs/` | [delivery](delivery.md#g60) | regra 23 | preservada; linha para `docs/engineering/rules/` |
| G61 | Skills canônicas e symlinks | [delivery](delivery.md#g61) | "Skills compartilhadas" | preservada |
| G62 | Instruções lidas; skill não é regra | [delivery](delivery.md#g62) | "Skills compartilhadas" | preservada; roteador na entrada |
| G63 | RTK por harness | [delivery](delivery.md#g63) | nota final do AGENTS | preservada, sem copiar o arquivo global |
| G64 | Bloco do Next intacto | [delivery](delivery.md#g64) | bloco gerado | preservada; bloco continua no fim da entrada |
| G65 | UI é adaptador | [architecture](architecture.md#g65) | "Arquitetura" | preservada; "única mutação" corrigida (C15) |
| G66 | Idempotência e isolamento de falha | [architecture](architecture.md#g66) | "Convenções de código" | preservada |
| G67 | Zod no que é editado à mão | [architecture](architecture.md#g67) | "Convenções de código" | preservada |
| G68 | PostgreSQL no runtime; SQLite legado | [data](data-and-sourcing.md#g68) | "Convenções de código" | preservada |
| G69 | Filtro na URL; ilhas cliente | [frontend](frontend.md#g69) | "Convenções de código" | preservada; "sem JS de cliente" corrigido (C10) |
| G70 | Fonte nova validada na API real | [data](data-and-sourcing.md#g70) | "Ao adicionar uma fonte" | preservada; board vazio (C17) |
| G71 | Empregador nomeado vale mais | [data](data-and-sourcing.md#g71) | invariante de fonte | preservada |
| G72 | Harness adapta, não redefine | [delivery](delivery.md#g72) | `.codex/config.toml` | preservada; comentário corrigido (C12) |
| G73 | Rede controlada por finalidade | [security](security.md#g73) | `sources.md` | preservada (C16 já resolvido em `sources.md`) |
| G74 | Cota por plataforma | [data](data-and-sourcing.md#g74) | `sources.md` | preservada |
| G75 | Evento append-only, transação única | [data](data-and-sourcing.md#g75) | `data-model.md` | preservada (C14) |
| G76 | Retenção protege decisões | [data](data-and-sourcing.md#g76) | `data-model.md` | preservada |
| G77 | `fingerprint` × `content_hash` | [data](data-and-sourcing.md#g77) | `data-model.md` | preservada; invalidação por conteúdo corrigida (C09) |
| G78 | Fan-out dentro do pool | [architecture](architecture.md#g78) | `operations.md` | preservada |
| G79 | Ingestão só no ambiente autorizado | [security](security.md#g79) | `deploy.md` | preservada |
| G80 | Privilégio mínimo | [security](security.md#g80) | `deploy.md` | preservada; estado de produção só em `deploy.md` |
| G81 | Re-seed não reseta progresso | [data](data-and-sourcing.md#g81) | `architecture.md` | preservada |
| G82 | Comentário explica por quê | [architecture](architecture.md#g82) | "Convenções de código" | preservada |
| G83 | Estado e contagens fora das instruções | [delivery](delivery.md#g83) | "Estado atual", "Comandos" | preservada; inventário movido para `docs/cli.md` |
| G84 | Revisão relata; auditoria e QA distintos | [delivery](delivery.md#g84) | "Revisão profunda" | preservada |

**Obrigações posteriores à auditoria**, sem ID `G`, preservadas no mesmo
destino: [R24 — issue e Project 3](delivery.md#r24) e
[`Closes #N` na mensagem do commit](delivery.md#r24-closes).

**Para onde foi o resto do texto antigo da entrada**, que não era regra:
inventário de comandos → [cli.md](../../cli.md) ("Referência rápida"); árvore
de diretórios → [architecture.md](../../architecture.md) ("Mapa rápido dos
diretórios"); tabela "Estado atual" e contagens → não copiadas (fonte viva:
`jho stats`; fotografia datada em [vision.md](../../product/vision.md));
ambientes → [deploy.md](../deploy.md) ("Os três ambientes"); estado da conexão
de produção → [deploy.md](../deploy.md) ("Configuração verificada").

## Conflitos da auditoria (C01–C22)

Situação na migração. "Resolvido" significa que a fonte vigente já não
apresenta a regra oposta; "dívida" significa regra mantida e implementação
pendente na issue indicada.

| ID | Tema | Situação |
|---|---|---|
| C01 | Produto "só local, sem auth" | Resolvido: G36 e [security.md](../../security.md) descrevem auth por omissão e implantação hospedada |
| C02 | "`/p` é a única rota sem sessão" | Resolvido: classes de superfície em G39; `/p/` é a única de conteúdo |
| C03 | Exceções de guarda | Resolvido por #197; lista em G39 |
| C04 | "Nunca deletar vaga" × retenção | Resolvido: exceção nomeada em G03 |
| C05 | FK explícita × default | Resolvido por #199; G20 |
| C06 | Skill de migration em SQLite | Resolvido por #199 no `SKILL.md`; resíduos revistos em [#201](https://github.com/andreustimm/master-jobs/issues/201) |
| C07 | `sslmode` recusado em `deploy.md` | Resolvido por #199; G27 |
| C08 | Token bruto × semântico | Resolvido: G32; `tests/design.test.ts` (V10-03, #204) reprova paleta crua fora das exceções nomeadas |
| C09 | Versão copiada; invalidação por conteúdo | Resolvido: G08 sem número, G77 e `data-model.md` corrigidos |
| C10 | "Sem JS de cliente" | Resolvido: G69 |
| C11 | FIX_BEFORE_SHIP × `ship-pr` | Regra resolvida em G54; skills alinhadas em [#201](https://github.com/andreustimm/master-jobs/issues/201) |
| C12 | "Editar ambos" AGENTS/CLAUDE | Resolvido: G72, `.codex/config.toml` e documentos que diziam "espelho" |
| C13 | Contagens de rotas/cobertura copiadas | Resolvido na entrada e em G30; demais documentos em [#202](https://github.com/andreustimm/master-jobs/issues/202) |
| C14 | `application_event` "nunca deletada" | Resolvido por #199; G75 |
| C15 | "Única mutação" da UI | Resolvido: G65, `architecture.md` e `data-model.md` |
| C16 | "Toda rede por `getJson`" | Resolvido por #198; G73 |
| C17 | Zero vagas = handle errado | Regra resolvida em G70; comando `fonte-nova` em [#201](https://github.com/andreustimm/master-jobs/issues/201) |
| C18 | Triagem × confirmação no funil | Procedimento em [#201](https://github.com/andreustimm/master-jobs/issues/201); G02 continua negando escrita à ingestão |
| C19 | Produção humana sem proteção remota | Resolvido em `main` por #196 (rulesets aplicados em 22/09/2026); `dev`/`staging` só recusam exclusão e force-push no remoto — ver G46 e [github-protections.md](../github-protections.md) |
| C20 | CI de `dev` × ref posterior | Resolvido por #195; G45 |
| C21 | Commit direto × bots e hotfix | Resolvido: exceções nomeadas em G43 |
| C22 | `Date.now()` implícito no domínio | Resolvido por #204: instante obrigatório no scorer; G05 |
