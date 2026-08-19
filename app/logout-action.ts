"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { endSession } from "../src/contexts/auth/index.ts";
import { SESSION_COOKIE } from "./auth";

/**
 * Sair.
 *
 * Server Action, e não Route Handler com `<form action="/logout">`: a CSP
 * declara `form-action 'self'`, e um POST de formulário para outra rota é
 * bloqueado pelo navegador — o logout simplesmente não acontecia, com o erro
 * só no console. Server Action posta para a própria URL da página, então a
 * diretiva nunca entra no caminho.
 *
 * Sem guard: quem não tem sessão não tem o que revogar, e exigir uma para sair
 * criaria o caso absurdo de não conseguir sair com sessão inválida.
 */
export async function logoutAction() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  // Revoga no servidor antes de apagar o cookie: cookie que o cliente esquece
  // continua válido para quem o copiou.
  if (token) await endSession(token);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
