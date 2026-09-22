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
import { eq, sql } from "drizzle-orm";
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
 * Cria — ou reaproveita, se estiver órfão — o candidato próprio de uma conta.
 *
 * A derivação do slug não é injetiva: `a.b@x.com` e `a-b@x.com` dão ambos
 * `user-a-b-x-com`. Reaproveitar pelo slug sem olhar de quem ele é entregaria
 * à segunda pessoa o candidato da primeira. Slug de candidato que já tem conta
 * é pulado; órfão (conta apagada) é reaproveitado.
 */
export async function claimOwnCandidate(input: { email: string; name: string }): Promise<number> {
  const base = ownCandidateSlug(input.email);
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const found = await getCandidate(slug);
    if (!found) return ensureCandidate({ slug, name: input.name });
    const [holder] = await getDb()
      .select({ id: authUser.id })
      .from(authUser)
      .where(eq(authUser.candidateId, found.id))
      .limit(1);
    if (!holder) return found.id;
  }
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
    const [anyAccount] = await db.select({ id: authUser.id }).from(authUser).limit(1);
    candidateId = !existing && !anyAccount
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
