"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

type Status = "idle" | "copied" | "failed";

/**
 * Compartilhar o perfil público (#326): copia a URL atual, sem servidor
 * envolvido — não há nada a decidir do lado de cá além do que já está na
 * barra de endereço.
 *
 * Falha visível, não silenciosa: o navegador pode negar a área de
 * transferência (contexto não seguro, permissão negada), e um botão que finge
 * sucesso nesse caso manda a pessoa colar um link que nunca foi copiado.
 * Uma região `aria-live="polite"` à parte anuncia a confirmação ou a falha —
 * o único jeito de quem usa leitor de tela saber que o clique teve efeito, já
 * que nada move o foco nem abre diálogo.
 */
export function CopyProfileLinkButton({
  label,
  copiedLabel,
  failedLabel,
}: {
  label: string;
  copiedLabel: string;
  failedLabel: string;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Desarma o timer pendente ao trocar de página: sem isto, `setStatus` depois
  // do desmonte não quebra nada em React 19, mas o timer sobrevive à
  // navegação à toa até disparar.
  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  function announce(next: Status) {
    setStatus(next);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setStatus("idle"), 2000);
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      data-testid="public-profile-copy-link"
      className="min-h-11 gap-1.5 xl:h-7 xl:min-h-0"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          announce("copied");
        } catch {
          announce("failed");
        }
      }}
    >
      {status === "copied" && <Check className="size-3.5" aria-hidden />}
      {status === "failed" && <AlertCircle className="size-3.5" aria-hidden />}
      {status === "idle" && <Copy className="size-3.5" aria-hidden />}
      <span aria-hidden={status !== "idle"}>
        {status === "copied" ? copiedLabel : status === "failed" ? failedLabel : label}
      </span>
      {/* Só a confirmação ou a falha entram na região viva: a volta ao rótulo
          neutro depois de 2 s não é notícia. */}
      <span className="sr-only" aria-live="polite">
        {status === "copied" ? copiedLabel : status === "failed" ? failedLabel : ""}
      </span>
    </Button>
  );
}
