import type * as React from "react";

/**
 * Barra de esqueleto: a forma do conteúdo que ainda não chegou.
 *
 * Só `--muted` (via `bg-muted`) e escala do Tailwind — nada de cor ou medida
 * própria, para que os seis ambientes de tema a desenhem sem exceção. É
 * decorativa (`aria-hidden`): quem anuncia a espera é `LoadingRegion`, em texto
 * do dicionário, e não uma pilha de retângulos sem nome.
 */
export function SkeletonBar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block rounded-md bg-muted motion-safe:animate-pulse ${className ?? ""}`.trim()}
    />
  );
}

/**
 * Região que espera dados: `aria-busy` diz à tecnologia assistiva que o trecho
 * está incompleto, e o `role="status"` lê uma vez o que está carregando.
 *
 * O aviso fica FORA do trecho ocupado: mudança dentro de `aria-busy="true"`
 * pode ser adiada ou ignorada pelo leitor de tela até o trecho desocupar, e
 * este trecho nunca desocupa — é trocado inteiro quando o conteúdo chega.
 *
 * Sem dado nenhum dentro, por construção: o esqueleto é o mesmo para qualquer
 * sessão, então não há como ele mostrar a tela de outra pessoa enquanto a nova
 * não chega.
 */
export function LoadingRegion({
  label,
  testId,
  className,
  children,
}: {
  label: string;
  testId: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div data-testid={testId} className={className}>
      <p role="status" className="sr-only">
        {label}
      </p>
      <div aria-busy="true" className="contents">
        {children}
      </div>
    </div>
  );
}
