import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { candidateSkill, skill } from "../src/core/db/schema.ts";
import {
  ensureCandidate,
  saveDocument,
  setPublicCv,
  setVisibility,
} from "../src/core/candidate.ts";
import { publicProfile } from "../src/core/candidate-public.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * O perfil público é a única coisa deste sistema que responde sem sessão.
 *
 * Estes testes existem em dois grupos, e o segundo é o que importa: o que a
 * página MOSTRA pode ser corrigido depois; o que ela VAZA não tem desfazer.
 * Estão no mesmo espírito dos testes que afirmam que a chave de API não sai no
 * log e que o servidor não escuta em 0.0.0.0.
 */

let db: DB;
let candidateId: number;

const CV = "# Andreus Timm\n\nSenior AI Software Architect. Piso: 180000 USD/ano.";

beforeEach(async () => {
  db = await useTestDb();
  candidateId = await ensureCandidate({
    slug: "andreus",
    name: "Andreus Timm",
    headline: "Senior AI Software Architect",
    location: "São Paulo, Brazil",
    email: "andreus@zorbit.com.br",
    linkedinUrl: "https://linkedin.com/in/andreus",
    githubUrl: "https://github.com/andreus",
  });
  await saveDocument({ candidateId, kind: "cv", label: "CV", content: CV });
});

afterEach(() => {
  releaseTestDb();
});

async function confirmarSkill(name: string, status = "confirmed") {
  const [row] = await db
    .insert(skill)
    .values({ slug: name.toLowerCase(), canonicalName: name, category: "ai", aliases: [] })
    .returning({ id: skill.id });
  await db.insert(candidateSkill).values({ candidateId, skillId: row!.id, status });
}

describe("quem alcança o perfil", () => {
  it("privado não existe para o mundo", async () => {
    // 404 e não 403: 403 confirmaria que o slug existe, e existência é
    // informação — quem varre uma lista de nomes aprende quais estão
    // cadastrados. `null` aqui é o que a página traduz em 404.
    expect(await publicProfile("andreus")).toBeNull();
  });

  it("`recruiters` também não abre para anônimo", async () => {
    // Aberto a recrutador AUTENTICADO é outra coisa. Confundir os dois seria
    // publicar por engano o perfil de quem escolheu o meio-termo.
    await setVisibility(candidateId, "recruiters");
    expect(await publicProfile("andreus")).toBeNull();
  });

  it("público responde", async () => {
    await setVisibility(candidateId, "public");
    expect((await publicProfile("andreus"))?.name).toBe("Andreus Timm");
  });

  it("slug inexistente devolve o mesmo null de perfil privado", async () => {
    await setVisibility(candidateId, "public");
    expect(await publicProfile("nao-existe")).toBeNull();
  });
});

describe("o que NUNCA sai", () => {
  beforeEach(async () => {
    await setVisibility(candidateId, "public");
    await setPublicCv(candidateId, true);
  });

  it("nem e-mail, nem id, nem qualquer campo fora da lista", async () => {
    const profile = await publicProfile("andreus");
    const chaves = Object.keys(profile!).sort();

    // Lista de permissão afirmada como IGUALDADE, não como "não contém".
    // "Não contém e-mail" passaria com um campo novo que ninguém previu; o
    // conjunto exato falha na hora em que alguém acrescenta coluna ao schema —
    // que é exatamente quando se quer ser avisado.
    expect(chaves).toEqual([
      "cv",
      "githubUrl",
      "headline",
      "linkedinUrl",
      "location",
      "name",
      "skills",
      "slug",
    ]);
  });

  it("o e-mail não aparece nem serializado", async () => {
    // O registro do candidato TEM e-mail; a função é que não o carrega.
    const serializado = JSON.stringify(await publicProfile("andreus"));
    expect(serializado).not.toContain("andreus@zorbit.com.br");
    expect(serializado).not.toContain("@zorbit");
  });

  it("skill detectada e rejeitada não vira skill publicada", async () => {
    // "Detectada" é o que o sistema achou no texto. Publicar isso como fato
    // afirmaria experiência que ninguém conferiu — regra 6.
    await confirmarSkill("LangGraph", "confirmed");
    await confirmarSkill("Kubernetes", "detected");
    await confirmarSkill("Scala", "rejected");

    expect((await publicProfile("andreus"))?.skills).toEqual(["LangGraph"]);
  });
});

describe("o currículo exige o segundo consentimento", () => {
  it("perfil público sem o segundo consentimento não traz o CV", async () => {
    await setVisibility(candidateId, "public");

    // Marcar "público" diz alcançável sem sessão. Publicar o currículo inteiro
    // é outra decisão, e derivá-la da primeira é como se publica um CV sem
    // querer — inclusive o piso salarial que ele costuma conter, que é a
    // posição de negociação do candidato.
    const profile = await publicProfile("andreus");
    expect(profile?.cv).toBeNull();
    expect(JSON.stringify(profile)).not.toContain("180000");
  });

  it("com os dois consentimentos, traz", async () => {
    await setVisibility(candidateId, "public");
    await setPublicCv(candidateId, true);
    expect((await publicProfile("andreus"))?.cv).toContain("Senior AI Software Architect");
  });

  it("o consentimento do CV não vale nada sem o perfil ser público", async () => {
    // Ordem invertida: quem marcou o CV e depois voltou para privado não pode
    // ficar com o consentimento pendurado, pronto para reabrir sozinho.
    await setPublicCv(candidateId, true);
    await setVisibility(candidateId, "private");
    expect(await publicProfile("andreus")).toBeNull();
  });
});
