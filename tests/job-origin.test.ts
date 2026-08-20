import { describe, expect, it } from "vitest";
import { jobOrigin, ORIGIN_LABEL } from "../src/core/job-origin.ts";
import { FETCHABLE_SOURCE_KINDS, MANUAL_SOURCE_KINDS } from "../src/core/sources/types.ts";

/**
 * De onde a vaga veio, derivado de `source.kind` na leitura.
 *
 * O que estes testes travam não é a função — é a decisão de NÃO ter uma coluna
 * `origin` em `job`. Uma coluna assim consulta mais rápido e começa a divergir
 * na primeira reclassificação de fonte; este projeto já paga esse preço em
 * `application.cv_variant`, que guarda o nome da variante em vez de apontar
 * para o documento, e produz um funil afirmando ter enviado algo que não
 * existe mais.
 */

describe("jobOrigin", () => {
  it("recrutador é kind próprio, não mais um manual", () => {
    // A distinção é a razão de existir do rótulo: "eu colei esta URL" e "um
    // recrutador ofereceu isto" são coisas diferentes na triagem.
    expect(jobOrigin("recruiter:acme.com")).toBe("recruiter");
    expect(jobOrigin("manual:acme.com")).toBe("manual");
  });

  it("TODA fonte buscável é web, sem lista de permissão a manter", () => {
    // Fonte nova nasce classificada como `web` sem ninguém lembrar de
    // acrescentá-la aqui. Enumerar as doze seria criar uma segunda lista que
    // envelhece em silêncio — o kind novo cairia num rótulo errado.
    for (const kind of FETCHABLE_SOURCE_KINDS) {
      expect(jobOrigin(`${kind}:handle`)).toBe("web");
    }
  });

  it("todo kind manual tem rótulo próprio", () => {
    // Se alguém acrescentar um `MANUAL_SOURCE_KIND` e esquecer do rótulo, a
    // vaga apareceria como se tivesse vindo da internet.
    for (const kind of MANUAL_SOURCE_KINDS) {
      expect(jobOrigin(`${kind}:x`)).not.toBe("web");
    }
  });

  it("cada origem tem chave de tradução", () => {
    // Rótulo em constante já vazou português para a interface em inglês três
    // vezes neste projeto. Aqui a constante guarda CHAVE.
    for (const key of Object.values(ORIGIN_LABEL)) {
      expect(key).toMatch(/^jobs\.origin/);
    }
  });

  it("ausência e lixo caem em web, que é o padrão inofensivo", () => {
    // Um rótulo errado aqui não expõe nada; errar para `recruiter` afirmaria
    // que existe alguém do outro lado quando não existe.
    for (const value of [null, undefined, "", "sem-dois-pontos", ":vazio"]) {
      expect(jobOrigin(value)).toBe("web");
    }
  });
});
