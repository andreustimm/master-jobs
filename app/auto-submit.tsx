"use client";

import { useEffect, useRef, useState, type ComponentProps, type RefObject } from "react";
import { Input } from "@/components/ui/input";
import { transitionStore } from "../src/core/pwa/transition-store.ts";
import {
  AUTO_APPLY_MIN_CHARS,
  AUTO_APPLY_TEXT_MS,
  createAutoSubmitter,
  sameDestination,
  textReady,
  type AutoSubmitter,
} from "./auto-apply.ts";

/**
 * A ilha que aplica o filtro sozinho (#218).
 *
 * Só dispara o envio do formulário GET em volta — `requestSubmit()`, o mesmo
 * caminho do botão Aplicar. A URL continua sendo o estado: nada aqui guarda
 * filtro, monta query nem conhece regra de negócio; o formulário e
 * `TransitionGetForm` já sabem tudo isso, e o servidor decide o resto.
 */

function formOf(element: HTMLElement | null): HTMLFormElement | null {
  if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) return element.form;
  return element?.closest("form") ?? null;
}

function destinationOf(form: HTMLFormElement): string | null {
  try {
    const destination = new URL(form.getAttribute("action") ?? "", window.location.href);
    destination.search = "";
    for (const [key, value] of new FormData(form)) {
      destination.searchParams.append(key, typeof value === "string" ? value : value.name);
    }
    return destination.href;
  } catch {
    return null;
  }
}

/** Há navegação em voo sem a URL confirmada? Os campos ocultos ainda são os de antes. */
function navigationInFlight(): boolean {
  const snapshot = transitionStore.getSnapshot();
  return snapshot.phase !== "idle" && !snapshot.committed;
}

/** Pedido de aplicação do formulário que contém `ref`; um por controle, o último vence. */
export function useAutoSubmit(ref: RefObject<HTMLElement | null>): AutoSubmitter {
  const [submitter] = useState(() =>
    createAutoSubmitter({
      setTimer: (callback, delay) => window.setTimeout(callback, delay),
      clearTimer: (timer) => window.clearTimeout(timer as number),
      busy: navigationInFlight,
      subscribe: transitionStore.subscribe,
      submit: () => {
        const form = formOf(ref.current);
        if (!form) return;
        // Voltar ao valor que a URL já tem não é pedido novo: sem isso, sair
        // de um campo intacto ou devolver o slider ao lugar abriria uma
        // navegação para a mesma lista.
        const destination = destinationOf(form);
        if (destination !== null && sameDestination(destination, window.location.href)) return;
        form.requestSubmit();
      },
    }),
  );

  useEffect(() => {
    const form = formOf(ref.current);
    // Enter e o botão Aplicar enviam na hora; o pedido pendente viraria uma
    // segunda navegação para o mesmo lugar.
    const cancel = () => submitter.cancel();
    form?.addEventListener("submit", cancel);
    return () => {
      form?.removeEventListener("submit", cancel);
      submitter.dispose();
    };
  }, [ref, submitter]);

  return submitter;
}

/**
 * O valor de um campo que segue a URL sem apagar a digitação em curso.
 *
 * Os campos da barra eram remontados por `key` a cada resposta do servidor,
 * porque `useState` só lê o valor inicial. Com o envio automático a resposta
 * chega enquanto a pessoa ainda digita — "reac" aplicado, "react nat" na mão —
 * e a remontagem devolvia "reac" e tirava o foco.
 *
 * A regra: quando a URL muda, o campo adota o valor dela, exceto se tiver
 * texto que o formulário ainda não enviou E a pessoa estiver nele (ou houver
 * pedido pendente, que vai levar esse texto). Limpar, voltar, preset e a faixa
 * invertida que o servidor corrige continuam chegando ao campo.
 */
export function useAppliedValue(
  applied: string,
  root: RefObject<HTMLElement | null>,
  submitter: AutoSubmitter,
): [string, (next: string) => void, () => string] {
  const [value, setValue] = useState(applied);
  const latest = useRef(applied);
  const sent = useRef(applied);
  const seen = useRef(applied);

  useEffect(() => {
    latest.current = value;
  }, [value]);

  useEffect(() => {
    const form = formOf(root.current);
    const record = () => {
      sent.current = latest.current;
    };
    form?.addEventListener("submit", record);
    return () => form?.removeEventListener("submit", record);
  }, [root]);

  useEffect(() => {
    if (applied === seen.current) return;
    seen.current = applied;
    const element = root.current;
    const focused = element !== null && element.contains(document.activeElement);
    const unsent = latest.current !== sent.current;
    if (unsent && (focused || submitter.pending())) return;
    sent.current = applied;
    setValue(applied);
  }, [applied, root, submitter]);

  // O valor que a URL vai ter: o último enviado, ou o que veio dela. Durante
  // uma navegação em voo, `applied` ainda é o de antes.
  const requested = () => sent.current;
  return [value, setValue, requested];
}

type AutoApplyInputProps = Omit<ComponentProps<typeof Input>, "value" | "defaultValue" | "onChange" | "ref"> & {
  /** O valor que a URL aplica agora. */
  applied: string;
  minChars?: number;
};

/** Campo de texto que aplica o filtro quando a pessoa para de digitar. */
export function AutoApplyInput({ applied, minChars = AUTO_APPLY_MIN_CHARS, ...props }: AutoApplyInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const submitter = useAutoSubmit(ref);
  const [value, setValue, requested] = useAppliedValue(applied, ref, submitter);

  return (
    <Input
      {...props}
      ref={ref}
      value={value}
      onChange={(event) => {
        const next = event.target.value;
        setValue(next);
        // Comparar com o que já foi pedido, não com a URL de agora: com "Work"
        // em voo, voltar a digitar o valor antigo da URL é um pedido novo.
        if (textReady(next, requested(), minChars)) submitter.schedule(AUTO_APPLY_TEXT_MS);
        else submitter.cancel();
      }}
    />
  );
}
