import {
  CODE_MAX_ATTEMPTS,
  MIN_LENGTH,
  RESEND_SECONDS,
  type SignupError,
} from "../../src/contexts/auth/index.ts";
import { CV_MIN, CV_PDF_MAX_MB, HEADLINE_MAX, NAME_MAX } from "../../src/core/candidate-identity.ts";
import type { Translator } from "../../src/core/i18n/index.ts";

/** Os limites de verdade, que as mensagens citam. */
export const signupLimits = {
  cvMin: CV_MIN,
  pdfMaxMb: CV_PDF_MAX_MB,
  nameMax: NAME_MAX,
  headlineMax: HEADLINE_MAX,
  passwordMin: MIN_LENGTH,
  codeMaxAttempts: CODE_MAX_ATTEMPTS,
  resendSeconds: RESEND_SECONDS,
};

/**
 * A mensagem de cada recusa do cadastro, já com os limites de verdade.
 *
 * `Record` sobre a união inteira: código novo sem mensagem é erro de
 * compilação, não texto genérico descoberto por quem se cadastra. As recusas
 * de nome, headline e PDF são as do onboarding — a mesma regra, a mesma frase.
 */
export function signupMessages(
  t: Translator["t"],
  limits: {
    cvMin: number;
    pdfMaxMb: number;
    nameMax: number;
    headlineMax: number;
    passwordMin: number;
    codeMaxAttempts: number;
    resendSeconds: number;
  },
): Record<SignupError | "rate_limited" | "generic", string> {
  return {
    invalid_email: t("signup.errorEmail"),
    weak_password: t("signup.errorPassword", { min: limits.passwordMin }),
    role_invalid: t("signup.errorRole"),
    terms_required: t("signup.errorTerms"),
    name_required: t("onboarding.nameRequired"),
    name_too_long: t("onboarding.nameTooLong", { max: limits.nameMax }),
    name_contact: t("onboarding.nameContact"),
    headline_too_long: t("onboarding.headlineTooLong", { max: limits.headlineMax }),
    cv_required: t("signup.errorCvRequired"),
    cv_too_short: t("signup.errorCvTooShort", { min: limits.cvMin }),
    cv_both: t("onboarding.cvBoth"),
    pdf_missing: t("onboarding.pdfMissing"),
    pdf_too_large: t("onboarding.pdfTooLarge", { max: limits.pdfMaxMb }),
    pdf_not_pdf: t("onboarding.pdfNotPdf"),
    pdf_no_text: t("onboarding.pdfNoText"),
    too_many_codes: t("signup.errorTooManyCodes"),
    // O reenvio mostra a espera com os segundos; aqui é só o fallback.
    resend_wait: t("signup.verifyResendWait", { seconds: limits.resendSeconds }),
    ip_cap: t("signup.errorIpCap"),
    expired: t("signup.errorExpired"),
    // A tela de código troca `{count}` pelo número que a ação devolveu.
    wrong_code: t("signup.verifyWrong", { count: "{count}" }),
    code_locked: t("signup.verifyLocked", { max: limits.codeMaxAttempts }),
    unavailable_here: t("signup.errorUnavailable"),
    email_taken: t("signup.errorEmailTaken"),
    rate_limited: t("signup.errorRateLimited"),
    generic: t("feedback.error"),
  };
}
