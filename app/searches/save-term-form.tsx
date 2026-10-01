"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MutationFeedbackForm } from "../mutation-feedback";
import { saveTermAction } from "./actions";

/** Native select dressed as the design system's input: no client JS needed. */
const SELECT = "h-9 rounded-md border border-input bg-background px-2 type-body-md text-foreground";

/**
 * O formulário de "salvar um termo", isolado num Client Component só pelo
 * `router.replace` depois do sucesso.
 *
 * Quando o termo chegou pela oferta de Vagas (`?term=`), a URL continuava
 * apontando pra ele depois de salvo: o `defaultValue` do campo reaparecia a
 * cada revalidação e um segundo clique em Salvar devolvia "Esse termo já está
 * salvo." — o mesmo sintoma que a correção original resolveu para quem digita
 * na própria tela. Limpar o parâmetro assim que o envio é aceito evita o
 * segundo clique acidental sem mudar o comportamento de quem nunca teve
 * `?term=` na URL.
 */
export function SaveTermForm({
  requestedTerm,
  active,
  preselectedTrackId,
  labels,
  feedback,
  resultLinkLabel,
}: {
  requestedTerm?: string;
  active: ReadonlyArray<{ id: number; name: string }>;
  preselectedTrackId?: number;
  labels: { term: string; track: string; save: string };
  feedback: {
    successMessage: string;
    errorMessage: string;
    dismissLabel: string;
    resultMessages?: Record<string, string>;
  };
  resultLinkLabel: string;
}) {
  const router = useRouter();

  const action = async (formData: FormData) => {
    const result = await saveTermAction(formData);
    if (result.ok && requestedTerm) router.replace("/searches");
    return result;
  };

  return (
    <MutationFeedbackForm
      action={action}
      {...feedback}
      resultLinkLabel={resultLinkLabel}
      className="grid gap-2 sm:flex sm:flex-wrap sm:items-end"
      data-testid="searches-save-form"
    >
      <label className="flex min-w-0 flex-1 basis-48 flex-col gap-1 type-caption-sm text-muted-foreground">
        {labels.term}
        <Input name="term" required defaultValue={requestedTerm} data-testid="searches-term-input" />
      </label>
      <label className="flex flex-col gap-1 type-caption-sm text-muted-foreground">
        {labels.track}
        <select
          name="trackId"
          defaultValue={preselectedTrackId}
          className={cn(SELECT, "w-full sm:w-auto")}
          data-testid="searches-term-track"
        >
          {active.map((track) => (
            <option key={track.id} value={track.id} data-user-content>
              {track.name}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" className="h-auto min-h-11 w-full sm:w-auto xl:h-8 xl:min-h-0" data-testid="searches-term-save">
        {labels.save}
      </Button>
    </MutationFeedbackForm>
  );
}
