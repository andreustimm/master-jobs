---
name: application-kit
description: Monta o kit de candidatura para uma vaga específica — currículo adaptado ao cluster, carta de apresentação e mensagem de contato. Use quando o usuário decidir aplicar a uma vaga e precisar dos documentos. NÃO use para decidir se vale aplicar (use job-triage) nem para publicar conteúdo no LinkedIn (use linkedin-positioning).
---

# Kit de candidatura

## Antes de escrever qualquer coisa

```bash
pnpm jho jobs show <id>     # cluster, keywords casadas e ausentes, blockers
cat profile/profile.yaml    # evidências citáveis e lacunas assumidas
```

Carregue também a skill `candidate-profile` — a regra de honestidade dela
vale integralmente aqui.

> **Invariante:** só cite experiência que existe em `evidence:` no
> `profile.yaml`. O que está em `growth:` é lacuna — sinalize ao usuário,
> nunca maquie no documento.

## Currículo

O corpo é estável; adapta-se **SUMMARY**, **CORE EXPERTISE** e a ordem dos
bullets. Base: `../CV/ATS Curriculum Andreus Timm 2026-07 - EN.md`.

Regras de ATS:
- Espelhe a terminologia da vaga quando a experiência for genuína.
  A auditoria §6.2 tem o mapa de sinônimos por categoria.
- Sem tabelas, sem colunas, sem gráficos, sem cabeçalho/rodapé.
- Cargo, empresa, datas e local em linhas próprias.
- Priorize **decisão e resultado** sobre lista de ferramentas — é a
  lacuna de comunicação apontada na auditoria §7.2.

## Carta de apresentação

Quatro parágrafos, máximo uma página:

1. **Gancho** — o problema específico que a vaga descreve, e a evidência
   direta de que ele já foi resolvido antes.
2. **Prova** — uma experiência concreta de `evidence:`, com decisão,
   trade-off e resultado. Uma só, bem contada.
3. **Encaixe** — por que este cluster e esta empresa, não genericamente.
4. **Logística** — remoto, B2B a partir do Brasil, C2 em inglês,
   disponibilidade. Objetivo, sem pedir desculpa.

Não repita o currículo em prosa. A carta responde "por que você, por que
aqui" — o currículo já responde "o que você fez".

## Mensagem de contato

Quando houver hiring manager ou recrutador identificável, a auditoria §12.10
traz o modelo de conexão e a §12.11 o modelo de resposta a recrutador.

Curta, com contexto explícito, sem automação de convite — vale a política de
`docs/linkedin-policy.md`.

## Saída

Grave em `out/<empresa>-<cargo>/` (o diretório é gitignored — contém
documentos pessoais adaptados):

```
out/paires-applied-ai-engineer/
  cv.md
  cover-letter.md
  outreach.md
  notes.md      # o que foi enfatizado e por quê
```

Depois registre no funil:

```bash
pnpm jho track <id> preparing -n "kit gerado em out/paires-applied-ai-engineer"
```
