import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  analyseGap,
  currentDocument,
  documentHistory,
  getCandidate,
} from "../../src/core/candidate.ts";
import { MarkdownEditor } from "./editor";
import { importPdfAction, saveCvAction } from "./actions";
import { requirePage } from "../auth";

export const dynamic = "force-dynamic";

export default async function CandidateArea() {
  // Guard antes de ler qualquer dado. O escopo vem da sessão.
  const session = await requirePage("candidate:read");
  void session;

  const person = await getCandidate();
  const doc = person ? await currentDocument(person.id, "cv") : null;
  const history = person ? await documentHistory(person.id, "cv") : [];
  const gap = await analyseGap({ minFit: 60 });

  return (
    <main className="pt-10 pb-16">
      <div className="mb-4 flex items-baseline gap-3">
        <h1 className="type-display-md chevron">Área do candidato</h1>
        <Link href="/candidate/skills" className="inline-flex items-center py-1.5 text-sm text-[var(--primary-text)] hover:underline">
          skills →
        </Link>
        <Link href="/candidate/vocabulary" className="inline-flex items-center py-1.5 text-sm text-[var(--primary-text)] hover:underline">
          vocabulário →
        </Link>
      </div>
      <p className="type-body-md mb-xxl max-w-[62ch] text-muted-foreground">
        Cole o currículo aqui. Ele fica versionado — cada salvamento vira uma
        versão, e a anterior continua consultável. Guardar o texto só vale a pena
        pelo que ele destrava:{" "}
        <strong className="text-foreground">
          comparar o seu vocabulário com o das vagas que você realmente quer
        </strong>
        .
      </p>

      {person && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">{person.name}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-sm text-muted-foreground">
            {person.headline && <p className="text-foreground">{person.headline}</p>}
            <p className="mt-1">
              {[person.location, person.email].filter(Boolean).join(" · ")}
            </p>
            <p className="mt-2 font-mono type-meta">
              identidade vem de <code>profile/profile.yaml</code>, para as duas fontes não divergirem
            </p>
          </CardContent>
        </Card>
      )}

      <form
        action={importPdfAction}
        className="mb-8 flex flex-wrap items-end gap-3 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-cloud)] p-4"
      >
        <div className="grid gap-1.5">
          <Label htmlFor="file">Importar de PDF</Label>
          <Input
            id="file"
            name="file"
            type="file"
            accept="application/pdf,.pdf"
            required
            className="max-w-[320px]"
          />
        </div>
        <Button type="submit" variant="outline">
          Extrair texto
        </Button>
        <p className="type-body-sm w-full text-muted-foreground">
          Vira uma versão nova, como qualquer outra —{" "}
          <strong className="text-foreground">revise antes de confiar</strong>. Extração de
          PDF erra com layout em colunas, e currículo digitalizado não tem texto
          nenhum para ler.
        </p>
      </form>

      <form action={saveCvAction} className="mb-8 grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="label">Rótulo desta versão</Label>
          <Input
            id="label"
            name="label"
            placeholder="ATS EN 2026-08"
            defaultValue={doc?.label ?? ""}
            className="max-w-[320px]"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="content">Currículo em markdown</Label>
          <MarkdownEditor name="content" defaultValue={doc?.content ?? ""} />
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit">Salvar versão</Button>
          {doc && (
            <span className="text-xs text-muted-foreground">
              atual: <strong className="text-foreground">{doc.label}</strong> ·{" "}
              {doc.content.length.toLocaleString("pt-BR")} caracteres · salvo em{" "}
              {doc.createdAt.slice(0, 10)}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Upload de PDF ainda não existe. Quando existir, o texto extraído entra
          aqui e o arquivo original fica recuperável — o schema já prevê
          (<code className="font-mono">format</code>,{" "}
          <code className="font-mono">source_filename</code>).
        </p>
      </form>

      {gap && (
        <>
          <Separator className="my-8" />
          <section>
            <h2 className="type-display-sm mb-2">
              O que as vagas dizem e o seu CV não
            </h2>
            <p className="mb-5 text-sm text-muted-foreground">
              Comparado com {gap.jobsAnalysed} vagas acima de {gap.minFit} de
              aderência. Só entram termos que aparecem em pelo menos 10% delas —
              o resto é ruído.
            </p>

            {gap.missing.length === 0 ? (
              <Card className="p-5 text-sm text-muted-foreground">
                Nenhuma lacuna relevante. O vocabulário do CV cobre o que as vagas
                do seu alvo pedem.
              </Card>
            ) : (
              <div className="mb-8 grid gap-2">
                {gap.missing.slice(0, 18).map((t) => (
                  <div
                    key={t.term}
                    className="flex items-center gap-3 rounded-lg border bg-card px-4 py-2.5"
                  >
                    <span className="min-w-0 flex-1 truncate sm:min-w-[190px] sm:flex-none font-mono text-sm">{t.term}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-sm bg-border">
                      <span
                        className="block h-full rounded-sm bg-[var(--color-mid)]"
                        style={{ width: `${Math.round(t.coverage * 100)}%` }}
                      />
                    </div>
                    <span className="shrink-0 text-right font-mono text-xs whitespace-nowrap text-muted-foreground">
                      {Math.round(t.coverage * 100)}%
                      <span className="hidden sm:inline"> das vagas</span>
                    </span>
                  </div>
                ))}
              </div>
            )}

            <details className="mb-6">
              <summary className="cursor-pointer text-sm font-medium">
                Vocabulário que já está funcionando ({gap.confirmed.length})
              </summary>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {gap.confirmed.map((t) => (
                  <Badge key={t.term} variant="secondary" className="font-mono type-meta">
                    {t.term} · {Math.round(t.coverage * 100)}%
                  </Badge>
                ))}
              </div>
            </details>

            {gap.unused.length > 0 && (
              <details>
                <summary className="cursor-pointer text-sm font-medium">
                  No CV, mas raro nas vagas do alvo ({gap.unused.length})
                </summary>
                <p className="mt-2 mb-3 max-w-[62ch] text-xs text-muted-foreground">
                  Não significa remover — significa que esses termos não estão
                  puxando aderência. Se o CV está longo, é aqui que sobra espaço.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {gap.unused.map((t) => (
                    <Badge key={t.term} variant="outline" className="font-mono type-meta">
                      {t.term}
                    </Badge>
                  ))}
                </div>
              </details>
            )}
          </section>
        </>
      )}

      {!gap && (
        <Card className="p-5 text-sm text-muted-foreground">
          A análise de lacunas aparece assim que houver um currículo salvo.
        </Card>
      )}

      {history.length > 1 && (
        <>
          <Separator className="my-8" />
          <section>
            <h2 className="type-display-xs mb-3">Versões</h2>
            <div className="divide-y overflow-hidden rounded-xl border">
              {history.map((h) => (
                <div key={h.id} className="flex items-center gap-3 bg-card px-4 py-2.5 text-sm">
                  {h.isCurrent ? (
                    <Badge className="type-micro">atual</Badge>
                  ) : (
                    <span className="w-[46px]" />
                  )}
                  <span className="flex-1">{h.label}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {Number(h.length).toLocaleString("pt-BR")} chars
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {h.createdAt.slice(0, 10)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
