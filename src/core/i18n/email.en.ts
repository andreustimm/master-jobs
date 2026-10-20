import type { emailPtBR } from "./email.pt-BR.ts";
import type { Translated } from "./shape.ts";

/**
 * Account e-mails.
 *
 * Part of the `en.ts` dictionary; typed against `email.pt-BR.ts`, so a missing key is a
 * compile error.
 */
export const emailEn: Translated<typeof emailPtBR> = {
  email: {
    signature: "— Master Jobs",
    providerGoogle: "Google",
    providerLinkedin: "LinkedIn",
    codeSubject: "Your Master Jobs confirmation code",
    codeIntro: "Use this code to confirm your Master Jobs sign-up:",
    codeExpiry: "The code is valid for {minutes} minutes and works only once.",
    codeIgnore:
      "If you did not ask for it, ignore this email: no account is created without the code.",
    welcomeSubject: "Welcome to Master Jobs",
    welcomeIntro: "Your Master Jobs account is ready.",
    welcomeCandidate:
      "Your candidate profile already has the CV you sent. Jobs are now scored against it.",
    welcomeRecruiter:
      "Your recruiter account starts with no candidates: candidates on Master Jobs are the ones who grant access to their own profile.",
    welcomeSignIn: "To sign in: {url}",
    existsSubject: "Sign-up attempt on Master Jobs",
    existsIntro:
      "Someone tried to create a Master Jobs account with this email, but it already has an account.",
    existsSignIn: "To sign in: {url}",
    existsRecover: "Forgot your password? Recover access at: {url}",
    existsIgnore: "If it was not you, ignore this email: nothing changed in your account.",
    linkedSubject: "{provider} was connected to your Master Jobs account",
    unlinkedSubject: "{provider} was disconnected from your Master Jobs account",
    linkedBody: "Sign-in with {provider} was connected to your account on {at} (UTC), {actor}.",
    unlinkedBody: "Sign-in with {provider} was disconnected from your account on {at} (UTC), {actor}.",
    actorSelf: "by you, on the account page",
    actorAutomatic: "automatically, on your first sign-in with {provider}",
    actorAdmin: "by an administrator",
    noticeIgnore:
      "If you do not recognize this change, recover your password and write to contato@mastertimm.com.br.",
    recoverySubject: "Recover access to Master Jobs",
    recoveryIntro: "Someone asked to recover the password of this account.",
    recoveryExpiry: "The link is valid for {minutes} minutes and works only once.",
    recoveryIgnore: "If it was not you, ignore this email: nothing changes unless the link is used.",
    recruiterScope:
      "With access you see {candidate}'s funnel (read-only) and current CV as uploaded, and you can suggest jobs. Notes, salary floor, profile contacts and private analyses are never shared.",
    recruiterInviteSubject: "{candidate} invited you to follow their job search on Master Jobs",
    recruiterInviteIntro: "{candidate} wants to share their job search with you on Master Jobs.",
    recruiterInviteValidity: "The link is valid until {date} (UTC) and works once:",
    recruiterInviteSameEmail:
      "Create your account or sign in with this same email address that received the invitation. With any other address, access is not granted.",
    recruiterInviteNeedsRecruiter: "Access requires a recruiter account.",
    recruiterInviteIgnore: "If you do not know {candidate}, ignore this email: nothing is shared without the sign-up.",
    recruiterGrantedSubject: "{candidate} gave you access on Master Jobs",
    recruiterGrantedIntro: "{candidate} gave you access to their profile on Master Jobs.",
    recruiterNoEnd: "No end date: the access lasts until the candidate revokes it.",
    recruiterEndsAt: "The access ends on {date} ({tz}).",
    recruiterOpenLink: "To open it: {url}",
    recruiterEndChangedSubject: "{candidate} changed the end date of your access on Master Jobs",
    recruiterEndChangedIntro: "{candidate} changed the end date of your access.",
    recruiterNoLongerEnds: "The access no longer ends on a date.",
    recruiterEndedSubject: "Your access to {candidate}'s profile has ended",
    recruiterEndedByCandidate: "{candidate} ended your access to their profile on Master Jobs.",
    recruiterEndedByAdmin: "Your access to {candidate}'s profile was ended by the service administration.",
    recruiterEndedExpired: "The access period for {candidate}'s profile ended.",
    recruiterEndedAfter: "The jobs you suggested stay with the candidate.",
    recruiterDigestSubject: "{recruiter} suggested jobs for you",
    recruiterDigestIntro: "{recruiter} suggested {count} job(s) for you on Master Jobs:",
    recruiterDigestItem: "• {title} — {company}",
    recruiterDigestDecide: "Accept or decline them at: {url}",
    recruiterDigestFunnel: "Nothing enters your funnel unless you accept it.",
  },
};
