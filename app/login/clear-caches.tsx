"use client";

import { useEffect } from "react";

/**
 * Manda o service worker esvaziar o cache privado, depois do logout.
 *
 * O `contas_casal` tem uma fronteira de sessão offline inteira para isto —
 * Dexie, Cache Storage, fila de uploads, outbox — porque lá o dado offline é
 * real. Aqui a superfície é menor de propósito: o service worker não guarda
 * página autenticada nenhuma, então o que sobra a limpar é o shell e o que
 * algum navegador tenha decidido guardar por conta própria.
 *
 * A limpeza acontece mesmo assim, e por dois motivos. O primeiro é que "não
 * cacheia hoje" não é garantia sobre amanhã: quem acrescentar uma rota à lista
 * de cacheáveis não vai lembrar de escrever a limpeza. O segundo é que o
 * estático fica — é público e é o que permite o shell abrir na próxima vez.
 *
 * Sem `await`: o logout já aconteceu no servidor, e a sessão já está revogada.
 * Segurar a tela de login esperando o cache não protege nada.
 */
export function ClearCachesOnLogout() {
  useEffect(() => {
    const controller = navigator.serviceWorker?.controller;
    controller?.postMessage({ type: "clear-private-caches" });
  }, []);

  return null;
}
