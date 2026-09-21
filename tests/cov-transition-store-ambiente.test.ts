/**
 * A store de transição fora do caminho felizmente injetado.
 *
 * `tests/pwa-transition.test.ts` cobre a máquina de estados passando TODAS as
 * dependências — relógio, temporizador, URL, navegação dura, fontes de evento.
 * É o jeito certo de testar a lógica, e deixa sem exercitar justamente a parte
 * que decide como a store se liga ao mundo:
 *
 * - `browserOptions()`, que em produção lê `window.location` e
 *   `navigator.serviceWorker`;
 * - o ambiente SEM `window`, que é como o módulo é avaliado no servidor —
 *   `transitionStore` é criada no topo do arquivo, então o Server Component que
 *   importa qualquer coisa dali executa este caminho em toda renderização;
 * - as recusas por URL ausente, por geração obsoleta e por store destruída.
 *
 * Uma exceção em `browserOptions()` durante o SSR não quebraria a transição:
 * quebraria a página inteira, antes de qualquer HTML sair.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTransitionStore,
  type TransitionEventSource,
} from "../src/core/pwa/transition-store.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Fonte de evento que guarda o que foi registrado e permite disparar. */
function fonte() {
  const ouvintes = new Map<string, Set<(evento: unknown) => void>>();
  const source: TransitionEventSource = {
    addEventListener(tipo, ouvinte) {
      const atual = ouvintes.get(tipo) ?? new Set();
      atual.add(ouvinte);
      ouvintes.set(tipo, atual);
    },
    removeEventListener(tipo, ouvinte) {
      ouvintes.get(tipo)?.delete(ouvinte);
    },
  };
  return {
    source,
    tipos: () => [...ouvintes.keys()].sort(),
    emitir(tipo: string, evento: unknown = {}): void {
      for (const ouvinte of ouvintes.get(tipo) ?? []) ouvinte(evento);
    },
  };
}

describe("no servidor, onde não existe window", () => {
  it("UT-260 criar a store sem window não estoura e nenhuma navegação começa", () => {
    // `typeof window === "undefined"` é o ambiente do worker do Vitest, que é
    // também o do Node servindo a página. A store precisa nascer inerte, não
    // precisa nascer quebrada.
    const store = createTransitionStore();

    expect(store.getSnapshot().phase).toBe("idle");
    // Sem `location`, não há base para resolver o destino — e sem base, a
    // classificação de destino seria um palpite.
    expect(store.begin("/jobs")).toBeNull();
    // Os mesmos caminhos pelo lado do commit e do offline: sem base, nada muda.
    store.commit("/jobs");
    store.offline("/jobs");
    expect(store.getSnapshot().phase).toBe("idle");
    store.destroy();
  });

  it("UT-261 sem `navigator` a store também nasce, sem ouvinte de service worker", () => {
    // O Node passou a expor `navigator` global, mas o caminho sem ele continua
    // no código porque é o que um runtime de borda mais enxuto oferece.
    vi.stubGlobal("navigator", undefined);

    const store = createTransitionStore({ currentUrl: () => "https://jobs.example/jobs" });

    expect(store.getSnapshot().phase).toBe("idle");
    store.destroy();
  });

  it("UT-262 sem `performance` o relógio vale zero em vez de estourar", () => {
    // `performance.now()` é o relógio monotônico do navegador. Onde ele não
    // existe, a alternativa é zero — e zero é aceitável porque o único uso é
    // medir a duração mínima da transição, que no servidor não acontece.
    vi.stubGlobal("performance", undefined);

    const store = createTransitionStore({
      currentUrl: () => "https://jobs.example/jobs",
      setTimer: () => 0,
      clearTimer: () => undefined,
    });
    store.begin("/pipeline");

    expect(store.getSnapshot().startedAt).toBe(0);
    store.destroy();
  });
});

describe("no navegador, pelos padrões que a produção usa", () => {
  /** Um `window` mínimo: o que `browserOptions()` de fato toca. */
  function janela(href: string) {
    const destinos: string[] = [];
    const ouvintes = new Map<string, Set<(evento: unknown) => void>>();
    const win = {
      location: {
        href,
        assign: (alvo: string) => void destinos.push(alvo),
      },
      addEventListener(tipo: string, ouvinte: (evento: unknown) => void) {
        const atual = ouvintes.get(tipo) ?? new Set();
        atual.add(ouvinte);
        ouvintes.set(tipo, atual);
      },
      removeEventListener(tipo: string, ouvinte: (evento: unknown) => void) {
        ouvintes.get(tipo)?.delete(ouvinte);
      },
    };
    return {
      win,
      destinos,
      /** Tipos com ouvinte VIVO — `removeEventListener` esvazia o conjunto. */
      tipos: () => [...ouvintes].filter(([, set]) => set.size > 0).map(([tipo]) => tipo).sort(),
      emitir(tipo: string, evento: unknown = {}): void {
        for (const ouvinte of ouvintes.get(tipo) ?? []) ouvinte(evento);
      },
    };
  }

  it("UT-263 a store lê a URL do `location`, ouve a conectividade e navega duro no retry", () => {
    const janelaFalsa = janela("https://jobs.example/jobs");
    vi.stubGlobal("window", janelaFalsa.win);

    // Nenhuma opção: exatamente como `transitionStore` nasce no módulo.
    const store = createTransitionStore();

    // A URL vem de `location.href`, e a transição começa por causa dela.
    expect(store.begin("/pipeline")).toBe(1);
    expect(store.getSnapshot().target).toBe("/pipeline");
    // Os dois eventos de conectividade são registrados na própria janela.
    expect(janelaFalsa.tipos()).toEqual(["offline", "online"]);

    // `offline` emitido pela janela leva o alvo corrente para o estado offline —
    // é assim que a tela sabe avisar sem esperar o tempo esgotar.
    janelaFalsa.emitir("offline");
    expect(store.getSnapshot().phase).toBe("offline");

    // E o retry sai do roteador do cliente para uma navegação de documento:
    // `location.assign`. É o único caminho que atravessa um service worker
    // preso a uma resposta que nunca vem.
    store.retry();
    expect(janelaFalsa.destinos).toEqual(["/pipeline"]);

    // O segundo retry da MESMA geração é engolido: dois `assign` seguidos
    // cancelariam o primeiro carregamento no meio.
    store.retry();
    expect(janelaFalsa.destinos).toEqual(["/pipeline"]);

    store.destroy();
    expect(janelaFalsa.tipos()).toEqual([]);
  });

  it("UT-264 `offline` da janela sem alvo corrente não inventa transição", () => {
    const janelaFalsa = janela("https://jobs.example/jobs");
    vi.stubGlobal("window", janelaFalsa.win);
    const store = createTransitionStore();

    // Perder a rede parado numa tela não é uma navegação falhando. Sem alvo, o
    // aviso de "sem conexão" apareceria sem que nada estivesse carregando.
    janelaFalsa.emitir("offline");

    expect(store.getSnapshot().phase).toBe("idle");
    store.destroy();
  });
});

describe("o que a store recusa depois de destruída ou fora de geração", () => {
  function comRelogio() {
    const worker = fonte();
    let agora = 0;
    const store = createTransitionStore({
      now: () => agora,
      setTimer: () => 0,
      clearTimer: () => undefined,
      currentUrl: () => "https://jobs.example/jobs",
      hardNavigate: () => undefined,
      connectivity: null,
      serviceWorker: worker.source,
    });
    return { store, worker, avancar: (ms: number) => void (agora += ms) };
  }

  it("UT-265 destruída, `offline` não muda mais nada e `subscribe` devolve um cancelamento inerte", () => {
    const { store } = comRelogio();
    store.begin("/pipeline");
    store.destroy();

    store.offline("/pipeline");
    expect(store.getSnapshot().phase).toBe("loading");

    // Assinar depois de destruir é o que um componente desmontando pode tentar.
    // Devolver uma função que não faz nada evita que ele guarde uma referência
    // para um conjunto de ouvintes que ninguém mais notifica.
    let chamado = 0;
    const cancelar = store.subscribe(() => void (chamado += 1));
    store.offline("/pipeline");
    expect(chamado).toBe(0);
    expect(() => cancelar()).not.toThrow();
  });

  it("UT-266 destino que não resolve é recusado em begin, commit e offline", () => {
    const { store } = comRelogio();

    // Outra origem não é navegação de tela: é sair do aplicativo.
    expect(store.begin("https://outra.example/jobs")).toBeNull();
    expect(store.getSnapshot().phase).toBe("idle");

    store.begin("/pipeline");
    // Commit de uma URL que não normaliza não pode marcar a transição como
    // concluída — a tela ficaria pronta sem a rota ter chegado.
    store.commit("http://[inválido");
    expect(store.getSnapshot().committed).toBe(false);

    store.offline("http://[inválido");
    expect(store.getSnapshot().phase).toBe("loading");
  });

  it("UT-267 mensagem do worker que não é objeto, ou não é a acordada, é ignorada", () => {
    const { store, worker } = comRelogio();
    store.begin("/pipeline");

    // O canal é público: qualquer script na página pode postar nele. Só a forma
    // exata acordada vira estado, e o resto sai sem efeito e sem exceção.
    for (const hostil of [undefined, null, "navigation-offline", 42]) {
      worker.emitir("message", hostil);
      expect(store.getSnapshot().phase, String(hostil)).toBe("loading");
    }
    worker.emitir("message", { data: { type: "navigation-offline" } });
    expect(store.getSnapshot().phase).toBe("loading");
    worker.emitir("message", { data: { type: "outra-coisa", url: "/pipeline" } });
    expect(store.getSnapshot().phase).toBe("loading");

    // E a forma exata funciona, provando que a recusa acima não é a store inerte.
    worker.emitir("message", { data: { type: "navigation-offline", url: "/pipeline" } });
    expect(store.getSnapshot().phase).toBe("offline");
  });
});
