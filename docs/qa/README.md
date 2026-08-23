# QA vivo do master-jobs

Esta é a árvore única e versionada de QA orientado a jornadas. `qa-report`
mantém personas, fluxos, cenários, charters e bugs; `qa-execution` percorre o
produto como uma pessoa real e grava vereditos e relatórios aqui.

## Entrada e execução

- Dashboard local: `http://127.0.0.1:3000`
- Login: `http://127.0.0.1:3000/login`
- Perfil público: `http://127.0.0.1:3000/p/<slug>`
- CLI pública: `rtk pnpm jho <comando>`
- Servidor de desenvolvimento: `rtk pnpm dev`
- Build com paridade local: `rtk pnpm build` e `rtk pnpm start`
- Driver de jornada: `rtk pnpm exec agent-browser <comando>`
- Instalação inicial do Chrome do driver: `rtk pnpm qa:browser:install`
- Gates automatizados: `rtk pnpm check` e `rtk pnpm test:e2e`

O dashboard sempre usa loopback. Sessões autenticadas usam contas e papéis de
teste reais; não use mocks para confirmar uma jornada.

Crie contas de QA com `rtk pnpm jho auth add-user <email> --role <papéis>` e
defina a senha com `rtk pnpm jho auth set-password <email>`. O mapeamento
persona→conta e as credenciais ficam em armazenamento privado, nunca em
`docs/qa/` nem no Git.

## Áreas

| Código | Área |
|---|---|
| `AUTH` | Login, sessão, recuperação e autorização |
| `JOBS` | Descoberta, filtros, detalhe e explicação de vagas |
| `PIPE` | Shortlist, candidatura e histórico do funil |
| `PROF` | Perfil do candidato e currículo |
| `SKIL` | Vocabulário e catálogo de skills |
| `MAIL` | Correspondência e sugestões de e-mail |
| `ADMN` | Administração, usuários e impersonação |
| `PUB` | Perfil público e consentimentos |
| `CLI` | Jornadas executadas pelo terminal |

Todo cenário novo usa `<AREA>-<slug>` e uma área desta lista. Adicione a área
aqui antes de criar o primeiro cenário dela.

## Cadência no fluxo

- **Targeted:** toda branch/PR com mudança percebida pelo usuário; jornadas
  tocadas mais uma canária adjacente.
- **Sanity:** depois de hotfix; jornada corrigida mais uma adjacente.
- **Smoke:** depois de deploy; 2–4 jornadas de maior valor.
- **Full:** release candidate antes da PR humana `staging → main`; todas as
  jornadas P0/P1 e todas as personas do projeto.

Cada jornada registra `priority: P0 | P1 | P2` no seu YAML durável. `P0` cobre
caminhos críticos de release, segurança, privacidade e integridade dos dados;
`P1` cobre caminhos centrais, frequentes, de recuperação ou comercialmente
importantes; `P2` cobre comportamento de apoio. A prioridade armazenada, e não
uma escolha ad hoc da sessão, define o conjunto P0/P1 do Full QA.

Formato canônico de `journeys/J-<slug>.md`:

```yaml
journey:
  id: J-<slug>
  name: <verbo e objetivo>
  priority: P0 | P1 | P2
  value_statement: <valor observável para a pessoa>
```

O restante do mapa preserva personas, entradas, ações, objetivo, estado final,
saída, abandono e integrações conforme o contrato de `qa-report`. A prioridade
é obrigatória em toda jornada nova ou atualizada.

Mudança nova cria cenário `untested`; mudança em comportamento existente
reseta seus cenários para `untested`. Refactor sem efeito observável declara
"sem mudança visível" e não cria cobertura artificial.

## Estrutura e propriedade

- `personas.md`: personas duráveis deste produto.
- `journeys/`: fluxo Mermaid e verdadeiro estado final de cada jornada.
- `scenarios/`: tracker vivo, um comportamento por arquivo.
- `charters/`: missões imutáveis e reutilizáveis de sessão.
- `bugs/`: registro global, deduplicado pelo sintoma do usuário.
- `reports/`: um relatório datado por rodada; nunca sobrescrever.
- `automation-backlog/`: intenção de futura automação, um item por arquivo.
- `templates/`: symlinks para os formatos canônicos das skills; sem cópias.

`state.csv` é visão gerada e nunca é editada ou commitada. `evidence/` é
ignorado por padrão: screenshots ficam no disco ou como artefato de CI, e o
relatório versionado referencia seus caminhos.

## Evidência

Capture checkpoints e falhas, não cada clique. Um `Pass` exige observável
confirmado por leitura independente e sobrevivendo a refresh. Vídeos, HARs,
logs extensos e dumps não entram no Git; o relatório registra onde encontrá-los.

## Como iniciar um ciclo

1. Invoque a skill `qa-report` com o argumento `docs/qa` para mapear ou
   atualizar jornadas e planejar os charters do tier.
2. Garanta suíte verde e build acessível com paridade de produção. Na primeira
   execução da máquina, rode `rtk pnpm qa:browser:install`.
3. Invoque a skill `qa-execution` com o argumento `docs/qa`; ela cria o
   relatório antes da primeira sessão e atualiza o tracker após cada sessão e
   correção.
4. Feche com a suíte completa, depois rode `deep-review` antes da PR.
