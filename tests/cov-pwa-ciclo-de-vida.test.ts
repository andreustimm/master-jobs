/**
 * O ciclo de vida do service worker depois do `stop`, e os rótulos que a
 * transição recusa.
 *
 * ## Por que o `stopped` aparece em quatro lugares
 *
 * `startServiceWorkerUpdateLifecycle` registra ouvintes e dispara um `register()`
 * assíncrono. A função de parada é chamada quando o componente desmonta — e nesse
 * instante o `register()` pode ainda estar no ar. Quatro caminhos precisam
 * respeitar a parada:
 *
 * 1. o `report` de erro, senão um erro de registro aparece na tela de quem já
 *    saiu dela;
 * 2. o `update()`, que chamaria `registration.update()` de um registro
 *    abandonado;
 * 3. o `then` do registro, que guardaria a referência depois da parada;
 * 4. o `controllerchange`, que recarregaria a página inteira.
 *
 * O quarto é o pior: recarregar depois do desmonte joga fora o que a pessoa
 * estava fazendo, e o gatilho vem do navegador, não do código.
 *
 * ## E `validateTransitionLabels`
 *
 * Os rótulos chegam do dicionário, que é dado carregado. Um rótulo vazio deixaria
 * a tela de transição em branco durante a espera — sem texto nenhum, a pessoa não
 * sabe se a página travou.
 */
import { describe, expect, it } from "vitest";
import {
  startServiceWorkerUpdateLifecycle,
  type WorkerContainerPort,
  type WorkerRegistrationPort,
  type VisibilityPort,
} from "../src/core/pwa/service-worker-update.ts";
import {
  INITIAL_NAVIGATION_TRANSITION,
  reduceTransition,
  validateTransitionLabels,
} from "../src/core/pwa/transition.ts";

/** Portas de mentira com controle manual sobre quando o registro resolve. */
function bancada(opts: { controlado?: boolean; falhaNoRegistro?: unknown } = {}) {
  const ouvintesContainer = new Set<() => void>();
  const ouvintesVisibilidade = new Set<() => void>();
  const atualizacoes: number[] = [];
  const erros: unknown[] = [];
  const recargas: number[] = [];
  let resolverRegistro: ((registro: WorkerRegistrationPort) => void) | undefined;
  let rejeitarRegistro: ((erro: unknown) => void) | undefined;

  const registro: WorkerRegistrationPort = {
    update: async () => void atualizacoes.push(atualizacoes.length),
  };

  const container: WorkerContainerPort = {
    controller: opts.controlado ? {} : null,
    register: () =>
      new Promise<WorkerRegistrationPort>((resolve, reject) => {
        resolverRegistro = resolve;
        rejeitarRegistro = reject;
        if (opts.falhaNoRegistro !== undefined) reject(opts.falhaNoRegistro);
      }),
    addEventListener: (_type, listener) => void ouvintesContainer.add(listener),
    removeEventListener: (_type, listener) => void ouvintesContainer.delete(listener),
  };

  const visibility: VisibilityPort = {
    visibilityState: "visible",
    addEventListener: (_type, listener) => void ouvintesVisibilidade.add(listener),
    removeEventListener: (_type, listener) => void ouvintesVisibilidade.delete(listener),
  };

  const parar = startServiceWorkerUpdateLifecycle({
    container,
    visibility,
    reload: () => void recargas.push(recargas.length),
    report: (erro) => void erros.push(erro),
  });

  return {
    parar,
    atualizacoes,
    erros,
    recargas,
    visibility,
    resolverRegistro: () => resolverRegistro?.(registro),
    rejeitarRegistro: (erro: unknown) => rejeitarRegistro?.(erro),
    trocarControlador: () => {
      for (const ouvinte of ouvintesContainer) ouvinte();
    },
    mudarVisibilidade: () => {
      for (const ouvinte of ouvintesVisibilidade) ouvinte();
    },
    ouvintesVivos: () => ouvintesContainer.size + ouvintesVisibilidade.size,
  };
}

describe("depois de parar o ciclo de vida", () => {
  it("UT-420 o registro que chega tarde não é guardado nem atualizado", async () => {
    const b = bancada();

    b.parar();
    b.resolverRegistro();
    await Promise.resolve();
    await Promise.resolve();

    // Nada de `update()`: o registro chegou para um ciclo que já terminou.
    expect(b.atualizacoes).toEqual([]);
    // E os dois ouvintes saíram.
    expect(b.ouvintesVivos()).toBe(0);
  });

  it("UT-421 erro de registro depois da parada não é reportado", async () => {
    const b = bancada();

    b.parar();
    b.rejeitarRegistro(new Error("sem rede"));
    await Promise.resolve();
    await Promise.resolve();

    // Reportar aqui mostraria erro na tela de quem já saiu dela.
    expect(b.erros).toEqual([]);
  });

  it("UT-422 erro ANTES da parada é reportado: é o par que prova a guarda", async () => {
    const b = bancada({ falhaNoRegistro: new Error("sem rede") });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(b.erros).toHaveLength(1);
    expect((b.erros[0] as Error).message).toBe("sem rede");
    b.parar();
  });

  it("UT-423 troca de controlador depois da parada não recarrega a página", async () => {
    // O caso mais grave. O gatilho vem do navegador, e recarregar depois do
    // desmonte joga fora o que a pessoa estava fazendo.
    const b = bancada({ controlado: true });
    b.resolverRegistro();
    await Promise.resolve();

    b.parar();
    b.trocarControlador();

    expect(b.recargas).toEqual([]);
  });

  it("UT-424 e antes da parada, com página controlada, ela recarrega UMA vez", async () => {
    const b = bancada({ controlado: true });
    b.resolverRegistro();
    await Promise.resolve();

    b.trocarControlador();
    b.trocarControlador();

    // A segunda troca é engolida: duas recargas seguidas cancelariam a primeira.
    expect(b.recargas).toHaveLength(1);
    b.parar();
  });

  it("UT-425 página não controlada não recarrega na primeira troca", async () => {
    // Primeira visita: não havia worker controlando, então a troca é a instalação
    // inicial. Recarregar ali seria recarregar a página que acabou de abrir.
    const b = bancada({ controlado: false });
    b.resolverRegistro();
    await Promise.resolve();

    b.trocarControlador();

    expect(b.recargas).toEqual([]);
    b.parar();
  });

  it("UT-426 voltar para a aba pede atualização; parado, não pede", async () => {
    const b = bancada();
    b.resolverRegistro();
    await Promise.resolve();
    const antes = b.atualizacoes.length;

    b.mudarVisibilidade();
    expect(b.atualizacoes.length).toBeGreaterThan(antes);

    const depoisDeVisivel = b.atualizacoes.length;
    b.parar();
    b.mudarVisibilidade();
    expect(b.atualizacoes).toHaveLength(depoisDeVisivel);
  });
});

describe("os rótulos da transição", () => {
  const completos = {
    loading: "Carregando",
    updating: "Atualizando",
    prolonged: "Ainda carregando",
    offlineTitle: "Sem conexão",
    offlineBody: "Verifique a rede",
    retry: "Tentar de novo",
    failedTitle: "Não foi possível abrir",
    failedBody: "Tente outra vez",
  };

  it("UT-427 o conjunto completo passa e volta inalterado", () => {
    expect(validateTransitionLabels(completos)).toEqual(completos);
  });

  it("UT-428 o que não é objeto simples é recusado", () => {
    // `plainRecord` recusa array, null e instância com protótipo — o dicionário é
    // dado carregado, e um valor hostil não pode virar rótulo.
    for (const ruim of [null, undefined, "loading", 42, [], new Map()]) {
      expect(() => validateTransitionLabels(ruim), String(ruim)).toThrow(TypeError);
    }
  });

  it("UT-429 rótulo faltando, vazio ou só espaço é recusado nomeando a chave", () => {
    for (const chave of Object.keys(completos)) {
      for (const valor of [undefined, "", "   ", 42]) {
        expect(
          () => validateTransitionLabels({ ...completos, [chave]: valor }),
          `${chave}=${String(valor)}`,
        ).toThrow(new RegExp(chave));
      }
    }
  });
});

describe("os eventos que a máquina de transição ignora", () => {
  const iniciada = reduceTransition(INITIAL_NAVIGATION_TRANSITION, {
    type: "start",
    target: "/jobs",
    at: 1_000,
    soft: false,
  });

  it("UT-430 `prolonged` sobre fase que não é `loading` não muda nada", () => {
    // Já offline, o aviso de "ainda carregando" seria contradição na tela.
    const offline = reduceTransition(iniciada, {
      type: "offline",
      target: "/jobs",
      generation: iniciada.generation,
    });

    const depois = reduceTransition(offline, {
      type: "prolonged",
      generation: offline.generation,
    });

    expect(depois).toBe(offline);
  });

  it("UT-431 `leave` sem a URL confirmada não muda nada", () => {
    // Sair da transição antes de a rota chegar mostraria a tela antiga como se a
    // navegação tivesse terminado.
    const depois = reduceTransition(iniciada, {
      type: "leave",
      generation: iniciada.generation,
    });

    expect(depois).toBe(iniciada);
  });

  it("UT-432 e com a URL confirmada, `leave` avança", () => {
    const confirmada = reduceTransition(iniciada, {
      type: "url-committed",
      url: "/jobs",
      generation: iniciada.generation,
    });

    const saindo = reduceTransition(confirmada, {
      type: "leave",
      generation: confirmada.generation,
    });

    expect(saindo.phase).toBe("leaving");
  });
});
