import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,

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
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
      },
    },
  },
});
