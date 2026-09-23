/**
 * Marca a navegação aberta por um formulário GET da barra de filtros (#218).
 *
 * O pedido automático pendente de um filtro é cancelado por navegação de link
 * ou de histórico, que é a interação mais recente — mas não pelo envio de outro
 * formulário da barra: esse pedido espera e sai depois, com os campos ocultos
 * atualizados. Quem distingue os dois é quem abre a geração: `TransitionGetForm`
 * chama `begin` dentro de `duringFormNavigation`, e os ouvintes do store, que
 * são avisados na mesma pilha, perguntam `isFormNavigation()`.
 *
 * Uma marca por microtarefa não servia: num envio pelo navegador (Enter,
 * clique em Aplicar) há checkpoint de microtarefas entre um ouvinte do
 * `submit` e o seguinte, e a marca caía antes do `begin`.
 */

let active = false;

export function duringFormNavigation(run: () => void): void {
  active = true;
  try {
    run();
  } finally {
    active = false;
  }
}

export function isFormNavigation(): boolean {
  return active;
}
