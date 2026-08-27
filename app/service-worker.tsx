"use client";

import { useEffect } from "react";
import { startServiceWorkerUpdateLifecycle } from "../src/core/pwa/service-worker-update.ts";

/**
 * Client Component minúsculo porque `navigator.serviceWorker` não existe no
 * servidor. Não renderiza nada: a PWA não deve mudar a aparência de quem abre
 * pelo navegador comum.
 *
 * Só em produção. Em desenvolvimento o Next reconstrói a cada salvamento, e um
 * service worker servindo estático da versão anterior transforma cada alteração
 * numa caça ao fantasma — o arquivo mudou no disco e a tela não muda.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    // Depois do `load`: registrar durante a hidratação disputa banda com o
    // conteúdo que a pessoa está esperando ver.
    let stopUpdateLifecycle: () => void = () => undefined;
    const register = () => {
      stopUpdateLifecycle = startServiceWorkerUpdateLifecycle({
        container: navigator.serviceWorker,
        visibility: document,
        reload: () => window.location.reload(),
        report: (error) => {
          // A PWA é melhoria progressiva: a falha fica observável no console,
          // enquanto o site continua funcionando pela rede.
          console.warn("Service worker update failed.", error);
        },
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => {
      window.removeEventListener("load", register);
      stopUpdateLifecycle();
    };
  }, []);

  return null;
}
