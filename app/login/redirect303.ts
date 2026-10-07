import { NextResponse, type NextRequest } from "next/server";

/**
 * 303 das rotas de entrada (link mágico e login social).
 *
 * Navegações do App Router são RSC fetches. O redirect helper permite que o
 * Next transforme a URL absoluta em `x-nextjs-redirect`, que o cliente usa
 * para liberar a transição sem seguir uma resposta HTML como Flight. Fora
 * disso, `Location` relativo, para o destino continuar na origem de quem pediu.
 */
export function redirect303(request: NextRequest, location: string): NextResponse {
  if (request.headers.get("RSC") === "1") {
    return NextResponse.redirect(new URL(location, request.url), { status: 303 });
  }
  return new NextResponse(null, { status: 303, headers: { Location: location } });
}
