import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { parseStorageConfig } from "../../../src/core/storage/config.ts";
import { publicProfile } from "../../../src/core/candidate-public.ts";
import { getTranslator } from "../../i18n";
import { CopyProfileLinkButton } from "./copy-link-button";
import { ProfileView } from "./profile-view";

/**
 * Portfólio público, layout de referência Jobicy com o dado que já existe
 * (#326, fase 2/3 de #315). O que ela mostra vem de `publicProfile()`, que
 * monta o objeto por lista de permissão — esta página não tem acesso ao
 * registro do candidato e portanto não consegue vazar um campo por descuido.
 * O corpo é `ProfileView`, o mesmo do diretório de recrutadores (#465).
 *
 * **404 e não 403** para perfil que não é público. 403 confirmaria que o slug
 * existe, e existência é informação: quem varre uma lista de nomes aprende
 * quais estão cadastrados. A instalação já se comporta assim onde importa.
 *
 * **`noindex` sempre.** `visibility = public` significa "alcançável sem
 * sessão", não "quero aparecer no Google" — são decisões diferentes, e mandar
 * o link para um recrutador não é publicar.
 *
 * **Foto e capa (#327)** chegam como versão opaca em `profile.images`, só com
 * opt-in. A página nunca vê a chave nem URL de provedor: aponta para a rota
 * `/p/<endereço>/image/<tipo>`, que reconfere a visibilidade a cada pedido.
 */

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const profile = await publicProfile((await params).slug);
  const { t } = await getTranslator();
  return {
    // Sem perfil, o título é o mesmo 404 de qualquer endereço: "perfil sem
    // nome" diria que existe um perfil ali.
    title: !profile
      ? t("routeStatus.notFoundTitle")
      : profile.name
        ? t("publicName.pageTitle", { name: profile.name })
        : t("publicName.unnamed"),
    description: profile?.headline ?? undefined,
    robots: { index: false, follow: false },
  };
}

export default async function PublicProfilePage({ params }: Params) {
  // O limite por IP mora no `proxy.ts`, não aqui. Ver a nota lá: a página não
  // consegue devolver 429 com `Retry-After`, e limitar depois de renderizar
  // pagaria o custo que o limite existe para evitar.
  const profile = await publicProfile((await params).slug);
  if (!profile) notFound();
  const { t } = await getTranslator();

  return (
    <main className="mx-auto w-full max-w-[74rem] pt-12 pb-16" data-testid="route-public-profile">
      <ProfileView
        profile={profile}
        imageUrl={(kind, version) => `/p/${encodeURIComponent(profile.slug)}/image/${kind}?v=${version}`}
        storageReady={parseStorageConfig(process.env).status === "configured"}
        t={t}
        // Compartilhar só copia a URL atual.
        actions={
          <CopyProfileLinkButton
            label={t("publicProfile.copyLink")}
            copiedLabel={t("publicProfile.linkCopied")}
            failedLabel={t("publicProfile.linkCopyFailed")}
          />
        }
      />
    </main>
  );
}
