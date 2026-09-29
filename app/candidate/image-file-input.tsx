"use client";

import type { ComponentProps } from "react";
import { Input } from "@/components/ui/input";

/**
 * Seletor de imagem que recusa, no navegador, arquivo acima do teto (#327).
 *
 * Não é a checagem que vale — o servidor confere tamanho, assinatura e
 * dimensão de novo. Existe porque arquivo acima de 4,5 MB nem chega à action
 * na Vercel (413 antes dela), e a tela só mostraria o erro genérico. Com a
 * validade do campo marcada, o navegador não envia o formulário e mostra a
 * mesma mensagem do dicionário que o servidor usaria.
 *
 * Isso segura também "Remover" e salvar só o "mostrar": o arquivo selecionado
 * iria junto no corpo e daria o mesmo 413. A pessoa limpa o seletor antes.
 */
export function ImageFileInput({
  maxBytes,
  tooLargeMessage,
  ...props
}: Omit<ComponentProps<typeof Input>, "type" | "onChange"> & { maxBytes: number; tooLargeMessage: string }) {
  return (
    <Input
      {...props}
      type="file"
      onChange={(event) => {
        const input = event.currentTarget;
        const file = input.files?.[0];
        input.setCustomValidity(file && file.size > maxBytes ? tooLargeMessage : "");
        if (!input.checkValidity()) input.reportValidity();
      }}
    />
  );
}
