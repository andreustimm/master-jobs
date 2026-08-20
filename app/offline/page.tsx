import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sem conexão",
  robots: { index: false, follow: false },
};

/**
 * A tela que aparece quando a navegação falha.
 *
 * Estática de propósito: é a única página que precisa funcionar sem servidor, e
 * qualquer dado dinâmico aqui a tornaria incacheável — ou pior, gravaria dado de
 * alguém no cache do shell, que é público.
 *
 * Não oferece "tentar de novo" com JavaScript: recarregar é o que o navegador já
 * faz, e um botão que finge tentar enquanto não há rede é pior que nenhum.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-[34rem] flex-col justify-center py-16">
      <h1 className="type-display-sm mb-2">Sem conexão</h1>
      <p className="type-body-md text-muted-foreground">
        Este sistema lê o acervo de vagas e o seu funil do servidor, então precisa de rede para
        mostrar qualquer coisa. Assim que a conexão voltar, recarregue a página.
      </p>
      <p className="type-body-sm mt-4 text-muted-foreground">
        Nada do que você escreveu se perdeu: o que já tinha sido salvo continua no servidor.
      </p>
    </main>
  );
}
