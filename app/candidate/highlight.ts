/**
 * Paleta de sintaxe do editor de markdown.
 *
 * Separada do componente porque a decisão aqui é de design, não de React, e
 * porque o teste de contraste precisa conferir a mesma lista que a tela usa.
 *
 * Toda cor sai de `var(--cm-*)`, definido por tema e por modo em
 * `app/themes.css`. Um `HighlightStyle` vira regra CSS injetada no documento,
 * e `var()` resolve na hora da pintura — então um único estilo atende os seis
 * ambientes e acompanha a troca de tema sem recriar o editor. Recriar custaria
 * o histórico de undo e a posição do cursor.
 *
 * O que este arquivo substitui: `defaultHighlightStyle`, do próprio CodeMirror.
 * Ele é honesto sobre o que é — uma paleta de hex fixo para fundo claro — mas
 * o editor a usava nos três temas escuros, onde link dava 1.44:1 e marcador
 * 1.96:1 contra o fundo. Era o azul-marinho sobre preto que aparecia na tela.
 *
 * `tags.list` não recebe cor de propósito, e isso não é esquecimento: o parser
 * marca `OrderedList/...` e `BulletList/...`, o `/...` alcança os descendentes,
 * e num currículo quase tudo é item de lista — pintar essa tag pintaria o
 * documento inteiro. O marcador do item já vem em `processingInstruction`.
 */
import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

export const markdownHighlight = HighlightStyle.define([
  // --- Estrutura do markdown ---------------------------------------------
  // Título é o sinal estrutural mais forte de um currículo. Cor do tema, peso
  // alto, e sem sublinhado: o `#` à esquerda já diz o que a linha é, e o
  // sublinhado do estilo padrão só competia com o dos links.
  { tag: t.heading1, color: "var(--cm-heading)", fontWeight: "700", fontSize: "1.2em" },
  { tag: t.heading2, color: "var(--cm-heading)", fontWeight: "700", fontSize: "1.1em" },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], color: "var(--cm-heading)", fontWeight: "700" },

  // Ênfase é conteúdo. Peso e inclinação já comunicam; cor seria ruído sobre
  // texto que o leitor precisa ler inteiro.
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--cm-marker)" },

  // Rótulo do link é o nome da empresa — é o que se lê. A URL ao lado é
  // máquina, e recua junto com a pontuação. O padrão fazia o inverso.
  { tag: t.link, color: "var(--cm-link)" },
  { tag: t.url, color: "var(--cm-url)" },
  { tag: t.labelName, color: "var(--cm-url)" },

  { tag: t.monospace, color: "var(--cm-code)" },
  { tag: t.quote, color: "var(--cm-quote)", fontStyle: "italic" },
  { tag: t.contentSeparator, color: "var(--cm-marker)", fontWeight: "700" },

  // `#`, `**`, `>`, `-`, `[`, `]`, crases. Recuam, mas seguem acima de 4.5:1:
  // recuar não é sumir, e era exatamente aí que a paleta antiga falhava.
  { tag: [t.processingInstruction, t.escape, t.character], color: "var(--cm-marker)" },

  // --- Blocos de código com linguagem ------------------------------------
  // `codeLanguages` liga parsers reais dentro das cercas. Sem estas linhas o
  // conteúdo cairia todo em `--foreground`: legível, mas sem estrutura.
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: "var(--cm-heading)" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--cm-code)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--cm-quote)", fontStyle: "italic" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--cm-link)" },
  { tag: [t.typeName, t.className, t.namespace], color: "var(--cm-link)" },
  { tag: [t.propertyName, t.attributeName, t.variableName], color: "var(--cm-url)" },
  { tag: t.invalid, color: "var(--cm-invalid)" },
]);
