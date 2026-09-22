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
 * A conta é a do dono só no primeiro acesso: nenhuma conta existe ainda.
 *
 * Qualquer critério mais largo tem um caso em que o candidato `default` — com
 * o currículo e o funil do dono — vai para outra pessoa: apagada a conta do
 * dono, "a mais antiga" ou "a única que sobrou" já é de outra pessoa. O dono
 * que entrou primeiro só como admin recebe candidato próprio; o do perfil
 * continua disponível pela tela, não por herança.
 */
async function isFirstAccount(): Promise<boolean> {
  const [any] = await getDb().select({ id: authUser.id }).from(authUser).limit(1);
  return !any;
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
    candidateId = !existing && (await isFirstAccount())
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
