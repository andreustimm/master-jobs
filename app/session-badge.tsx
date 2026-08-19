import { isSingleUser } from "../src/contexts/auth/index.ts";
import { currentSession } from "./auth";

/**
 * Who you are, and under which mode.
 *
 * Exists because the honest answer to "is auth working?" in single-user mode is
 * "yes, and it deliberately does not ask you for anything" — which is
 * indistinguishable from "no" unless the UI says so.
 */
export async function SessionBadge() {
  const single = isSingleUser();
  const session = await currentSession();

  if (single) {
    return (
      <span
        className="type-micro rounded-full border border-[var(--color-hairline)] px-2 py-0.5 text-muted-foreground"
        title="Sem login por design: um usuário, em loopback. Toda ação ainda passa pelo guard. Defina JHO_AUTH_MODE=multi para exigir login."
      >
        single-user
      </span>
    );
  }

  if (!session) {
    return (
      <a href="/login" className="type-micro text-[var(--primary-text)] hover:underline">
        entrar
      </a>
    );
  }

  return (
    <form action="/logout" method="post" className="flex items-center gap-2">
      <span className="type-micro text-muted-foreground">{session.email}</span>
      <button type="submit" className="type-micro text-[var(--primary-text)] hover:underline">
        sair
      </button>
    </form>
  );
}
