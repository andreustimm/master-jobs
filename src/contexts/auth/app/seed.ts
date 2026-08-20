/**
 * Semente de autenticação.
 *
 * Cria a conta do dono a partir do `profile.yaml`, para que a identidade do
 * sistema e a de login não divirjam sobre quem é a pessoa.
 *
 * A senha é **gerada**, não escolhida por padrão. Uma senha padrão em código —
 * "admin", "changeme", qualquer uma — sobrevive à intenção de trocá-la, vai
 * para o histórico do Git e vira a porta que ninguém lembrou de fechar. Uma
 * senha aleatória mostrada uma única vez não tem esse destino: quem não anotou
 * roda `set-password` e pronto.
 *
 * Idempotente. Rodar de novo não recria a conta nem redefine a senha de quem
 * já entrou — sobrescrever silenciosamente a credencial de alguém seria o pior
 * comportamento possível para um comando chamado "seed".
 */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../../../core/db/client.ts";
import { authUser } from "../../../core/db/schema.ts";
import { loadProfile } from "../../../core/profile/load.ts";
import { syncCandidateFromProfile } from "../../../core/candidate.ts";
import { setPassword } from "../infra/password-login.ts";
import type { Role } from "../domain/types.ts";

/**
 * Palavras curtas e sem ambiguidade visual, para uma senha que alguém vai
 * digitar do papel uma vez. Entropia vem da quantidade, não de símbolos: seis
 * palavras deste conjunto dão mais que uma senha "complexa" de oito caracteres,
 * e são transcritas sem erro.
 */
const WORDS = [
  "azul", "cedro", "vento", "pedra", "chuva", "campo", "raiz", "onda",
  "ferro", "trilha", "porto", "areia", "lampa", "verde", "norte", "junco",
  "prata", "folha", "monte", "rio", "sino", "trigo", "vale", "zinco",
];

export function generatePassword(words = 4): string {
  const picked: string[] = [];
  // `randomBytes`, não `Math.random`: previsibilidade aqui é a falha inteira.
  const bytes = randomBytes(words * 2);
  for (let i = 0; i < words; i++) {
    picked.push(WORDS[bytes.readUInt16BE(i * 2) % WORDS.length]!);
  }
  // Dois dígitos ao fim satisfazem validadores que exigem número, sem tornar a
  // senha difícil de transcrever.
  const suffix = String(randomBytes(2).readUInt16BE(0) % 100).padStart(2, "0");
  return `${picked.join("-")}-${suffix}`;
}

export type SeedResult = {
  email: string;
  roles: Role[];
  /** Presente só quando a senha foi definida agora. */
  password?: string;
  created: boolean;
  passwordSet: boolean;
};

export async function seedOwner(
  options: { email?: string; password?: string; force?: boolean } = {},
): Promise<SeedResult> {
  const profile = await loadProfile();
  const candidateId = await syncCandidateFromProfile();

  // Argumento primeiro, perfil depois. O e-mail do perfil vem de
  // ${JHO_CANDIDATE_EMAIL} justamente para não ficar versionado, então ele
  // está vazio em qualquer clone sem `.env` — e o seed precisa funcionar ali.
  const email = (options.email || profile.identity.email || "").toLowerCase().trim();
  if (!email) {
    throw new Error(
      "Informe o e-mail: jho auth seed <email>. (Ou defina JHO_CANDIDATE_EMAIL no .env.)",
    );
  }

  const db = getDb();
  // Quem instala é as duas coisas: administra e é o candidato.
  const roles: Role[] = ["admin", "candidate"];

  const [existing] = await db
    .select({ id: authUser.id, passwordHash: authUser.passwordHash })
    .from(authUser)
    .where(eq(authUser.email, email))
    .limit(1);

  if (!existing) {
    await db.insert(authUser).values({ email, roles, candidateId });
  }

  // Só define senha se não houver — ou se pedirem explicitamente. Trocar a
  // senha de quem já usa o sistema não é semear, é derrubar.
  const needsPassword = !existing?.passwordHash || options.force === true;
  if (!needsPassword) {
    return { email, roles, created: !existing, passwordSet: false };
  }

  const password = options.password ?? generatePassword();
  await setPassword(email, password);

  return { email, roles, password, created: !existing, passwordSet: true };
}
