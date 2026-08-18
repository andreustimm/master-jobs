---
name: candidate-profile
description: Carrega e raciocina sobre o perfil profissional de Andreus Timm — experiência, evidências citáveis, cargos-alvo, restrições de contratação e lacunas assumidas. Use ao avaliar aderência a uma vaga, adaptar currículo ou carta, redigir mensagem a recrutador, ou responder "eu tenho experiência com X?". NÃO use para operar o banco de vagas (use a CLI jho) nem para tarefas de LinkedIn (use linkedin-positioning).
---

# Perfil do candidato — Andreus Timm

## Fonte da verdade

`profile/profile.yaml` é a **única** fonte autorizada sobre o candidato.
Leia o arquivo antes de afirmar qualquer coisa. Não responda de memória:
o perfil é editado com frequência e a versão em disco vence sempre.

```bash
cat profile/profile.yaml         # perfil estruturado
pnpm jho profile                 # valida e resume os alvos
```

Documentos de apoio no vault (contexto, não fonte primária):

| Arquivo | O que traz |
|---|---|
| `../CV/ATS Curriculum Andreus Timm 2026-07 - EN.md` | Currículo ATS completo em inglês |
| `../Relatorio-Posicionamento-Andreus-Timm-2026-07-27.md` | Auditoria de posicionamento: keywords, benchmark de mercado, narrativa |
| `../LinkedIn/vagas_agosto_2026.md` | Mapeamento de clientes BairesDev e hipótese de markup |

---

## Resumo operacional

**Andreus Jarta Timm** — Senior AI Software Architect, 20+ anos.
São Paulo, Brasil. Inglês C2. Remoto, B2B/contractor.

**Narrativa central** (auditoria §1.10):
> 20+ years building and modernizing SaaS and distributed systems; now
> designing production AI platforms, agentic workflows and data-intensive
> products for international teams.

**Clusters-alvo**, em ordem de peso: `architect` (1.0) · `staff` (0.95) ·
`ai_lead` (0.95) · `eng_lead` (0.85) · `senior_ic` (0.6).
Cada cluster mapeia para uma variante de currículo — veja `targets.clusters`
no YAML.

---

## Restrições duras

Estas não são preferências. Violá-las torna a vaga inaplicável:

- **Sem autorização de trabalho nos EUA.** Sem green card, sem cidadania,
  sem visto. Vaga que exige isso está fora.
- **Sem security clearance.**
- **Remoto obrigatório.** Presencial e híbrido estão fora.
- **Contratação B2B/CNPJ** a partir do Brasil. "W2 only" está fora.
- Fuso: America/Sao_Paulo, tolerância de até 6h de diferença.

A lista completa de padrões que disparam bloqueio está em `blockers:` no YAML
e é aplicada automaticamente pelo scorer.

---

## Regra de honestidade

> **Invariante:** só é citável como experiência o que está sob `evidence:`
> no `profile.yaml`. O que está sob `growth:` é lacuna assumida.

Ao adaptar currículo, carta ou mensagem:

- **Pode:** reordenar, reenquadrar e escolher quais evidências destacar para
  o cluster da vaga.
- **Pode:** usar a linguagem da vaga para descrever experiência que
  genuinamente existe (a auditoria §6.2 mapeia sinônimos por categoria).
- **Não pode:** afirmar experiência que não está em `evidence`.
- **Não pode:** inflar números, anos ou escopo.
- **Deve:** quando a vaga pede algo que está em `growth`, dizer isso ao
  usuário em vez de esconder. Lacuna conhecida é informação útil para decidir
  se vale aplicar.

Lacunas atuais declaradas: nenhum case study público de Zorbit ou Contas Casal;
Kubernetes é entrega, não força de destaque; tooling formal de evals é
prática interna, não demonstrada publicamente; só 2 recomendações no LinkedIn,
nenhuma validando arquitetura ou IA.

---

## Como avaliar aderência a uma vaga

1. Rode `pnpm jho jobs show <id>` — o breakdown determinístico já diz
   componente a componente por que a vaga pontuou o que pontuou.
2. Leia `blockers` primeiro. Se houver bloqueio duro, pare e diga isso.
3. Compare `matchedKeywords` e `missingKeywords` com `evidence:` do perfil.
   Keyword ausente no texto da vaga mas presente na experiência é um ponto a
   destacar na carta.
4. Identifique o cluster (`job_score.cluster`) e use a variante de currículo
   correspondente.
5. Aponte explicitamente qualquer requisito que caia em `growth:`.

## Como adaptar o topo do currículo

O corpo do CV é estável. O que se adapta é o topo — SUMMARY e CORE EXPERTISE —
mais a ordem dos bullets dentro de cada experiência.

Por cluster:

| Cluster | Ênfase |
|---|---|
| `architect` | Decisões de arquitetura, trade-offs, multi-tenancy, governança, modernização |
| `staff` | Ownership ponta a ponta, ambiguidade → direção, padrões, influência técnica |
| `ai_lead` | Production AI, agentes, RAG, evals, observabilidade, custo/latência |
| `eng_lead` | Liderança de times, mentoria, cross-functional, entrega |
| `senior_ic` | Profundidade de stack, entrega hands-on |

A auditoria §7.2 é explícita sobre o que o mercado pede hoje e o usuário
comunica mal: **evals, observabilidade, segurança, custo/latência, governança
e resultado de negócio** — com a mesma clareza com que hoje lista frameworks.
Ao adaptar, prefira decisões e resultados a listas de ferramentas.

## Perguntas frequentes que esta skill responde

- "Tenho experiência com X?" → grep em `evidence:`; se não estiver lá, a
  resposta honesta é não, mesmo que pareça adjacente.
- "Vale aplicar nesta vaga?" → cheque blockers, depois fit, depois growth.
- "Que currículo mando?" → o do cluster do `job_score`.
- "Como respondo este recrutador?" → auditoria §12.11 tem o modelo.
