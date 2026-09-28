# Techspec — `perfil-publico-opt-in`

Ver [_prd.md](_prd.md). Esta techspec detalha a **parte A**; a parte B está
no fim, como plano.

## Dados (migração aditiva)

Catorze colunas novas em `production.candidate`, nenhuma FK (G20 não se
aplica: nada referencia outra tabela):

| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| `work_model` | `text[]` | sim | — |
| `experience_level` | `text` | sim | — |
| `availability` | `text` | sim | — |
| `start_timeframe` | `text` | sim | — |
| `open_to_relocation` | `boolean` | sim | — |
| `area` | `text` | sim | — |
| `languages` | `text` | sim | — |
| `public_work_model` … `public_languages` (7) | `boolean` | sim | `false` |

Os opt-ins aceitam nulo pelo mesmo contrato de `source.origin`: `candidate`
atravessa a importação do snapshot legado, e coluna posterior a ele é opcional
(`tests/postgres-schema.test.ts`). Nulo é **desligado** — a saída só publica
com `=== true`, e há teste para isso. `ADD COLUMN` com default constante é só
metadado no PostgreSQL: sem reescrita nem varredura. A migração sai de `pnpm db:generate` (nunca editada à mão) e
leva o veredito `[]` em `tests/fixtures/migration-verdicts/`. A importação do
snapshot legado (`scripts/migration/select-production.ts`) ganha as catorze em
`postSnapshotColumns` com o valor seguro: nulo e `false`.

Valores controlados ficam em texto, validados na aplicação (mesmo desenho de
`visibility`): sem CHECK constraint, para que acrescentar um valor não exija
migração não aditiva. O que a leitura não reconhece não sai.

## Domínio puro — `src/core/candidate-public-facts.ts`

Sem banco, rede nem relógio.

```ts
export const WORK_MODELS = ["remote", "hybrid", "onsite", "b2b", "contractor", "employee"] as const;
export const EXPERIENCE_LEVELS = ["junior", "mid", "senior", "lead", "staff", "principal", "executive"] as const;
export const AVAILABILITY_STATUSES = ["actively-looking", "open", "not-looking"] as const;
export const START_TIMEFRAMES = ["immediate", "two-weeks", "one-month", "two-months", "three-months-plus"] as const;
export const AREA_MAX = 80;
export const LANGUAGES_MAX = 160;

export type PublicFacts = {
  workModel: WorkModel[];            // vazio = não sai
  experienceLevel: ExperienceLevel | null;
  availability: Availability | null;
  startTimeframe: StartTimeframe | null;
  openToRelocation: boolean | null;
  area: string | null;
  languages: string | null;
};

export function parsePublicFactsForm(raw): { ok: true; value: StoredFacts } | { ok: false; code: PublicFactsError };
export function publicFactsFrom(row: StoredFacts, known: KnownContact): PublicFacts;
```

- `parsePublicFactsForm` — entrada do formulário. Valor controlado fora da
  lista é recusado (`invalidChoice`): o formulário só oferece a lista, então
  outro valor é requisição forjada, não digitação. Texto livre: teto
  (`areaTooLong`, `languagesTooLong`), contato (`areaContact`,
  `languagesContact`) e pretensão (`areaPay`, `languagesPay`). Vazio vira
  `null`. Opt-in é `on` ou nada.
- `publicFactsFrom` — saída, a segunda camada. Um fato só sai quando o opt-in
  é `true` **e** o valor existe **e** é reconhecido (controlado) ou passa por
  `containsContact()` e `containsPay()` (livre). Modelo de trabalho sai
  deduplicado, na ordem canônica da lista, sem valor desconhecido.

`containsPay()` é exportada de `src/core/public-cv.ts`, reaproveitando
`isSalaryBlock()`/`isPayTitle()` do filtro do CV — mesma régua, mesmo limite
declarado (G23), sobre espaço colapsado (a alternativa de `rate:` em começo de
linha é quadrática numa sequência de quebras).

**Revisão L2 da #362.** Rótulo não basta num campo curto: "Piso 20k", "Rate
90/h" e "USD 15,000/mês" passavam. Área e idiomas também recusam/esvaziam
valor pela régua própria dos campos curtos (`containsShortFieldPay()`),
telefone sem marca (`containsShortFieldContact()`: oito dígitos ou mais com
separador curto, fora par de anos) e os e-mails cadastrados na entrada
(`setPublicFacts` os lê do candidato e da conta). Na saída, texto acima do
teto sai `null` antes de qualquer expressão.

**Re-revisão L2 da #362.** A régua de valor deixou de ser o `MONEY_LIKE` do
currículo (intocado): `rate` com número em qualquer posição, unidade de tempo
(`/hr`, `/mo`, `/yr`, `por hora`, `an hour`), código de moeda colado
("USD15000"), milhar com espaço/apóstrofo, moeda por extenso só junto de
número, e número de norma (ISO/IEC/IEEE/RFC/NBR) retirado antes.

**Passada final L2 da #362 (fechar por segurança).** Número com
`mil`/`thousand`/`million`/`milhões` ou com `k` é sempre valor, inteiro ou
decimal — só `4K`/`8K` exatos, de resolução, passam; `target`/`pay`/`rate`
só contam com número ou moeda depois, e `rate` de métrica (`frame`,
`conversion`, `error`, `success`, `churn`, `retention`) nunca; norma só em
maiúscula, até cinco dígitos (RFC, quatro), e nunca seguida de unidade de
valor. Falso positivo aceito: "10 mil TPS", "1 200 pessoas", norma em
minúscula. Limite declarado: ano sem moeda nem rótulo, número de até três
dígitos sozinho e número por extenso passam.

## DTO — `src/core/candidate-public.ts`

`PublicProfile` ganha **uma** chave, `facts: PublicFacts`, montada por
`publicFactsFrom()`. O `select` lista as catorze colunas uma a uma (lista de
permissão de coluna, G21), e a saída confere o valor. O teste de igualdade de
chaves passa a incluir `facts` e as sete chaves internas dele.

## Gravação — `src/core/candidate.ts` + `app/candidate/actions.ts`

- `setPublicFacts(candidateId, raw)` valida com `parsePublicFactsForm` e grava
  as catorze colunas num `UPDATE` só.
- `setPublicFactsAction(formData)` chama `guardOwnCandidate("candidate:write")`
  **antes** de ler o formulário; o candidato vem da sessão, nunca do
  `FormData` (regra 15). Devolve `{ ok: true } | { ok: false, code }` para a
  tela traduzir. O inventário de G39 a descobre sozinho, e a varredura de
  `tests/entry-denial.test.ts` a exercita com sessão inválida e id forjado.

## Tela de edição — `app/candidate/public-facts.tsx`

Cartão "Dados do perfil público" entre "Endereço público" e o cartão de
identidade. Um bloco por fato: rótulo, controle (caixas para modelo de
trabalho, `select` nativo para os controlados e aceita mudar, `Input` para
área e idiomas) e a caixa "Mostrar no perfil público" (`data-testid =
public-fact-show-<campo>`), desmarcada por padrão. Dica fixa: desmarcado fica
guardado e não sai; pretensão salarial não é campo. `MutationFeedbackForm`
com `keepFields` e `resultMessages` por código. Uma coluna em 375px.

## Página pública — `app/p/[slug]/page.tsx`

- **Faixa de fatos** (hero): localização, modelo de trabalho, nível e
  disponibilidade. A faixa aparece quando qualquer um existe.
- **"Em resumo"** (lateral, antes das skills): área, idiomas, prazo, aceita
  mudar. Cartão ausente quando nenhum existe (sem "No data available").
- A lateral (`public-profile-aside`) passa a existir quando há resumo **ou**
  skills. `public-profile-skills` continua no grupo das skills.
- Rótulo e valor controlado vêm do dicionário (`publicFacts.*`); área e
  idiomas levam `data-user-content`. Cada item tem `data-testid`
  (`public-fact-<campo>`).

## i18n

`publicFacts.*` em pt-BR e en: título/dica do cartão, rótulo de cada fato,
rótulo de cada valor controlado, "Mostrar no perfil público", "Não informado",
"Sim"/"Não", "Em resumo", mensagens de recusa por código.

## Riscos

- **Campo novo nasce visível?** Não: opt-in `false` no banco, `null` no DTO,
  ausência na página. Três camadas, cada uma testada.
- **Texto livre como canal de contato/piso:** recusa na entrada + esvazia na
  saída, com o limite declarado do detector (G23).
- **Layout:** o cartão novo na lateral desloca as skills para baixo; o teste
  de duas colunas passa a medir a lateral inteira contra a coluna principal.

## Parte B — plano técnico

- `src/contexts/storage/` (porta `ObjectStorage` em semântica S3) com
  `adapters/vercel-blob.ts` e `adapters/s3.ts`; `createStorage(env)` escolhe
  por `JHO_STORAGE_DRIVER` e falha fechado com valor desconhecido.
- Suíte de contrato única (`tests/storage-contract.ts`) rodada contra MinIO
  (`docker compose`, `127.0.0.1`) e contra o SDK do Blob simulado.
- `app/p/[slug]/image/[kind]/route.ts`: confere `publicProfile()` + opt-in
  antes de ler o objeto; 404 idêntico ao da página. Entra em G39 como classe
  "conteúdo público", sem cache do service worker (G14), `Cache-Control:
  private, no-store`.
- Upload por Server Action com `guard`, teto de bytes, tipo por assinatura
  (não por MIME declarado), dimensão máxima, reencode sem EXIF.
- ADR nova; `deploy.md`, `operations.md` e `.env.example`.
