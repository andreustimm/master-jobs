import { LegalDocumentPage } from "../legal-document";

export const dynamic = "force-dynamic";

/** Política de Privacidade: pública, sem sessão (US-021). Ver `../legal-document.tsx`. */
export default function PrivacyPage() {
  return <LegalDocumentPage kind="privacy" />;
}
