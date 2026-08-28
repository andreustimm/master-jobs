# Abrir o dashboard diretamente

```mermaid
flowchart TD
    A[Entrada: URL direta, retomada ou start_url da PWA] --> U[Checagem da geração do aplicativo]
    U -->|geração atual| B[Splash de startup único]
    U -->|nova geração assume| R[Uma recarga controlada]
    R --> B
    B -->|sessão válida| C[Dashboard autorizado]
    B -->|sessão ausente| D[Login canônico]
    B -.->|usuário fecha a aba| X[Abandono sem estado persistente de transição]
    C --> F[Cabeçalho instalado abaixo da barra do sistema]
    F --> E[True end: shell pronto sem overlay nem controles encobertos]
    D --> E
```

```yaml
journey:
  id: J-open-dashboard-direct
  name: Abrir o dashboard diretamente
  priority: P1
  value_statement: "O usuário recebe o startup branded existente e chega a uma superfície autorizada sem camadas duplicadas."
  personas: [Andreus em triagem, Candidato em trânsito]
  entry_points:
    - url: /
      origin: direct
  actions:
    - step: 1
      verb: Abrir ou recarregar o dashboard
      expected_observable: Apenas o splash de startup aparece antes da tela
    - step: 2
      verb: Usar o cabeçalho no modo instalado
      expected_observable: Em retrato, marca e controles permanecem abaixo da barra do sistema; em paisagem baixa de telefone, o topo usa somente o inset físico e não mantém uma faixa artificial
    - step: 3
      verb: Retomar o aplicativo instalado depois de uma atualização
      expected_observable: A versão atual assume o controle com uma única recarga e sem manter o visual anterior
  goal:
    observable: A tela autorizada aparece sem overlay de transição durante hidratação
    side_effects: []
  true_end_state: A página permanece utilizável depois da hidratação e da atualização, usando a geração atual sem a barra do sistema cobrir o cabeçalho instalado
  exit:
    natural: Dashboard ou login autorizado
  abandonment:
    - at_step: 1
      how: Fechar a aba antes da hidratação
      resume: Uma nova carga começa somente o lifecycle de startup
    - at_step: 3
      how: Colocar o aplicativo em segundo plano durante a atualização
      resume: Ao voltar ao primeiro plano, uma nova checagem busca a geração atual
  crosses: [startup renderer, App Router hydration, auth policy, PWA display mode, service worker lifecycle, CSS safe areas]
```
