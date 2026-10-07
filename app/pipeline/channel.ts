import type { Translator } from "../../src/core/i18n/index.ts";

/** Os canais que `jho track --channel` documenta (`application.channel`). */
const KNOWN_CHANNELS = ["direct", "ats", "referral", "recruiter", "agency"] as const;

/**
 * O nome do canal no idioma da tela, ou `undefined` para um valor fora da
 * lista: `channel` é texto livre na CLI, e um canal que a pessoa inventou
 * aparece como ela o gravou, marcado como dado dela.
 */
export function channelLabel(t: Translator["t"], value: string): string | undefined {
  const known = KNOWN_CHANNELS.find((channel) => channel === value.trim().toLowerCase());
  return known ? t(`channels.${known}`) : undefined;
}

/**
 * O rótulo de cada opção do seletor de canal. Dois valores gravados com caixa
 * diferente (`Referral` e `referral`) dariam duas opções com o mesmo nome
 * traduzido, indistinguíveis; esses mostram o valor cru, como dado da pessoa.
 */
export function channelOptionLabel(
  t: Translator["t"],
  options: readonly string[],
): (value: string) => string | undefined {
  const seen = new Map<string, number>();
  for (const option of options) {
    const label = channelLabel(t, option);
    if (label !== undefined) seen.set(label, (seen.get(label) ?? 0) + 1);
  }
  return (value) => {
    const label = channelLabel(t, value);
    return label !== undefined && seen.get(label) === 1 ? label : undefined;
  };
}
