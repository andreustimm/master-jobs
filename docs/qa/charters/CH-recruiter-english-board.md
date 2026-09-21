# CH-recruiter-english-board: em inglês, o anúncio fala português e a interface não

```yaml
charter:
  id: CH-recruiter-english-board
  mission: "Como Recrutadora convidada em inglês, percorrer quadro, vaga e hub de países e separar o que é texto do anúncio — que fica como veio, acento incluído — do que é texto da interface, que não pode aparecer em português."
  mode: charter-with-tour
  persona:
    name: Recrutadora convidada
    device: laptop
    network: wifi-fast
    locale: en-US
  journey: J-trust-the-filtered-board
  scenarios: [JOBS-english-keeps-posting-data]
  tour: Configuration Tour
  time_box_minutes: 60
  guidance:
    must_try:
      - "Filtrar o quadro por um empregador cujas vagas tenham localização acentuada e abrir uma delas"
      - "Ler o hub de países do grupo e conferir cada publicação: título, empregador e localização"
      - "Procurar o contrário do defeito: rótulo, botão e cabeçalho que continuaram em português"
      - "Confirmar por um segundo caminho de leitura e depois de recarregar"
    must_avoid:
      - "Ler o dicionário para decidir o que a tela deveria mostrar — a fonte é a tela"
      - "Aceitar ausência de acento como prova: rota sem fixture acentuada não mede nada"
```

O Configuration Tour é o certo aqui porque o idioma é configuração, e o risco
mora na combinação — a tela em inglês com dado em português. Um Feature Tour
percorreria as mesmas telas no idioma padrão e não veria nada.

A armadilha específica desta jornada: **a isenção e o defeito se escondem um no
outro.** `data-user-content` existe para o dado do anúncio escapar da verificação
de acento; usá-lo demais apaga a prova, usá-lo de menos impede a rota de entrar na
verificação. Toda sessão desta carta confere os dois sentidos.
