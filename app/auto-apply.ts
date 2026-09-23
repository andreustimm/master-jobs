/**
 * Filtro que se aplica sozinho (#218): as regras, sem DOM, sem relógio.
 *
 * O controle "confirma" quando a pessoa termina o gesto — solta o slider, sai
 * do campo numérico, escolhe no select — e o texto confirma quando ela para de
 * digitar. Arrastar o slider não navega: só o gesto completo pede a lista.
 *
 * Os tempos vieram do uso, não de regra: 300 ms basta para juntar setas
 * seguidas no slider, e 400 ms é a pausa de quem ainda está digitando uma
 * palavra. Três caracteres é o mínimo que o pré-filtro trigrama da busca por
 * termo (#214) consegue usar; abaixo disso a consulta varre tudo e o resultado
 * ainda não diz nada. Enter e o botão Aplicar continuam valendo na hora, para
 * qualquer tamanho — é assim que se busca "HP".
 */

export const AUTO_APPLY_CONTROL_MS = 300;
export const AUTO_APPLY_TEXT_MS = 400;
export const AUTO_APPLY_MIN_CHARS = 3;

/**
 * O texto digitado pede a lista?
 *
 * `applied` é o valor que a URL já aplica. Igual a ele, não há o que pedir.
 * Apagar tudo é um pedido legítimo (tirar o filtro); um ou dois caracteres,
 * não.
 */
export function textReady(value: string, applied: string, minChars = AUTO_APPLY_MIN_CHARS): boolean {
  const typed = value.trim();
  if (typed === applied.trim()) return false;
  if (typed === "") return true;
  return typed.length >= minChars;
}

/**
 * As duas URLs levam à mesma lista?
 *
 * A ordem dos parâmetros não muda o filtro: o formulário escreve na ordem dos
 * campos, e o link que trouxe a pessoa até aqui, na ordem de `toParams`.
 */
export function sameDestination(a: string, b: string): boolean {
  let left: URL;
  let right: URL;
  try {
    left = new URL(a);
    right = new URL(b);
  } catch {
    return false;
  }
  if (left.origin !== right.origin || left.pathname !== right.pathname) return false;
  const sorted = (url: URL) =>
    [...url.searchParams.entries()]
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .sort()
      .join("&");
  return sorted(left) === sorted(right);
}

type Timer = unknown;

export type AutoSubmitterDeps = {
  setTimer: (callback: () => void, delay: number) => Timer;
  clearTimer: (timer: Timer) => void;
  /** Há navegação em voo, ainda sem a URL confirmada? */
  busy: () => boolean;
  /** Avisa quando `busy` pode ter mudado; devolve o cancelamento. */
  subscribe: (listener: () => void) => () => void;
  submit: () => void;
};

export type AutoSubmitter = {
  /** Pede a aplicação depois de `delay`; um novo pedido substitui o anterior. */
  schedule: (delay: number) => void;
  /** Esquece o pedido pendente — o envio manual já cuidou dele. */
  cancel: () => void;
  /** Existe pedido esperando o tempo ou a navegação anterior? */
  pending: () => boolean;
  dispose: () => void;
};

/**
 * Um pedido por formulário, e o último vence.
 *
 * Se a navegação anterior ainda não confirmou a URL, o envio espera por ela:
 * os campos ocultos do formulário carregam o resto do filtro, e só depois da
 * resposta eles trazem o que acabou de ser aplicado. Enviar antes perderia o
 * filtro anterior — a busca digitada logo depois do slider desfaria o slider.
 */
export function createAutoSubmitter(deps: AutoSubmitterDeps): AutoSubmitter {
  let timer: Timer | null = null;
  let unsubscribe: (() => void) | null = null;

  const stopWaiting = () => {
    unsubscribe?.();
    unsubscribe = null;
  };

  const clear = () => {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
    stopWaiting();
  };

  const fire = () => {
    timer = null;
    if (!deps.busy()) {
      deps.submit();
      return;
    }
    unsubscribe = deps.subscribe(() => {
      if (deps.busy()) return;
      stopWaiting();
      // Não envia dentro do aviso: ele chega no meio do commit da resposta
      // anterior, antes de os campos conferirem o valor que ela trouxe. Enviar
      // ali registraria o texto novo como já enviado, e o campo adotaria o
      // valor velho da resposta. Um intervalo zero deixa o commit terminar.
      timer = deps.setTimer(fire, 0);
    });
  };

  return {
    schedule(delay) {
      clear();
      timer = deps.setTimer(fire, delay);
    },
    cancel: clear,
    pending: () => timer !== null || unsubscribe !== null,
    dispose: clear,
  };
}
