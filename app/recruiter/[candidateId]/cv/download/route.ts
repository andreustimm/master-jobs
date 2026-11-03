import { parseCandidateSelector, recruiterCandidateCv } from "../../../../../src/contexts/pursuit/index.ts";
import { requirePage, requireSession } from "../../../../auth";

/**
 * O currículo atual do candidato acompanhado, como arquivo (US-015.EC-5/6):
 * o texto gravado byte a byte, `text/markdown`, com o nome do candidato no
 * nome do arquivo e nenhum id interno.
 *
 * A mesma porta da página: fora do vínculo da sessão, id malformado, sem
 * currículo ou depois da revogação, o mesmo 404 sem corpo (US-015.EC-2/3).
 * `no-store`: nada disto pode sobrar num cache depois que o acesso acaba.
 */
export const dynamic = "force-dynamic";

function notFoundResponse(): Response {
  return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
}

export async function GET(_request: Request, context: { params: Promise<{ candidateId: string }> }) {
  const session = await requireSession();
  const candidateId = parseCandidateSelector((await context.params).candidateId);
  if (candidateId === null || !session.linkedCandidateIds.includes(candidateId)) return notFoundResponse();
  await requirePage("candidate:read", { kind: "candidate", candidateId });
  const view = await recruiterCandidateCv(session, candidateId);
  if (view === null || view.cv.state !== "ready") return notFoundResponse();
  return new Response(view.cv.content, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${view.cv.fileName}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
