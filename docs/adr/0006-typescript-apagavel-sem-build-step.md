# ADR 0006 — TypeScript apagável, sem build step

**Status:** Aceita · 2026-08-18

## Contexto

A CLI precisa rodar em TypeScript. As opções usuais são um build step
(`tsc` para `dist/`), um runner (`tsx`, `ts-node`) ou o type stripping nativo
do Node.

Node 24 executa TypeScript diretamente, sem transpilador e sem dependência —
ele simplesmente apaga as anotações de tipo. O custo é uma restrição real:
**só sintaxe apagável é aceita**. Qualquer construção TypeScript que gere
código JavaScript em runtime é rejeitada.

Isso foi descoberto na prática, não na teoria. A primeira execução da CLI
quebrou em duas construções perfeitamente idiomáticas:

```
SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]:
  TypeScript parameter property is not supported in strip-only mode
```

```
SyntaxError [ERR_INVALID_TYPESCRIPT_SYNTAX]:
  Nullish coalescing operator(??) requires parens when mixing with logical operators
```

## Decisão

Rodar direto no Node, sem build step, e escrever **só TypeScript apagável**.

Proibido:

| Construção | Por quê | O que usar |
|---|---|---|
| `enum` | Gera objeto em runtime | `as const` + tipo derivado |
| Parameter properties (`constructor(private x: T)`) | Gera atribuições | Declarar campo e atribuir no corpo |
| `namespace` com valores | Gera IIFE | Módulos ES |
| Decorators | Geram chamadas | Composição de funções |

`erasableSyntaxOnly: true` está ligado no `tsconfig.json`, de modo que
`pnpm typecheck` reprova essas construções antes de virarem erro de runtime.

O padrão de `APPLICATION_STATUSES` mostra a alternativa idiomática ao `enum`:

```ts
export const APPLICATION_STATUSES = ["backlog", "shortlisted", /* ... */] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
```

O array existe em runtime (a CLI valida contra ele e imprime as opções no
`--help`) e o tipo é derivado dele — uma fonte da verdade, zero duplicação.

## Consequências

**Positivas**

- Sem build step. Editou, rodou. Nada de `dist/` desatualizado.
- Uma dependência a menos (`tsx` só permanece como devDependency indireta).
- O código fica compatível com qualquer runtime que faça só type stripping,
  o que hoje inclui Node, Deno e Bun.

**Negativas**

- Perde `enum` e decorators. Nenhum dos dois faz falta neste projeto.
- Exige atenção com precedência de operadores: `a ?? b || c` é erro de
  sintaxe e precisa de parênteses explícitos. Regra do JavaScript, não do
  type stripping, mas o parser do Node é mais rígido que o do `tsc`.
- A Next.js, quando entrar, terá seu próprio pipeline de compilação. A
  restrição vale para `src/core/` e `src/cli.ts` — e como `src/core/` é
  compartilhado entre CLI e UI, ela vale na prática para toda a lógica.

## Alternativas consideradas

**`tsx` como runner.** Aceita todo o TypeScript, sem restrição. Rejeitado:
adiciona dependência e um processo de transpilação para resolver um problema
que o runtime já resolve, em troca de construções que não são necessárias.

**Build step com `tsc`.** Rejeitado para uma CLI de uso pessoal: introduz
`dist/` desatualizado como classe inteira de bug, sem benefício aqui.
