import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { MutationFeedbackForm } from "../mutation-feedback";
import { savePublicImageAction } from "./actions";
import { ImageFileInput } from "./image-file-input";
import {
  IMAGE_MAX_BYTES,
  IMAGE_MAX_MEGABYTES,
  IMAGE_MAX_SIDE,
  IMAGE_SPEC,
  PUBLIC_IMAGE_KINDS,
  type PublicImageError,
  type PublicImageKind,
} from "../../src/core/public-images.ts";
import type { TranslationKey, Translator } from "../../src/core/i18n/index.ts";

const LABEL: Record<PublicImageKind, TranslationKey> = { photo: "publicImages.photo", cover: "publicImages.cover" };
const HINT: Record<PublicImageKind, TranslationKey> = { photo: "publicImages.photoHint", cover: "publicImages.coverHint" };
const PREVIEW_ALT: Record<PublicImageKind, TranslationKey> = {
  photo: "publicImages.currentPhotoAlt",
  cover: "publicImages.currentCoverAlt",
};

/** Recusas por código, com o mínimo DO TIPO. `Record` sobre a união: código novo sem mensagem não compila. */
function imageMessages(kind: PublicImageKind, t: Translator["t"]): Record<PublicImageError | "removed", string> {
  const spec = IMAGE_SPEC[kind];
  return {
    removed: t("publicImages.removed"),
    invalidKind: t("publicImages.errorInvalidKind"),
    imageMissing: t("publicImages.errorMissing"),
    imageTooLarge: t("publicImages.errorTooLarge", { max: IMAGE_MAX_MEGABYTES }),
    imageType: t("publicImages.errorType"),
    imageTooSmall: t("publicImages.errorTooSmall", { width: spec.minWidth, height: spec.minHeight }),
    imageTooBig: t("publicImages.errorTooBig", { max: IMAGE_MAX_SIDE }),
    imageUnreadable: t("publicImages.errorUnreadable"),
    storageUnavailable: t("publicImages.errorUnavailable"),
  };
}

export type OwnImage = {
  /** Versão opaca da chave gravada (`imageVersion`), ou `null` sem imagem. */
  version: string | null;
  shown: boolean;
};

/**
 * Uma imagem: a prévia do que está gravado, o arquivo novo, o "mostrar" e,
 * havendo imagem, remover. O "mostrar" fica junto da imagem, como nos fatos:
 * separado, é como alguém marca achando que é a outra.
 */
function ImageField({ kind, current, t }: { kind: PublicImageKind; current: OwnImage; t: Translator["t"] }) {
  const spec = IMAGE_SPEC[kind];
  const titleId = `public-image-${kind}-label`;
  const inputId = `public-image-file-${kind}`;
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className="grid min-w-0 gap-3 rounded-[var(--radius-action)] border border-[var(--hairline)] p-3"
      data-testid={`public-image-${kind}`}
    >
      <h3 id={titleId} className="type-body-emphasis">
        {t(LABEL[kind])}
      </h3>
      {current.version ? (
        // Prévia pela rota guardada do próprio candidato, nunca por URL do
        // provedor. `v` muda a cada envio, então a troca aparece na hora.
        <img
          src={`/candidate/image/${kind}?v=${current.version}`}
          alt={t(PREVIEW_ALT[kind])}
          width={spec.width}
          height={spec.height}
          className={
            kind === "photo"
              ? "size-24 rounded-[var(--radius-action)] border border-[var(--hairline)] object-cover"
              : "aspect-[4/1] h-auto w-full max-w-[480px] rounded-xl border border-[var(--hairline)] object-cover"
          }
          data-testid={`public-image-preview-${kind}`}
        />
      ) : (
        <p className="type-body-sm text-muted-foreground" data-testid={`public-image-empty-${kind}`}>
          {t("publicImages.none")}
        </p>
      )}
      <MutationFeedbackForm
        action={savePublicImageAction}
        successMessage={t("publicImages.saved")}
        errorMessage={t("feedback.error")}
        resultMessages={imageMessages(kind, t)}
        dismissLabel={t("feedback.dismiss")}
        className="grid gap-2"
      >
        <input type="hidden" name="kind" value={kind} />
        <Label htmlFor={inputId}>{t("publicImages.choose")}</Label>
        {/* `accept` só filtra o seletor e o teto no navegador só evita o 413 da
            plataforma; quem decide é o servidor (tamanho, assinatura, dimensão). */}
        <ImageFileInput
          id={inputId}
          name="file"
          accept="image/jpeg,image/png,image/webp"
          maxBytes={IMAGE_MAX_BYTES}
          tooLargeMessage={t("publicImages.errorTooLarge", { max: IMAGE_MAX_MEGABYTES })}
          aria-describedby={`${inputId}-hint`}
          className="min-w-0 max-w-[320px]"
          data-testid={inputId}
        />
        <p id={`${inputId}-hint`} className="type-meta text-muted-foreground">
          {t(HINT[kind], { max: IMAGE_MAX_MEGABYTES, width: spec.minWidth, height: spec.minHeight })}
        </p>
        <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2 type-body-sm xl:min-h-0">
          <input
            type="checkbox"
            name="show"
            defaultChecked={current.shown}
            className="cursor-pointer"
            data-testid={`public-image-show-${kind}`}
          />
          {t("publicFacts.show")}
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" variant="outline" data-testid={`save-public-image-${kind}`}>
            {t("publicImages.save")}
          </Button>
          {current.version && (
            <Button
              type="submit"
              name="intent"
              value="remove"
              size="sm"
              variant="ghost"
              data-testid={`remove-public-image-${kind}`}
            >
              {t("publicImages.remove")}
            </Button>
          )}
        </div>
      </MutationFeedbackForm>
    </div>
  );
}

/**
 * "Foto e capa do perfil público" (#327). Desmarcado por padrão; a imagem
 * enviada fica guardada e não sai em `/p/` até a pessoa marcar "mostrar".
 */
export function PublicImagesCard({
  current,
  t,
}: {
  current: Record<PublicImageKind, OwnImage>;
  t: Translator["t"];
}) {
  return (
    <Card className="mb-6" data-testid="public-images-card">
      <CardHeader>
        <CardTitle className="text-lg">{t("publicImages.title")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 pt-0">
        <p className="type-body-sm text-muted-foreground">{t("publicImages.hint")}</p>
        {PUBLIC_IMAGE_KINDS.map((kind) => (
          <ImageField key={kind} kind={kind} current={current[kind]} t={t} />
        ))}
      </CardContent>
    </Card>
  );
}
