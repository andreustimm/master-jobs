# Validação desta auditoria documental

Este documento registra a auditoria e o planejamento realizados em 22/09/2026, seguidos da preparação para publicação autorizada pelo usuário. Os 51 casos de [_tests.md](_tests.md) são critérios de **implementação futura**, todos ainda não executados. Os testes do produto mencionados na matriz foram lidos para qualificar sua cobertura; não receberam status verde por essa leitura.

## Operações realizadas

| Verificação | Resultado observado |
|---|---|
| `rtk git status --short --branch`, antes de editar | Saída 0; `## HEAD (no branch)`; worktree limpa. |
| `rtk pnpm worktrees` | Saída 0; worktree atual coincide com `origin/dev` local; WIP de nove arquivos em `perf/filtro-salarial` preservado. Aviso de engine: local v24.14.0 versus requisito ^24.19.0. |
| `rtk proxy git log -1 --format='%H%n%D%n%s' HEAD dev origin/dev` | SHA `463688f3704fdd2187732edba798acd1d81a1070`; refs locais coincidentes. Não houve fetch nem mudança de branch. |
| `rtk proxy git config --get core.hooksPath` | `.githooks`; prova deste clone, não proteção remota. |
| Leitura via `rtk proxy cat`, `sed` e `rg`, mais inspeção de symlinks | AGENTS, configs, 14 skills, comandos, docs, workflows, hooks e corpos de testes usados no catálogo. Caminhos inexistentes foram registrados como ausência, não como conteúdo lido. |
| `rtk gh api repos/andreustimm/master-jobs/rulesets` com projeção de campos | Sucesso; zero rulesets. |
| GET via `rtk gh api` para proteção de `main`, `dev`, `staging` | Cada consulta retornou HTTP 404 com `Branch not protected`. Saída do CLI não zero é o resultado da consulta, não falha silenciosamente ignorada. |
| GET via `rtk gh api` para `environments/production`, com projeção de campos | Sucesso; `Production`, `protection_rules: []`, `deployment_branch_policy: null`. |

As consultas remotas inicialmente não conectaram sob a restrição de rede; foram repetidas com permissão de rede aprovada para **GET**. Não houve rejeição de aprovação, mutação remota ou leitura de valor de secret. A fotografia remota foi registrada às **13:56:57 UTC / 10:56:57 America/Sao_Paulo**.

Não existiam `.compozy/README.md`, `.compozy/tasks/README.md`, `.coderabbit.yaml` ou `.deep-review.yaml` nos caminhos consultados. O formato do grafo foi baseado no exemplo vigente `environment-sample-only`, sem presumir um esquema formal adicional inexistente. Buscas iniciais por `term-quota.test.ts`/`term-capture.test.ts` retornaram arquivo inexistente; a prova de cota foi localizada e lida em `platform-quota.test.ts`.

## Validação estrutural do pacote

A checagem desta entrega deve confirmar:

- Todos os links locais apontam para arquivos/diretórios existentes; âncoras de linha cabem no arquivo de origem.
- Existem exatamente 84 IDs de regra únicos, 34 evidências, 14 skills e 22 conflitos inventariados.
- Todas as 84 obrigações possuem exatamente um destino primário proposto.
- Os 11 arquivos de tarefa estão `pending`, com caixas de implementação desmarcadas.
- O grafo tem todos os arquivos, dependências coerentes e nenhum ciclo.
- Os 51 casos de aceitação existem, pertencem a uma única tarefa e estão referenciados por ela.
- O diff não modifica arquivo existente fora deste slug; os symlinks originais permanecem intactos.

O validador em Python 3/PyYAML 6.0.3, executado por stdin com `rtk proxy python3 -B -`, terminou com **saída 0 e zero erros**. A leitura final acrescentou evidência de relógio implícito no scorer e precisou a diferença entre a asserção do CV e sua implementação; a checagem completa foi repetida após esses ajustes.

Resultado final da etapa original: **20 documentos, 368 links locais, 84 regras/destinos, 34 evidências, 14 skills, 22 conflitos, 11 tarefas, 15 dependências e 51 casos planejados**. Todos os casos têm exatamente um dono, o grafo é acíclico e todas as tarefas seguem pendentes. O validador também conferiu colunas das tabelas Markdown, whitespace, newline final, tarefa de destino de cada regra e os cinco symlinks compartilhados.

`rtk proxy git diff --name-only` não retornou arquivos rastreados alterados; a inspeção de arquivos não rastreados encontrou somente os 20 Markdown deste slug. `rtk git diff --check` terminou com saída 0; como arquivos novos ainda não estão no índice, a checagem de whitespace deles foi feita também pelo validador.

A primeira tentativa de usar o parser `yaml` pelo Node falhou com `ERR_MODULE_NOT_FOUND`, antes de validar o pacote. Nenhuma dependência foi instalada: a verificação foi repetida com o PyYAML já disponível. Esse resultado estrutural não certifica execução por um daemon Compozy nem os 51 comportamentos futuros.

## Não executado na etapa original e motivo

- `pnpm check`, Vitest, build, `test:e2e`, axe e QA de produto: não houve alteração de runtime; a regra de proporcionalidade documental exige estrutura/links. Além disso, o Node local não atende ao engine exigido para esses checks.
- `check:qa-tracker`: não foi necessário materializar `docs/qa/state.csv` fora do escopo autorizado.
- Deep-review de código, deslop operacional, auditoria de implementação e ship-pr: não houve implementação pronta nem PR solicitada; este pacote é o plano, não certificação das tarefas futuras.
- Fetch, sync, rescore, migrations, envio, LinkedIn, mudanças de GitHub/Vercel, commit, PR, merge ou deploy: fora do escopo desta auditoria.

Os resultados remotos têm validade temporal; as tarefas de implementação precisam reconsultá-los. A inspeção não certifica a role real do banco de produção nem todo controle externo à configuração consultada.

## Preparação da publicação — 22/09/2026

O usuário autorizou depois o commit, a PR do plano e o encaminhamento das melhorias. Essa autorização amplia a etapa seguinte sem transformar as verificações futuras em trabalho já realizado.

- Branch criada nesta worktree: `docs/auditoria-governanca-regras`.
- `rtk git fetch origin --prune` e `rtk git merge --ff-only origin/dev` concluídos; base da publicação: `5ddc1ecdf5bea610670bb44476b28aed6394fca7`. A baseline histórica da auditoria continua identificada no início do pacote.
- Identidade Git conferida; `rtk gh api user --jq .login` retornou `andreustimm`, responsável a atribuir à PR.
- Análise de impacto da skill `ship-pr` não encontrou contrato de produto modificado. A PR deve declarar: sem mudança visível e sem atualização de `docs/`, pois o diff só registra auditoria e plano de implementação.
- Revisão de portabilidade substituiu o link para arquivo pessoal RTK por referência ao ponto de entrada versionado, preservando a identificação da origem global.
- O validador estrutural foi repetido na base atualizada: 20 documentos, 368 links, zero erros. O comando `rtk proxy env PATH="/Users/andreus/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm check:release-ready` passou, com `release-ready version=1.20.6`.
- Há outra worktree `docs/governanca-regras` com auditoria paralela em andamento. Seu conteúdo foi preservado; este pacote não a remove nem incorpora seu WIP implicitamente.

O veredito da revisão profunda e o resultado da publicação pertencem ao relatório de revisão e à PR correspondente; não são antecipados neste registro. Os testes gerais do produto continuam fora da validação local proporcional desta PR documental; o CI existente executa seus próprios jobs em toda PR.

O cadastro posterior criou o épico [#194](https://github.com/andreustimm/master-jobs/issues/194) e as 11 issues [#195–205](https://github.com/andreustimm/master-jobs/issues/194), com responsável atribuído. O pacote agora aponta para essas identidades; status e dependências operacionais pertencem ao GitHub. A validação estrutural após esse ajuste conferiu **369 links locais**, com os demais totais preservados. Isso não representa execução dos 51 critérios futuros.

## Reproduzir a validação documental

Na raiz do repositório, com Python 3 e PyYAML disponíveis, execute o bloco abaixo. Ele verifica os documentos da fotografia publicada, inclusive os campos históricos `pending`; não consulta nem atualiza o estado operacional do GitHub. A inspeção do diff e de arquivos não rastreados, registrada acima, foi uma verificação separada de isolamento da worktree na publicação.

```bash
rtk proxy python3 -B - <<'PY'
from pathlib import Path
import re, json, yaml
root=Path.cwd(); base=root/'.compozy/tasks/governanca-regras'
docs={p.name:p.read_text() for p in sorted(base.glob('*.md'))}; errors=[]
def check(ok,msg):
    if not ok: errors.append(msg)
links=0
for name,body in docs.items():
    columns=None
    for line in body.splitlines():
        if line.startswith('|'):
            size=len(re.split(r'(?<!\\)\|',line))
            if columns is None: columns=size
            check(size==columns,f'{name}: colunas inconsistentes: {line[:50]}')
        else: columns=None
    for target in re.findall(r'\[[^\]\n]*\]\(([^)\n]+)\)',body):
        target=target.strip('<>')
        if re.match(r'^[a-z][a-z0-9+.-]*:',target,re.I) or target.startswith('#'): continue
        links+=1; filename,_,fragment=target.partition('#'); resolved=(base/filename).resolve()
        check(resolved.exists(),f'{name}: link inexistente {target}')
        if resolved.is_file() and re.fullmatch(r'L\d+',fragment): check(1<=int(fragment[1:])<=len(resolved.read_text().splitlines()),f'{name}: linha inválida {target}')
    check(not re.search(r'[ \t]+$',body,re.M),f'{name}: whitespace final')
    check(body.endswith('\n'),f'{name}: falta newline final')
def ids(file,prefix): return re.findall(r'^\| ('+prefix+r'\d{2}(?:-\d{2})?) \|',docs[file],re.M)
rules=ids('_audit.md','G'); skills=ids('_audit.md','S'); conflicts=ids('_techspec.md','C'); cases=ids('_tests.md','V'); evidence=re.findall(r'^## (E\d{2}) — ',docs['_evidence.md'],re.M)
for label,values,expected in [('regras',rules,84),('skills',skills,14),('conflitos',conflicts,22),('evidências',evidence,34),('casos',cases,51)]:
    check(len(values)==expected,f'{label}: esperado {expected}, recebido {len(values)}'); check(len(set(values))==len(values),f'{label}: ID duplicado')
section=docs['_techspec.md'].split('## 3.')[1].split('## 4.')[0]; mapped=[]
for line in section.splitlines():
    if line.startswith('| `docs/engineering/rules/'): mapped.extend(re.findall(r'G\d{2}',line.split('|')[2]))
check(len(mapped)==84 and len(set(mapped))==84 and set(mapped)==set(rules),'destino primário ausente/duplicado')
def fm(name):
    m=re.match(r'^---\n([\s\S]*?)\n---',docs[name]); check(bool(m),f'{name}: sem frontmatter'); return yaml.safe_load(m.group(1)) if m else {}
graph=fm('_tasks.md'); check(graph.get('schema_version')=='compozy.tasks/v2','schema_version incorreto')
nodes=graph['graph']['nodes']; edges=graph['graph']['edges']; task_ids=[n['id'] for n in nodes]
check(len(nodes)==11 and len(set(task_ids))==11,'nós inválidos'); check(len({(e['from'],e['to']) for e in edges})==len(edges),'aresta duplicada')
case_owners={c:[] for c in cases}
for edge in edges: check(edge['from'] in task_ids and edge['to'] in task_ids,f'aresta desconhecida {edge}')
for node in nodes:
    name=node['file']; check(name in docs,f'arquivo ausente {name}'); task=fm(name)
    check(task.get('status')=='pending',f'{name}: status não pending'); check(task.get('priority') in ['P0','P1','P2'],f'{name}: prioridade inválida'); check(not re.search(r'- \[[xX]\]',docs[name]),f'{name}: caixa marcada')
    required=sorted(e['from'] for e in edges if e['to']==node['id']); check(sorted(task.get('dependencies',[]))==required,f'{name}: dependências divergentes')
    refs=set(re.findall(r'V\d{2}-\d{2}',docs[name])); check(bool(refs),f'{name}: sem validação')
    for case in refs:
        check(case in case_owners,f'{name}: caso desconhecido {case}')
        if case in case_owners: case_owners[case].append(node['id'])
    for heading in ['## Escopo','## Subtarefas','## Entregáveis','## Critérios de aceitação','## Validação']: check(heading in docs[name],f'{name}: falta {heading}')
visiting=set(); seen=set()
def visit(task):
    if task in visiting: errors.append(f'ciclo: {task}'); return
    if task in seen: return
    visiting.add(task)
    for edge in edges:
        if edge['from']==task: visit(edge['to'])
    visiting.remove(task); seen.add(task)
for task in task_ids: visit(task)
for case,owners in case_owners.items(): check(owners==['task_'+case[1:3]],f'{case}: donos inválidos {owners}')
for line in docs['_audit.md'].splitlines():
    if re.match(r'^\| G\d{2} \|',line):
        check(bool(re.search(r'T\d{2}',line)),f'regra sem tarefa: {line[:8]}')
        for number in re.findall(r'T(\d{2})',line): check('task_'+number in task_ids,f'tarefa desconhecida {number}')
for file,target in {'CLAUDE.md':'AGENTS.md','.codex/skills':'../.claude/skills','.opencode/skills':'../.claude/skills','.opencode/agents':'../.claude/agents','.opencode/commands':'../.claude/commands'}.items():
    p=root/file; check(p.is_symlink() and str(p.readlink())==target,f'symlink divergente {file}')
print(json.dumps({'documents':len(docs),'linksChecked':links,'rules':len(rules),'evidence':len(evidence),'skills':len(skills),'conflicts':len(conflicts),'tasks':len(nodes),'edges':len(edges),'plannedValidationCases':len(cases),'canonicalDestinations':len(mapped),'errors':errors},ensure_ascii=False,indent=2))
raise SystemExit(1 if errors else 0)
PY
```
