/**
 * Deriva o perfil de matching de um candidato a partir do currículo dele.
 *
 * ## O problema que isto resolve
 *
 * `job_score` sempre foi por candidato, e o board sempre foi escopado — o
 * isolamento existe desde o começo. O que não existia era o **perfil** de cada
 * um: `candidate_matching_profile` estava vazia e todo mundo caía no
 * `profile.yaml` do dono da instalação. Assumir a identidade de outra pessoa
 * mostrava um board sem ranking, porque ninguém nunca pontuou para ela.
 *
 * ## O que um currículo diz, e o que não diz
 *
 * Um currículo é evidência de **capacidade**: o que a pessoa fez, com que
 * ferramentas, quantas vezes. Não é declaração de **desejo**. Quem trabalhou dez
 * anos com WordPress não está por isso procurando vaga de WordPress.
 *
 * A distinção decide o que se deriva e o que se herda:
 *
 * | Campo | Vem de | Por quê |
 * |---|---|---|
 * | `keywords.strong` / `.stack` | **currículo** | capacidade, e é o que o CV prova |
 * | `keywords.critical` | vazio | ninguém declarou o que é indispensável |
 * | `keywords.negative` | vazio | a lista do padrão é gosto pessoal de quem instalou |
 * | `targets`, `constraints`, `compensation`, `seniority` | padrão | preferência e restrição, que currículo nenhum contém |
 *
 * **`negative` vazio não é descuido.** A lista do `profile.yaml` tem
 * `wordpress`, `cobol`, `unity` — coisas que o dono da instalação não quer.
 * Herdá-la faria o sistema penalizar outra pessoa exatamente pela stack que ela
 * domina, o que é o oposto de ranquear por aderência.
 *
 * **`critical` vazio também não.** Termo com peso ≥ 7 que não aparece na vaga é
 * listado como lacuna para o candidato; afirmar lacuna a partir de algo que ele
 * nunca declarou seria inventar uma exigência dele.
 *
 * ## Sobre os pesos
 *
 * `scoreKeywords` normaliza pelo somatório dos pesos, então o valor absoluto não
 * importa — só a proporção. A escala aqui espelha a do `profile.yaml` (1 a 10)
 * para que um perfil derivado e um escrito à mão sejam legíveis lado a lado.
 *
 * A `confidence` vem do extrator, derivada de onde o termo aparece e quantas
 * vezes — nunca de opinião de modelo. É o único sinal honesto disponível para
 * separar "domina" de "citou uma vez".
 */
import type { Detection } from "../../skills/domain/types.ts";
import type { Profile } from "../../../core/profile/schema.ts";

/**
 * Acima disto, a evidência é forte o bastante para o termo pesar como algo que
 * a pessoa realmente faz — e não como algo que passou pelo texto.
 *
 * 0,7 e não 0,5: o extrator dá confiança alta para menção em seção declarada e
 * repetida, e média para citação solta. O meio da escala deixaria "mencionou
 * Kubernetes num parágrafo" pesando igual a "liderou a migração para
 * Kubernetes".
 */
export const CONFIANCA_FORTE = 0.7;

/** Abaixo disto, a menção é ruído: uma palavra solta não é competência. */
export const CONFIANCA_MINIMA = 0.25;

/** Peso máximo de um termo forte, na escala do `profile.yaml`. */
const PESO_FORTE_MAX = 9;

/** Piso do termo forte. Abaixo de 7 ele deixaria de contar como lacuna. */
const PESO_FORTE_MIN = 7;

const PESO_STACK_MAX = 6;
const PESO_STACK_MIN = 3;

function interpolar(valor: number, de: number, ate: number, min: number, max: number): number {
  if (ate <= de) return max;
  const posicao = Math.min(1, Math.max(0, (valor - de) / (ate - de)));
  return Math.round(min + posicao * (max - min));
}

/**
 * O perfil derivado.
 *
 * `base` entra inteiro e sai com `keywords` trocado: é o que garante que um
 * campo novo no schema não desapareça do perfil derivado só porque esta função
 * não sabia dele.
 */
export function deriveMatchingProfile(base: Profile, deteccoes: Detection[]): Profile {
  const relevantes = deteccoes
    .filter((d) => d.confidence >= CONFIANCA_MINIMA)
    // Mais confiante primeiro: quem lê o perfil derodado vê primeiro o que o
    // currículo mais sustenta.
    .sort((a, b) => b.confidence - a.confidence || a.skill.name.localeCompare(b.skill.name));

  const fortes = relevantes.filter((d) => d.confidence >= CONFIANCA_FORTE);
  const restantes = relevantes.filter((d) => d.confidence < CONFIANCA_FORTE);

  return {
    ...base,
    keywords: {
      // Ver o cabeçalho: os dois vazios são decisão, não omissão.
      critical: [],
      negative: [],
      strong: fortes.map((d) => ({
        term: d.skill.name.toLowerCase(),
        weight: interpolar(d.confidence, CONFIANCA_FORTE, 1, PESO_FORTE_MIN, PESO_FORTE_MAX),
      })),
      stack: restantes.map((d) => ({
        term: d.skill.name.toLowerCase(),
        weight: interpolar(d.confidence, CONFIANCA_MINIMA, CONFIANCA_FORTE, PESO_STACK_MIN, PESO_STACK_MAX),
      })),
    },
  };
}

/**
 * O currículo sustenta um perfil?
 *
 * Um texto curto ou sem nenhuma skill reconhecida produziria um perfil com
 * `keywords` vazio, e `scoreKeywords` normaliza pelo somatório dos pesos —
 * somatório zero faria todo mundo empatar. Melhor não derivar e deixar o board
 * sem ranking, com o convite a subir um currículo de verdade, do que produzir
 * um ranking que é ruído com aparência de ordem.
 */
export function curriculoSustentaPerfil(deteccoes: Detection[]): boolean {
  return deteccoes.some((d) => d.confidence >= CONFIANCA_MINIMA);
}
