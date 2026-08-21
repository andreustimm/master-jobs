/**
 * O changelog que o usuário lê.
 *
 * ## Dois arquivos, e por quê
 *
 * `CHANGELOG.md` é técnico: nomes de módulo, decisão de arquitetura, o defeito
 * exato que uma correção fecha. Serve para quem mexe no código.
 *
 * `USER_CHANGELOG.md` é o que aparece no rodapé. Descreve **efeito**, não
 * implementação — "as vagas passaram a mostrar de onde veio a nota", e não
 * "`externalUrl` deixou de devolver booleano". A distinção não é só de tom: o
 * técnico cita caminho de arquivo, nome de coluna e endereço de banco, e nada
 * disso deve sair numa tela que qualquer pessoa logada abre.
 *
 * ## Por que o markdown é lido no servidor, e não convertido em JSON no build
 *
 * O sistema de onde este desenho veio gera `release-notes.json` num passo de
 * build, porque lá o changelog é renderizado por um componente cliente que não
 * consegue ler disco. Aqui toda página é Server Component: dá para ler o
 * arquivo direto, e o JSON gerado seria um terceiro lugar onde a mesma verdade
 * mora — com a chance habitual de ficar para trás do arquivo que o descreve.
 */

/** Uma entrada de versão, como o rodapé a exibe. */
export type VersaoChangelog = {
  versao: string;
  data: string;
  secoes: { titulo: string; itens: string[] }[];
};

const CABECALHO_VERSAO = /^##\s*\[([^\]]+)\]\s*-\s*(\S+)\s*$/;
const CABECALHO_SECAO = /^###\s+(.+?)\s*$/;
const ITEM = /^[-*]\s+(.+?)\s*$/;

/**
 * Lê o markdown e devolve as versões, da mais nova para a mais antiga.
 *
 * Tolerante de propósito: linha solta entre seções, seção sem item, versão sem
 * seção nenhuma — nada disso derruba a leitura. Um changelog é escrito à mão, e
 * um parser rígido transformaria um traço fora do lugar numa tela de erro para
 * quem só queria ver o que mudou.
 *
 * O que ele NÃO tolera é inventar: linha que não casa com nenhum padrão é
 * ignorada, e não vira item.
 */
export function parseUserChangelog(markdown: string): VersaoChangelog[] {
  const versoes: VersaoChangelog[] = [];
  let atual: VersaoChangelog | null = null;
  let secao: { titulo: string; itens: string[] } | null = null;

  for (const linha of markdown.split("\n")) {
    // Os comentários `sem-nota-usuario` marcam versões que não mudaram nada
    // para quem usa. Ficam no arquivo como registro de que a versão existiu e
    // foi considerada — o que não é a mesma coisa que ter sido esquecida.
    if (linha.trimStart().startsWith("<!--")) continue;

    const versao = CABECALHO_VERSAO.exec(linha);
    if (versao) {
      atual = { versao: versao[1]!, data: versao[2]!, secoes: [] };
      secao = null;
      versoes.push(atual);
      continue;
    }

    if (!atual) continue;

    const cabecalho = CABECALHO_SECAO.exec(linha);
    if (cabecalho) {
      secao = { titulo: cabecalho[1]!, itens: [] };
      atual.secoes.push(secao);
      continue;
    }

    const item = ITEM.exec(linha);
    if (item && secao) secao.itens.push(item[1]!);
  }

  // Seção declarada e deixada vazia é ruído na tela: um título sozinho sugere
  // que algo não carregou.
  for (const v of versoes) v.secoes = v.secoes.filter((s) => s.itens.length > 0);

  return versoes;
}

/**
 * A versão que está no ar.
 *
 * Vem do `package.json` porque é de lá que sai a marca de cache do service
 * worker — ver `scripts/sw-version.mjs`. Duas fontes de versão divergiriam, e a
 * que apareceria errada seria justamente a que o usuário lê.
 */
export function versaoAtual(pkg: { version?: unknown }): string {
  return typeof pkg.version === "string" && pkg.version ? pkg.version : "0.0.0";
}
