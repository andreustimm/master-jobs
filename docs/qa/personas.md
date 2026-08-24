# Personas de QA

Estas personas traduzem os papéis reais do produto em modos de dogfooding. Não
substituem `docs/product/personas.md`; elas definem dispositivo, rede, modalidade
e limite de paciência usados nas sessões.

## Andreus em triagem noturna

```yaml
persona:
  name: Andreus em triagem noturna
  base: Power User
  goal: escolher rapidamente as melhores vagas e registrar a próxima ação sem perder contexto
  device: laptop
  network: wifi-fast
  modality: mouse-keyboard
  locale: pt-BR
  patience_seconds: 3
```

## Andreus no celular

```yaml
persona:
  name: Andreus no celular
  base: Mobile User
  goal: consultar o topo do ranking e atualizar o funil com uma mão em uma tela de 375px
  device: phone-small
  network: 4g
  modality: touch
  locale: pt-BR
  patience_seconds: 3
```

## Recrutadora convidada

```yaml
persona:
  name: Recrutadora convidada
  base: Casual User
  goal: acessar somente os candidatos vinculados e encontrar evidências relevantes sem ver dados privados indevidos
  device: laptop
  network: wifi-fast
  modality: mouse-keyboard
  locale: en-US
  patience_seconds: 8
```

## Visitante do perfil público

```yaml
persona:
  name: Visitante do perfil público
  base: New User
  goal: entender a proposta profissional pelo link público sem receber confirmação sobre perfis não publicados
  device: phone-large
  network: 4g
  modality: touch
  locale: en-US
  patience_seconds: 5
```

## Operador somente por teclado

```yaml
persona:
  name: Operador somente por teclado
  base: Accessibility-Reliant
  goal: concluir login, navegação, filtros e atualização do funil sem mouse e com foco sempre perceptível
  device: laptop
  network: wifi-fast
  modality: keyboard-only
  locale: pt-BR
  patience_seconds: 10
```

## Andreus em triagem

```yaml
persona:
  name: Andreus em triagem
  base: Power User
  goal: alternar rapidamente entre vagas, funil e detalhes sem perder contexto
  device: laptop
  network: wifi-fast
  modality: mouse-keyboard
  locale: pt-BR
  patience_seconds: 3
```

## Candidato em trânsito

```yaml
persona:
  name: Candidato em trânsito
  base: Mobile User
  goal: consultar uma vaga e voltar ao funil com uma mão e conexão variável
  device: phone-small
  network: 4g
  modality: touch
  locale: pt-BR
  patience_seconds: 3
```

## Candidato por teclado

```yaml
persona:
  name: Candidato por teclado
  base: Accessibility-Reliant User
  goal: navegar entre telas com anúncios coerentes e sem foco preso
  device: laptop
  network: wifi-fast
  modality: keyboard-only
  locale: en-US
  patience_seconds: 5
```

## Candidato após falha

```yaml
persona:
  name: Candidato após falha
  base: Recovering User
  goal: retomar uma tela que falhou sem detalhes técnicos nem estado residual
  device: laptop
  network: flaky
  modality: mouse-keyboard
  locale: pt-BR
  patience_seconds: 5
```
