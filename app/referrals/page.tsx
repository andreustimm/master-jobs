import Link from "next/link";
import { companiesWithContacts, referralOpportunities } from "../../src/core/contacts.ts";
import { Chip, Fit } from "../ui";

export const dynamic = "force-dynamic";

export default async function Referrals() {
  const [opps, network] = await Promise.all([
    referralOpportunities(40),
    companiesWithContacts(),
  ]);

  return (
    <main style={{ paddingTop: 40 }}>
      <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.02em", margin: "0 0 8px" }}>
        Referrals
      </h1>
      <p style={{ color: "var(--text-2)", maxWidth: "62ch", margin: "0 0 28px" }}>
        Vagas abertas onde você já conhece alguém. Referrals são ~7% dos
        candidatos e ~40% das contratações — nenhuma outra alavanca do sistema
        chega perto.
      </p>

      {opps.length === 0 ? (
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: 24,
          }}
        >
          <p style={{ margin: 0, color: "var(--text-2)" }}>
            {network.size === 0 ? (
              <>
                Nenhum contato registrado. Comece com{" "}
                <code className="mono">pnpm jho contacts seed</code>, que carrega
                as empresas onde você já trabalhou.
              </>
            ) : (
              <>
                <strong>{network.size} empresa(s)</strong> na sua rede, nenhuma
                com vaga aberta no acervo hoje. Isso é uma resposta, não um erro
                — quando abrir, aparece aqui.
              </>
            )}
          </p>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 1,
            background: "var(--line)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          {opps.map((o) => (
            <div
              key={o.jobId}
              style={{
                background: "var(--surface)",
                display: "grid",
                gridTemplateColumns: "56px 1fr auto",
                gap: 16,
                alignItems: "center",
                padding: "14px 18px",
              }}
            >
              <div style={{ textAlign: "center" }}>
                <Fit value={o.fit} />
              </div>
              <div>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <Link
                    href={`/jobs/${o.jobId}`}
                    style={{ fontWeight: 600, color: "var(--text)", textDecoration: "none" }}
                  >
                    {o.title}
                  </Link>
                  {o.status && <Chip>{o.status}</Chip>}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 3 }}>
                  {o.companyName}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--color-strong)", marginTop: 4 }}>
                  via {o.contacts.join(", ")}
                </div>
              </div>
              <a
                className="mono"
                href={o.applyUrl ?? o.url}
                target="_blank"
                rel="noopener"
                style={{ fontSize: 12, color: "var(--accent)", whiteSpace: "nowrap" }}
              >
                aplicar →
              </a>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
