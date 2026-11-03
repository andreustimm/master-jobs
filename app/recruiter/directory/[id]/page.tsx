import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { allowlistedProfile } from "../../../../src/core/candidate-public.ts";
import { DIRECTORY_VISIBILITIES, recordDirectorySearch } from "../../../../src/core/candidate-directory.ts";
import { parseStorageConfig } from "../../../../src/core/storage/config.ts";
import { requirePage } from "../../../auth";
import { getTranslator } from "../../../i18n";
import { ProfileView } from "../../../p/[slug]/profile-view";
import { TransitionLink } from "../../../transition-link";

/**
 * Um perfil achado no diretório (#465, ADR-013): a lista de permissão do
 * `/p/`, pelo MESMO montador, com as visibilidades Recrutadores e Público
 * fixadas no servidor. Perfil Privado, id desconhecido ou malformado e perfil
 * que ficou privado depois da busca respondem o mesmo 404 (US-027.EC-3/4).
 *
 * O que a página NÃO tem, de propósito: controle que peça ou crie concessão,
 * e qualquer gravação que ligue o recrutador ao candidato (US-027.AC-4). A
 * única escrita é a linha do limite, sem candidato. Ler o perfil conta no
 * mesmo limite da busca: o id é sequencial, e abrir perfis um a um seria a
 * colheita que a paginação da busca existe para frear.
 *
 * Quem também tem concessão desta pessoa vê o link para a página da
 * concessão — funil e currículo ficam lá, nunca aqui (US-027.EC-5). O link
 * `/p/` só aparece para perfil Público: o de Recrutadores responde 404 a quem
 * não entrou (US-027.EC-2).
 *
 * Título sem nome: o `generateMetadata` roda fora da guarda da página, e ler o
 * perfil ali seria leitura antes de `requirePage`.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("directory.profileTitle"), robots: { index: false, follow: false } };
}

export default async function RecruiterDirectoryProfilePage({ params }: Params) {
  const session = await requirePage("candidate:discover");
  const { t } = await getTranslator();
  const allowed = await recordDirectorySearch(session.userId, new Date().toISOString());
  if (!allowed.ok) {
    return (
      <main className="pt-10 pb-16" data-testid="route-recruiter-directory-profile">
        <BackLink label={t("directory.back")} />
        <Card className="mt-4 p-6 text-sm" role="status" data-testid="directory-rate-limited">
          {t("directory.rateLimited")}
        </Card>
      </main>
    );
  }

  const raw = (await params).id;
  const id = /^\d{1,10}$/.test(raw) ? Number(raw) : Number.NaN;
  const profile = await allowlistedProfile({ id }, DIRECTORY_VISIBILITIES);
  if (!profile) notFound();
  const granted = session.linkedCandidateIds.includes(id);
  const link = cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11 xl:h-7 xl:min-h-0");

  return (
    <main className="mx-auto w-full max-w-[74rem] pt-10 pb-16" data-testid="route-recruiter-directory-profile">
      <BackLink label={t("directory.back")} />
      <p className="type-meta mt-2 mb-6 max-w-[62ch] text-muted-foreground" data-testid="directory-profile-scope">
        {t("directory.scope")}
      </p>
      <ProfileView
        profile={profile}
        imageUrl={(kind, version) => `/recruiter/directory/${id}/image/${kind}?v=${version}`}
        storageReady={parseStorageConfig(process.env).status === "configured"}
        t={t}
        actions={
          <>
            {profile.slug && (
              <TransitionLink
                href={`/p/${encodeURIComponent(profile.slug)}`}
                prefetch={false}
                className={link}
                data-testid="directory-public-link"
              >
                {t("directory.publicLink")}
              </TransitionLink>
            )}
            {granted && (
              <TransitionLink
                href={`/recruiter/${id}`}
                className={link}
                title={t("directory.grantHint")}
                data-testid="directory-grant-link"
              >
                {t("directory.grantLink")}
              </TransitionLink>
            )}
          </>
        }
      />
    </main>
  );
}

function BackLink({ label }: { label: string }) {
  return (
    <TransitionLink
      href="/recruiter/directory"
      className="inline-flex min-h-11 items-center type-meta text-[var(--primary-text)] hover:underline xl:min-h-0"
      data-testid="directory-back"
    >
      {label}
    </TransitionLink>
  );
}
