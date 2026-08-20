import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { publicProfile } from "../../../src/core/candidate-public.ts";
import { MarkdownPreview } from "../../candidate/markdown-preview";

/**
 * Portfólio público. **A única rota do sistema que responde sem sessão.**
 *
 * O que ela mostra vem de `publicProfile()`, que monta o objeto por lista de
 * permissão. Esta página não tem acesso ao registro do candidato e portanto não
 * consegue vazar um campo por descuido — não é disciplina, é o tipo dizendo
 * não.
 *
 * **404 e não 403** para perfil que não é público. 403 confirmaria que o slug
 * existe, e existência é informação: quem varre uma lista de nomes aprende
 * quais estão cadastrados. A instalação já se comporta assim onde importa.
 *
 * **`noindex` sempre.** `visibility = public` significa "alcançável sem
 * sessão", não "quero aparecer no Google" — são decisões diferentes, e mandar
 * o link para um recrutador não é publicar. Indexação, se um dia for oferecida,
 * é um terceiro controle, e aí `robots.txt` e a meta precisam concordar: um
 * permitindo e o outro negando é o pior estado, porque o resultado passa a
 * depender de qual buscador leu o quê.
 */

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const profile = await publicProfile((await params).slug);
  return {
    title: profile ? `${profile.name} — perfil` : "Perfil",
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

  return (
    <main className="mx-auto w-full max-w-[62ch] pt-12 pb-16">
      <header className="mb-8">
        <h1 data-user-content className="type-display-md">
          {profile.name}
        </h1>
        {profile.headline && (
          <p data-user-content className="type-body-lg mt-1 text-muted-foreground">
            {profile.headline}
          </p>
        )}
        {profile.location && (
          <p data-user-content className="type-body-sm mt-1 text-muted-foreground">
            {profile.location}
          </p>
        )}

        {/* Links que o candidato já publica em outro lugar. E-mail e telefone
            não entram: um endereço numa página aberta é endereço colhido. */}
        {(profile.linkedinUrl || profile.githubUrl) && (
          <p className="mt-3 flex flex-wrap gap-4">
            {profile.linkedinUrl && (
              <a
                href={profile.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="type-body-sm text-[var(--primary-text)] hover:underline"
              >
                LinkedIn
              </a>
            )}
            {profile.githubUrl && (
              <a
                href={profile.githubUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="type-body-sm text-[var(--primary-text)] hover:underline"
              >
                GitHub
              </a>
            )}
          </p>
        )}
      </header>

      {profile.skills.length > 0 && (
        <section className="mb-8">
          <div className="flex flex-wrap gap-1.5">
            {/* Só as confirmadas. "Detectada" é o que o sistema achou no texto,
                e publicar isso como fato afirmaria experiência que ninguém
                conferiu — regra 6. */}
            {profile.skills.map((name) => (
              <Badge key={name} data-user-content variant="outline" className="type-micro">
                {name}
              </Badge>
            ))}
          </div>
        </section>
      )}

      {profile.cv && (
        <Card>
          <CardContent data-user-content className="pt-0">
            <MarkdownPreview source={profile.cv} emptyLabel="" />
          </CardContent>
        </Card>
      )}
    </main>
  );
}
