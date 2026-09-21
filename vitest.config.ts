import { defineConfig } from "vitest/config";

// `node:sqlite` is still marked experimental by the Node 23 runner used in
// local CI. Child migration commands emit machine-readable JSON, so keep that
// runner warning out of their stderr; Node 24 is the supported runtime.
process.env.NODE_NO_WARNINGS ??= "1";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
    globalSetup: ["./tests/support/postgres-global.ts"],
    // Roda dentro de cada worker, ao contrário do `globalSetup`, que vive em
    // outro processo: a política de ingestão é lida do ambiente do worker.
    setupFiles: ["./tests/support/ingestion-env.ts"],
    maxWorkers: 4,

    /**
     * Cobertura com PISO, e o piso é o que garante — não o número de hoje.
     *
     * Sem `thresholds`, cobertura é um relatório que alguém lê de vez em
     * quando; com eles, é uma condição de `pnpm check`. A diferença aparece no
     * dia em que entra código sem teste: no primeiro caso ninguém percebe, no
     * segundo a suíte reprova.
     *
     * `perFile` fica DESLIGADO de propósito. Ligado, um arquivo novo de dez
     * linhas sem teste reprova a suíte inteira e o caminho de menor resistência
     * vira baixar o limite. O piso global mede o que interessa — quanto do
     * sistema está exercitado — sem transformar cada arquivo num obstáculo.
     *
     * O que a cobertura NÃO mede continua valendo: 100% de linhas executadas
     * com zero asserções úteis é 100%. Os testes deste repositório existem para
     * afirmar comportamento, e vários foram confirmados contra o código
     * quebrado antes de serem aceitos.
     */
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: [
        // Só tipo e constante: não há ramo para exercitar, e contá-los infla o
        // número sem dizer nada sobre o que foi testado.
        "src/core/db/schema.ts",
        "src/**/*.d.ts",
      ],
      reporter: ["text-summary", "json-summary"],
      /**
       * O piso é o que foi alcançado, menos uma margem estreita de propósito.
       *
       * Deixá-lo abaixo do alcançado permite que a cobertura escorra sem que
       * nada reprove — foi o que aconteceu com `branches` em 90 enquanto o real
       * andava por 92: cinco pontos de folga são cinco pontos que podem ser
       * perdidos em silêncio. Subir o piso junto com a cobertura é o que fecha
       * essa porta.
       *
       * A margem existe porque dois números aqui não são estáveis ao decimal:
       * arquivo novo em `src/` muda o denominador antes de o teste chegar, e um
       * `it` marcado como `skip` numa investigação reduz o numerador. Meio ponto
       * absorve isso sem absorver a remoção de uma suíte.
       */
      thresholds: {
        statements: 97,
        branches: 94.5,
        functions: 97.5,
        lines: 97.9,
      },
    },
  },
});
