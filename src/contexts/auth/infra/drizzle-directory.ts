/**
 * Gestão de contas sobre Drizzle.
 *
 * Adapter da porta `UserDirectory`. Separado de `drizzle-store.ts` porque
 * responde outra pergunta: aquele autentica, este administra. Manter escrita de
 * conta longe do caminho de autenticação é higiene barata — o arquivo que
 * resolve um token não deveria ter uma função capaz de criar um admin.
 */
import { asc, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../core/db/client.ts";
import { authUser, recruiterCandidate } from "../../../core/db/schema.ts";
import type { UserDirectory, UserSummary } from "../ports.ts";
import type { Role } from "../domain/types.ts";

/**
 * Nome como veio da tela, pronto para o banco.
 *
 * Espaço em volta some, e string vazia vira nulo. Guardar `""` faria a tela que
 * "mostra o nome" exibir nada: nulo é o estado que quem exibe já trata, e ter
 * dois jeitos de dizer "sem nome" garante que um deles fique sem tratamento em
 * algum lugar.
 */
function normalizarNome(nome: string | null | undefined): string | null {
  const limpo = nome?.trim();
  return limpo ? limpo : null;
}

function toSummary(row: {
  id: number;
  email: string;
  fullName: string | null;
  roles: unknown;
  candidateId: number | null;
  disabledAt: string | null;
  createdAt: string;
  passwordHash: string | null;
}): UserSummary {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    roles: (row.roles as Role[]) ?? [],
    candidateId: row.candidateId,
    disabledAt: row.disabledAt,
    createdAt: row.createdAt,
    // O hash NUNCA sai daqui; só o fato de existir. A tela precisa saber se a
    // conta consegue entrar, não qual é a senha.
    hasPassword: row.passwordHash !== null,
  };
}

const COLUMNS = {
  id: authUser.id,
  email: authUser.email,
  fullName: authUser.fullName,
  roles: authUser.roles,
  candidateId: authUser.candidateId,
  disabledAt: authUser.disabledAt,
  createdAt: authUser.createdAt,
  passwordHash: authUser.passwordHash,
};

export const drizzleUserDirectory: UserDirectory = {
  async list() {
    const rows = await getDb().select(COLUMNS).from(authUser).orderBy(asc(authUser.id));
    return rows.map(toSummary);
  },

  async find(userId) {
    const [row] = await getDb().select(COLUMNS).from(authUser).where(eq(authUser.id, userId)).limit(1);
    return row ? toSummary(row) : null;
  },

  async create(input) {
    const email = input.email.trim().toLowerCase();
    const [row] = await getDb()
      .insert(authUser)
      .values({
        email,
        fullName: normalizarNome(input.fullName),
        roles: input.roles,
        candidateId: input.candidateId ?? null,
        // Sem senha: a conta existe mas não entra até alguém definir uma. É
        // deliberado — criar conta e credencial no mesmo passo obrigaria esta
        // função a manusear senha, e ela não deveria saber o que é uma.
        passwordHash: null,
      })
      .returning({ id: authUser.id });
    if (!row) throw new Error("insert returned no row");
    return { id: row.id };
  },

  async updateRoles(userId, roles) {
    await getDb().update(authUser).set({ roles }).where(eq(authUser.id, userId));
  },

  async update(userId, patch) {
    const set: { email?: string; fullName?: string | null; roles?: Role[] } = {};
    if (patch.email !== undefined) set.email = patch.email.trim().toLowerCase();
    if (patch.fullName !== undefined) set.fullName = normalizarNome(patch.fullName);
    if (patch.roles !== undefined) set.roles = patch.roles;

    // Drizzle recusa `set({})` com erro de SQL. Um patch vazio é entrada
    // legítima — a modal aberta e fechada sem mudar nada — e o certo é não
    // fazer nada, não estourar.
    if (Object.keys(set).length === 0) return;

    await getDb().update(authUser).set(set).where(eq(authUser.id, userId));
  },

  async remove(userId) {
    await getDb().delete(authUser).where(eq(authUser.id, userId));
  },

  async setDisabled(userId, disabled) {
    await getDb()
      .update(authUser)
      .set({ disabledAt: disabled ? new Date().toISOString() : null })
      .where(eq(authUser.id, userId));
  },

  async linkedCandidates(recruiterUserId) {
    const rows = await getDb()
      .select({ candidateId: recruiterCandidate.candidateId })
      .from(recruiterCandidate)
      .where(eq(recruiterCandidate.recruiterUserId, recruiterUserId));
    return rows.map((r) => r.candidateId);
  },

  async linksOf(recruiterUserId) {
    return getDb()
      .select({ id: recruiterCandidate.id, candidateId: recruiterCandidate.candidateId })
      .from(recruiterCandidate)
      .where(eq(recruiterCandidate.recruiterUserId, recruiterUserId));
  },

  /**
   * Cria o vínculo recrutador↔candidato.
   *
   * **Quem chama isto precisa ser o candidato.** Não é detalhe de implementação:
   * o vínculo dá ao recrutador acesso de leitura ao currículo e ao funil, e se
   * um admin pudesse criá-lo ele leria dado alheio por procuração — bastaria
   * vincular a si mesmo como recrutador. Seria um desvio silencioso da
   * impersonação auditada, que é justamente o único caminho previsto.
   *
   * Por isso a ação que expõe esta função vive na área do candidato e usa
   * `guardOwnCandidate`, que não aceita id por parâmetro.
   */
  async linkCandidate(recruiterUserId, candidateId, by) {
    // Idempotente pelo índice único: vincular duas vezes não cria dois.
    await getDb()
      .insert(recruiterCandidate)
      .values({ recruiterUserId, candidateId, createdBy: by })
      .onConflictDoNothing();
  },

  async unlinkById(linkId) {
    // Pelo id do vínculo, e não pelo par: revogar acesso é seguro vindo de
    // qualquer lado, e assim nenhuma tela precisa passar um id de candidato.
    await getDb().delete(recruiterCandidate).where(eq(recruiterCandidate.id, linkId));
  },
};

/**
 * Admins ativos além de um dado usuário.
 *
 * Existe para uma regra só, e ela importa: **a instalação nunca pode ficar sem
 * admin**. Rebaixar o papel do último ou desabilitar a conta dele deixaria o
 * sistema sem ninguém capaz de criar contas ou de desfazer a mudança — e a
 * recuperação seria por SQL na mão.
 */
export async function otherActiveAdmins(exceptUserId: number): Promise<number[]> {
  const rows = await getDb()
    .select({ id: authUser.id, roles: authUser.roles, disabledAt: authUser.disabledAt })
    .from(authUser)
    .where(isNull(authUser.disabledAt));
  return rows
    .filter((r) => r.id !== exceptUserId && ((r.roles as Role[]) ?? []).includes("admin"))
    .map((r) => r.id);
}
