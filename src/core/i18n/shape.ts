/**
 * O formato de um idioma derivado do dicionário de referência.
 *
 * Mesmas seções, mesmas chaves, todo valor texto. Serve ao dicionário inteiro
 * (`Dictionary`, em `pt-BR.ts`) e a cada fragmento por área: o `<área>.en.ts` é
 * tipado contra o `<área>.pt-BR.ts` do mesmo nome, então a chave que falta, ou
 * que sobra, é erro de compilação no arquivo da área e não só na junção.
 */
export type Translated<Source> = {
  [Section in keyof Source]: { [Key in keyof Source[Section]]: string };
};
