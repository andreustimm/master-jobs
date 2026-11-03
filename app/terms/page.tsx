import { LegalDocumentPage } from "../legal-document";

export const dynamic = "force-dynamic";

/** Termos de Uso: públicos, sem sessão (US-021). Ver `../legal-document.tsx`. */
export default function TermsPage() {
  return <LegalDocumentPage kind="terms" />;
}
