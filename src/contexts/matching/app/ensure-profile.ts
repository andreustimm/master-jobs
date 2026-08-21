/**
 * Garante que o candidato tenha um perfil de matching próprio.
 *
 * É o "não, mas tem CV? deriva do CV, salva, pontua" do fluxo decidido em
 * 21/08/2026. A pontuação em si fica fora daqui de propósito: derivar é uma
 * decisão de domínio e é barata; pontuar escreve milhares de linhas e pertence a
 * quem escolheu a hora de fazê-lo.
 */
import { currentDocument } from "../../../core/candidate.ts";
import { extractSkills } from "../../skills/domain/extractor.ts";
import { listCatalog } from "../../skills/index.ts";
import { curriculoSustentaPerfil, deriveMatchingProfile } from "../domain/derive.ts";
import {
  loadCandidateMatchingProfile,
  saveCandidateMatchingProfile,
} from "../infra/drizzle-profile.ts";

export type ResultadoPerfil =
  /** Já tinha perfil próprio. Nada foi tocado. */
  | { estado: "ja-tinha" }
  /** Derivado do currículo e salvo agora. */
  | { estado: "derivado"; termos: number }
  /** Sem currículo salvo — nada de que derivar. */
  | { estado: "sem-curriculo" }
  /** Tem currículo, mas dele não sai perfil que sustente ranking. */
  | { estado: "curriculo-fraco" }
  /**
   * O catálogo de skills está vazio, então a extração não tem contra o que
   * comparar e devolveria nada para QUALQUER currículo.
   *
   * Estado próprio, e não "currículo fraco", porque a correção é oposta: aqui o
   * problema é da instalação (`jho skills seed`), não do texto que a pessoa
   * subiu. Diagnosticar errado mandaria alguém reescrever um currículo que está
   * ótimo.
   */
  | { estado: "catalogo-vazio" };

/**
 * Deriva e salva, quando faz sentido.
 *
 * Não sobrescreve perfil existente: quem editou o próprio perfil decidiu algo
 * que um currículo não sabe, e recalcular por cima apagaria essa decisão a cada
 * carga de página.
 */
export async function ensureMatchingProfile(candidateId: number): Promise<ResultadoPerfil> {
  const atual = await loadCandidateMatchingProfile(candidateId);
  if (atual.source === "candidate") return { estado: "ja-tinha" };

  const documento = await currentDocument(candidateId, "cv");
  if (!documento?.content?.trim()) return { estado: "sem-curriculo" };

  const catalogo = await listCatalog();
  // Antes de julgar o currículo, conferir a ferramenta. `extractSkills` devolve
  // lista vazia quando o catálogo é vazio, e sem esta distinção todo candidato
  // de uma instalação sem `jho skills seed` seria diagnosticado com "currículo
  // fraco" — mandando as pessoas reescreverem textos que estão ótimos.
  if (catalogo.length === 0) return { estado: "catalogo-vazio" };

  const deteccoes = extractSkills(documento.content, catalogo);

  // Currículo de onde não sai skill nenhuma produziria `keywords` vazio, e
  // `scoreKeywords` normaliza pelo somatório dos pesos: somatório zero faz todo
  // mundo empatar. Um ranking que é ruído com aparência de ordem é pior que
  // board sem ranking, porque o segundo pelo menos é honesto.
  if (!curriculoSustentaPerfil(deteccoes)) return { estado: "curriculo-fraco" };

  // `atual.profile` aqui é o padrão da instalação: entra inteiro e sai com
  // `keywords` trocado, para que campo novo no schema não suma do derivado.
  const derivado = deriveMatchingProfile(atual.profile, deteccoes);
  await saveCandidateMatchingProfile(candidateId, derivado);

  return {
    estado: "derivado",
    termos: derivado.keywords.strong.length + derivado.keywords.stack.length,
  };
}
