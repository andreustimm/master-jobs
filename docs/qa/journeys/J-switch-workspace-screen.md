# Trocar de tela de trabalho

```mermaid
flowchart TD
    A[Entrada: lista de vagas autenticada] --> B[Usuário ativa Funil ou outra tela global]
    B --> C[Splash de transição único bloqueia a tela anterior]
    C -->|destino pronto| D[Splash sai e destino aparece]
    C -->|espera acima de 3 s| E[Mensagem de espera prolongada]
    E --> D
    C -->|falha de render| F[Erro localizado e operável]
    F -->|tentar novamente| D
    C -.->|usuário abandona| X[Controle nativo Voltar continua disponível]
    D --> G[True end: destino correto utilizável e foco não preso no splash]
```

```yaml
journey:
  id: J-switch-workspace-screen
  name: Trocar de tela de trabalho
  value_statement: "O usuário chega à próxima área com feedback verdadeiro sem operar conteúdo obsoleto."
  personas: [Andreus em triagem, Candidato em trânsito, Candidato por teclado, Candidato após falha]
  entry_points:
    - url: /jobs
      origin: in-app-nav
  actions:
    - step: 1
      verb: Ativar uma área interna pelo menu
      expected_observable: Um único splash cobre e bloqueia a tela anterior com status localizado
    - step: 2
      verb: Aguardar o destino ou acionar a recuperação oferecida
      expected_observable: O status permanece verdadeiro e o destino final substitui o splash
  goal:
    observable: A área escolhida fica visível, operável e sem foco residual no overlay
    side_effects: []
  true_end_state: O destino correto continua utilizável depois de interação, retorno e recarga
  exit:
    natural: Tela interna escolhida
  abandonment:
    - at_step: 2
      how: Usar Voltar do navegador durante uma espera longa
      resume: O histórico escolhe a geração final e não deixa overlay órfão
  crosses: [Next App Router, transition store, auth policy, i18n, themes]
```
