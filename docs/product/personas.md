# Personas

Quatro perfis. Só o primeiro é usuário hoje — os outros existem porque decisões
de arquitetura já tomadas (modelagem multi-candidato, catálogo global de skills)
só fazem sentido com eles no horizonte, e porque um deles não é usuário nenhum:
é quem está do outro lado e decide se a candidatura é lida.

---

## P1 — Andreus, o arquiteto que o filtro não enxerga
**Primária. É para ele que o sistema existe hoje.**

| | |
|---|---|
| Papel | Senior AI Software Architect, 20+ anos |
| Onde | São Paulo, Brasil |
| Busca | Remoto, contrato B2B (PJ), internacional |
| Restrição dura | **Sem autorização de trabalho nos EUA** |
| Tempo disponível | ~2h/dia, quase sempre depois das 21h |
| Ferramentas | Terminal antes de navegador. Obsidian. Vim. |

### O que ele quer
Um número em que possa confiar às 21h40 de terça, e que o poupe de reconstruir
o critério toda noite.

### O que o atrapalha
- **Ele é ilegível para filtro automático.** O CV dele escreve "Datadog,
  Rollbar" onde a vaga escreve "observability". Escreve "orquestração
  multiagente" onde a vaga escreve "LLM pipelines". A experiência existe; o
  vocabulário não bate. **51% das vagas-alvo pedem um termo que o CV nunca
  usa** — e o filtro do ATS não faz inferência semântica.
- **Elegibilidade é eliminatória e mal sinalizada.** 468 vagas do acervo têm
  bloqueador de presença física, cidadania ou autorização local. Isso costuma
  aparecer no parágrafo onze, depois de quinze minutos de leitura.
- **Empregador anônimo mata a jogada dele.** A vantagem real do Andreus são 20
  anos de rede. Sem nome de empresa, não há indicação a pedir — e 73,6% do
  acervo é anônimo.
- **A janela fecha rápido.** Vaga com seis semanas geralmente já tem shortlist.
  Ele descobre isso depois de escrever a carta.

### Como ele mede que o sistema funciona
Se, ao abrir o dashboard, as dez primeiras vagas forem defensáveis — e ele
conseguir dizer *por que* cada uma está ali sem abrir a vaga.

### Frase dele
> "Não quero mais vagas. Quero saber em quais quatro eu gasto hoje."

---

## P2 — Camila, a recrutadora do outro lado
**Não é usuária. É quem decide se o trabalho do P1 foi lido.**

| | |
|---|---|
| Papel | Talent Acquisition em scale-up remota (150–400 pessoas) |
| Carga | 6 a 9 vagas abertas em paralelo |
| Volume | 200 a 600 candidaturas por vaga; 300+ em vaga remota internacional |
| Tempo por CV | **6 a 8 segundos** na primeira passada |

### Como ela realmente triagem
1. **Elegibilidade primeiro.** Fuso, autorização de trabalho, modelo de
   contratação. Reprova sem ler o resto.
2. **Casamento de vocabulário.** Ela busca no ATS os termos do próprio job
   description. Sinônimo não conta.
3. **Coerência de senioridade.** Título e escopo batem com o nível da vaga?
4. **Só então**, o conteúdo.

### O que faz ela parar num CV
- Indicação interna. Muda tudo, e ela abre primeiro.
- Os termos da vaga aparecendo com resultado numérico ao lado.
- Candidatura nas primeiras 72h — depois disso a shortlist já se formou.

### O que a faz descartar
- Carta genérica que serviria para qualquer empresa.
- Candidatura em massa evidente.
- Ambiguidade sobre onde a pessoa mora e como pode ser contratada.

### Por que ela está neste documento
Cada decisão de scoring é uma hipótese sobre ela:

| Componente | Hipótese sobre a Camila |
|---|---|
| Elegibilidade (15) | É o primeiro filtro dela — e é eliminatório |
| Palavras-chave (27) | Ela busca por termo literal, não por sinônimo |
| Cargo (30) | Coerência de nível é a terceira checagem |
| Frescor (6) | Depois de ~2 semanas ela já tem shortlist |
| Benefícios (4) | Raramente decide; desempata |

> Se um componente do scorer não puder ser explicado como "isto muda o
> comportamento da Camila", ele não deveria ter peso.

---

## P3 — Renata, a especialista em transição
**Secundária. Valida a modelagem multi-candidato antes de existir.**

| | |
|---|---|
| Papel | Eng. de dados sênior migrando para plataforma de ML |
| Onde | Porto Alegre, remoto, CLT ou PJ |
| Diferença chave | Busca por **trajetória desejada**, não por histórico |

### Por que ela importa agora
O P1 tem 20 anos de evidência e o problema dele é ser lido. A Renata tem
evidência parcial e o problema dela é **credibilidade de transição** — ela
precisa saber quais vagas aceitam adjacência, e o que falta para as que não
aceitam.

Isso pressiona duas decisões já tomadas:
- `profile.yaml` separa `evidence:` de `growth:`. Para ela, `growth:` é o
  documento mais importante, não uma nota de rodapé.
- O scorer precisa reportar **lacuna acionável** ("faltam 2 dos 5 termos
  centrais"), não só uma nota mais baixa.

Ela é a razão de o sistema já ter `candidate` como tabela, e não constantes.

---

## P4 — Marcos, o curador do catálogo de skills
**Operacional. Existe assim que houver mais de um candidato.**

| | |
|---|---|
| Papel | Administra o catálogo global de skills |
| Frequência | Semanal, sessões curtas |

### O que ele faz
A extração automática de skills produz detecções com confiança calculada
(`alias` 1,0 · `declared` 0,8 · `applied` 1,3). Ele revisa a fila e decide:

- **Promove** um termo recorrente a skill canônica.
- **Funde** duplicata (`k8s` → `kubernetes`).
- **Rejeita** falso positivo — o caso "office stipend" capturado dentro de
  "home office stipend" é exatamente o tipo de erro que ele corrige.
- **Cria alias**, o que melhora retroativamente todos os candidatos.

### Por que ele é o gargalo silencioso
Catálogo sem curadoria degrada sozinho: aliases se multiplicam, a mesma
tecnologia aparece em três grafias, e o cruzamento vaga×candidato piora sem que
ninguém perceba. A qualidade do match é derivada da qualidade do catálogo.

### O que ele precisa e ainda não tem
Fila de revisão ordenada por impacto — quantos candidatos e quantas vagas cada
decisão afeta. Sem isso ele revisa em ordem alfabética, que é a ordem errada.

---

## Como as personas dirigem a prioridade

| Item do backlog | Serve a quem | Por quê |
|---|---|---|
| Fontes ATS diretas | P1 + P2 | Empregador nomeado destrava indicação |
| Frescor no score (B-03) ✅ | P2 | Modela a janela de 72h dela |
| Lacuna de vocabulário | P1 + P3 | O termo literal é como a Camila busca |
| Gmail OAuth (F-01) | P1 | Elimina a triagem manual de 34 e-mails |
| Análise estatística (E-02) | P1 | Recalibra o peso com o funil real |
| Fila de curadoria | P4 | Catálogo sem curadoria degrada |
| Submissão autônoma (E-03) | ninguém ainda | Acelera o gargalo errado — ver antivisão |
