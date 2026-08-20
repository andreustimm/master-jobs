import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/contexts/auth/domain/password.ts";

/**
 * Hash corrompido tem de NEGAR acesso.
 *
 * O defeito que estes testes travam falhava **aberto**, que é o pior modo de
 * falha possível numa função de autenticação. O `keylen` do scrypt vinha de
 * `expected.length` — o tamanho do valor GRAVADO, não a constante. Um
 * `password_hash` cujo campo final estivesse vazio produzia um buffer de zero
 * bytes, o KDF devolvia zero bytes, e `timingSafeEqual(vazio, vazio)` é
 * verdadeiro. Qualquer senha entrava naquela conta.
 *
 * Chegar lá exige escrita na coluna — migração malfeita, importação, correção
 * manual em SQL. Nada disso é exótico num sistema que já tem 24 migrações. E o
 * ponto não é a probabilidade: é que dado corrompido numa coluna de senha
 * precisa negar, e estava concedendo.
 */

const SENHA = "uma-senha-de-verdade-longa";

async function comCampoFinal(hash: string, final: string): Promise<string> {
  const parts = hash.split("$");
  return [...parts.slice(0, 5), final].join("$");
}

describe("verifyPassword com hash corrompido", () => {
  it("hash íntegro aceita a senha certa e recusa a errada", async () => {
    const hash = await hashPassword(SENHA);
    expect(await verifyPassword(SENHA, hash)).toBe(true);
    expect(await verifyPassword("outra-coisa", hash)).toBe(false);
  });

  it("campo final VAZIO não aceita senha nenhuma", async () => {
    // O caso mais grave: buffer de zero bytes contra buffer de zero bytes.
    const hash = await comCampoFinal(await hashPassword(SENHA), "");
    expect(await verifyPassword("qualquer-coisa", hash)).toBe(false);
    expect(await verifyPassword(SENHA, hash)).toBe(false);
  });

  it("campo final truncado não aceita senha nenhuma", async () => {
    const original = await hashPassword(SENHA);
    const parts = original.split("$");

    // 32 bytes cabem em 43 caracteres base64url, então truncar tem de parar
    // antes disso — `slice(0, 43)` devolveria o hash inteiro e o teste estaria
    // afirmando que um hash íntegro é recusado.
    expect(parts[5]).toHaveLength(43);

    // Um caractere base64url decodifica para zero bytes; dois, para um byte —
    // que transformaria o KDF numa comparação de 1 em 256.
    for (const n of [1, 2, 4, 8, 20, 42]) {
      const hash = await comCampoFinal(original, parts[5]!.slice(0, n));
      expect(await verifyPassword("qualquer-coisa", hash)).toBe(false);
      // Nem a senha certa: um hash do tamanho errado não é um hash, e fingir
      // que é seria aceitar a comparação de um pedaço só.
      expect(await verifyPassword(SENHA, hash)).toBe(false);
    }
  });

  it("campo final maior que o esperado também é recusado", async () => {
    const original = await hashPassword(SENHA);
    const parts = original.split("$");
    const hash = await comCampoFinal(original, `${parts[5]}AAAA`);
    expect(await verifyPassword(SENHA, hash)).toBe(false);
  });

  it("valores malformados recusam sem lançar", async () => {
    // Recusa e não exceção: um 500 aqui contaria ao atacante que a conta
    // existe, e distinguir "erro" de "senha errada" é a própria informação que
    // a tela de login se esforça para não dar.
    for (const stored of [
      null,
      "",
      "scrypt$1$2$3",
      "bcrypt$16384$8$1$c2FsdA$aGFzaA",
      "scrypt$x$y$z$c2FsdA$aGFzaA",
      "$$$$$",
    ]) {
      await expect(verifyPassword(SENHA, stored)).resolves.toBe(false);
    }
  });
});
