"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Compartilhar o perfil público (#326): copia a URL atual, sem servidor
 * envolvido — não há nada a decidir do lado de cá além do que já está na
 * barra de endereço. Falha silenciosa quando o navegador nega a área de
 * transferência (contexto não seguro, permissão negada): o botão não finge
 * sucesso que não aconteceu.
 */
export function CopyProfileLinkButton({
  label,
  copiedLabel,
}: {
  label: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);

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
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Sem permissão de área de transferência: nada a mostrar como êxito.
        }
      }}
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {copied ? copiedLabel : label}
    </Button>
  );
}
