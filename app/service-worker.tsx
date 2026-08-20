"use client";

import { useEffect } from "react";

/**
 * Registra o service worker, e nada mais.
 *
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
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Falhar em registrar não pode quebrar o app. Sem service worker ele
        // continua sendo um site que funciona.
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
