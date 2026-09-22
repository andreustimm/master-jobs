/**
 * Contas e o candidato de cada uma.
 *
 * Um candidato pertence a uma conta só. Duas contas no mesmo candidato leem e
 * escrevem o currículo, a visibilidade e o funil uma da outra, sem passar pela
 * impersonação — o único caminho auditado para dado alheio. Foi o vazamento da
 * v1.20.5: `jho auth add-user` e o setup do e2e ligavam contas novas ao
 * candidato `default`, o do dono.
 *
 * Todo caminho que cria conta com papel candidato passa por
 * `claimOwnCandidate`, e nenhum aceita id de candidato vindo de fora.
 */
import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../core/db/client.ts";
import { authUser } from "../../../core/db/schema.ts";
import {
  ensureCandidate,
  getCandidate,
  syncCandidateFromProfile,
} from "../../../core/candidate.ts";
import type { Role } from "../domain/types.ts";

/**
 * Slug do candidato próprio de uma conta. Deriva do e-mail, que é único, para
 * que duas pessoas de mesmo nome não disputem a mesma URL pública.
 */
export function ownCandidateSlug(email: string): string {
  return `user-${email.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

/**
 * Cria o candidato próprio de uma conta — sempre um candidato NOVO.
 *
 * A derivação do slug não é injetiva: `a.b@x.com` e `a-b@x.com` dão ambos
 * `user-a-b-x-com`. E um candidato sem conta não é "livre": apagar a conta
 * deixa o candidato com o currículo e o funil de quem saiu. Reaproveitar por
 * slug entregaria esse dado à conta seguinte, então slug existente é pulado.
 */
export async function claimOwnCandidate(input: { email: string; name: string }): Promise<number> {
  const base = ownCandidateSlug(input.email);
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (!(await getCandidate(slug))) return ensureCandidate({ slug, name: input.name });
  }
}

/**
 * A conta é a do dono: a mais antiga da instalação (ou a primeira a ser
 * criada) e o candidato `default` ainda não tem conta. Cobre o dono que entrou
 * primeiro só como admin e depois ganhou o papel de candidato.
 */
async function isInstallationOwner(email: string): Promise<boolean> {
  const db = getDb();
  const [oldest] = await db
    .select({ email: authUser.email })
    .from(authUser)
    .orderBy(asc(authUser.id))
    .limit(1);
  if (oldest && oldest.email !== email) return false;
  const owner = await getCandidate("default");
  if (!owner) return true;
  const [holder] = await db
    .select({ id: authUser.id })
    .from(authUser)
    .where(eq(authUser.candidateId, owner.id))
    .limit(1);
  return !holder;
}

/**
 * Cria ou atualiza uma conta pela linha de comando.
 *
 * Conta de papel candidato ganha candidato PRÓPRIO, como na tela de
 * administração. Não aceita id de candidato. Numa conta que já existe, o
 * vínculo gravado não é trocado — só preenchido quando falta.
 */
export async function addUser(input: {
  email: string;
  roles: Role[];
}): Promise<{ email: string; roles: Role[]; candidateId: number | null }> {
  const email = input.email.trim().toLowerCase();
  const roles = input.roles;
  const db = getDb();

  const [existing] = await db
    .select({ candidateId: authUser.candidateId })
    .from(authUser)
    .where(eq(authUser.email, email))
    .limit(1);

  let candidateId: number | null = existing?.candidateId ?? null;
  if (candidateId === null && roles.includes("candidate")) {
    // A primeira conta da instalação é a do dono — é o primeiro acesso que a
    // regra 14 e `/login` ensinam — e fica com o candidato do `profile.yaml`.
    // Qualquer conta depois dela é de outra pessoa.
    candidateId = (await isInstallationOwner(email))
      ? await syncCandidateFromProfile()
      : await claimOwnCandidate({ email, name: email });
  }

  await db
    .insert(authUser)
    .values({ email, roles, candidateId })
    .onConflictDoUpdate({
      target: authUser.email,
      // Nunca troca um vínculo gravado; só preenche o que falta.
      set: { roles, candidateId: sql`coalesce(${authUser.candidateId}, excluded.candidate_id)` },
    });
  return { email, roles, candidateId };
}
