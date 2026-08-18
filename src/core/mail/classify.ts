/**
 * Classifying a job-related email.
 *
 * Design bias, stated up front: this errs toward `unknown`.
 *
 * A misfired rejection is the expensive error. If the parser decides a live
 * opportunity was rejected and the funnel moves on that, the user stops
 * following up on a process that was still open — and nothing surfaces the
 * mistake, because "no reply" looks identical to "rejected". A missed
 * classification only costs a manual edit. So the rejection rules demand
 * explicit phrasing, and anything ambiguous stays `unknown`.
 *
 * Every classification carries a confidence and the signal that produced it,
 * because the user sees both before accepting a funnel change.
 */
import type { MailKind } from "../db/schema.ts";
import type { ParsedMail } from "./eml.ts";

export type Classification = {
  kind: MailKind;
  provider: string | null;
  confidence: number;
  /** The phrase or sender that decided it — shown to the user. */
  signal: string | null;
};

/* ------------------------------------------------------------ provider -- */

const PROVIDERS: Array<{ test: RegExp; name: string }> = [
  { test: /@(.*\.)?linkedin\.com$/i, name: "linkedin" },
  { test: /@(.*\.)?greenhouse\.io$/i, name: "greenhouse" },
  { test: /@(.*\.)?lever\.co$/i, name: "lever" },
  { test: /@(.*\.)?ashbyhq\.com$/i, name: "ashby" },
  { test: /@(.*\.)?myworkday(jobs)?\.com$/i, name: "workday" },
  { test: /@(.*\.)?smartrecruiters\.com$/i, name: "smartrecruiters" },
  { test: /@(.*\.)?recruitee\.com$/i, name: "recruitee" },
  { test: /@(.*\.)?workable(mail)?\.com$/i, name: "workable" },
  { test: /@(.*\.)?indeed\.com$/i, name: "indeed" },
  { test: /@(.*\.)?himalayas\.app$/i, name: "himalayas" },
  { test: /@(.*\.)?usebraintrust\.com$/i, name: "braintrust" },
  { test: /@(.*\.)?revelo\.com(\.br)?$/i, name: "revelo" },
  { test: /@(.*\.)?bairesdev\.com$/i, name: "bairesdev" },
];

export function detectProvider(address: string | null): string | null {
  if (!address) return null;
  return PROVIDERS.find((p) => p.test.test(address))?.name ?? null;
}

/* --------------------------------------------------------------- rules -- */

type Rule = {
  kind: MailKind;
  confidence: number;
  /** All must match for the rule to fire. */
  all?: RegExp[];
  /** Any one is enough. */
  any?: RegExp[];
  /** None may match — this is what keeps rejection honest. */
  none?: RegExp[];
  label: string;
};

/**
 * Rejection phrasing is remarkably standardised across ATS templates, which is
 * what makes it detectable at all. English and Portuguese both appear in this
 * user's mail.
 */
const REJECTION_PHRASES = [
  /move forward with other candidat/i,
  /decided to (?:move forward|proceed) with (?:other|another)/i,
  /will not be (?:moving|progressing) forward/i,
  /not (?:be )?(?:moving|progressing) (?:you )?forward/i,
  /we (?:have )?decided not to (?:move|proceed|continue)/i,
  /unfortunately,? (?:we|your application|after)/i,
  /no longer under consideration/i,
  /pursue other candidat/i,
  /não (?:iremos|vamos) (?:seguir|prosseguir|continuar)/i,
  /seguiremos com outros candidat/i,
  /infelizmente,? (?:n[ãa]o|sua candidatura|após)/i,
];

const RULES: Rule[] = [
  {
    kind: "job_alert",
    confidence: 0.95,
    any: [
      // No ^ anchor: the address sits in the middle of the haystack
      // (subject + from + body), so anchoring would never match.
      /\bjob-?alerts?-?noreply@/i,
      /\bjobs-(?:noreply|listings|alerts)@/i,
      /\bjobalerts@/i,
      /job alert/i,
      /new jobs? (?:for you|matching)/i,
      /jobs? (?:picked|selected) for you/i,
      /vagas? (?:para voc[êe]|recomendadas)/i,
      /\d+ new (?:jobs?|opportunit)/i,
    ],
    label: "alerta de vagas",
  },
  {
    kind: "ats_rejection",
    confidence: 0.9,
    any: REJECTION_PHRASES,
    // An alert digest can quote the word "unfortunately" in a job description,
    // and an interview invite can mention a prior rejection. Neither is one.
    none: [/job alert/i, /new jobs? for you/i, /schedule (?:your|an) interview/i],
    label: "rejeição",
  },
  {
    kind: "ats_interview",
    confidence: 0.85,
    any: [
      /schedule (?:your|an|a) (?:interview|call|chat|screen)/i,
      /interview (?:invitation|confirmed|scheduled)/i,
      /invit(?:ation|ing you) to interview/i,
      /book a time/i,
      /agendar (?:sua )?entrevista/i,
      /convite para entrevista/i,
    ],
    none: REJECTION_PHRASES,
    label: "entrevista",
  },
  {
    kind: "ats_screening",
    confidence: 0.8,
    any: [
      /(?:technical|coding|online) assessment/i,
      /take-home (?:test|assignment|challenge)/i,
      /complete (?:the |a )?(?:assessment|challenge|test)/i,
      /screening call/i,
      /teste t[ée]cnico/i,
      /desafio t[ée]cnico/i,
    ],
    none: REJECTION_PHRASES,
    label: "triagem/avaliação",
  },
  {
    kind: "ats_offer",
    confidence: 0.85,
    any: [
      /(?:job |employment )?offer letter/i,
      /pleased to (?:offer|extend)/i,
      /we(?:'| a)re excited to offer/i,
      /proposta de (?:trabalho|emprego)/i,
    ],
    none: REJECTION_PHRASES,
    label: "proposta",
  },
  {
    kind: "ats_received",
    confidence: 0.8,
    any: [
      /(?:we|thanks for|thank you for) (?:have )?received your application/i,
      /application (?:has been )?received/i,
      /thank you for (?:applying|your (?:interest|application))/i,
      /recebemos (?:sua|a sua) (?:candidatura|inscri[çc][ãa]o)/i,
      /obrigad[oa] por (?:se candidatar|sua candidatura)/i,
    ],
    none: REJECTION_PHRASES,
    label: "confirmação de recebimento",
  },
  {
    kind: "recruiter_inbound",
    confidence: 0.6,
    any: [
      /came across your (?:profile|background|linkedin)/i,
      /i(?:'| a)m (?:a |an )?(?:technical )?recruiter/i,
      /would you be (?:open|interested) (?:to|in)/i,
      /reaching out (?:about|regarding) (?:a|an) (?:role|opportunit|position)/i,
      /vi seu perfil/i,
      /oportunidade que pode te interessar/i,
    ],
    none: REJECTION_PHRASES,
    label: "contato de recrutador",
  },
];

/* ------------------------------------------------------------ classify -- */

export function classify(mail: ParsedMail, bodyText: string): Classification {
  const provider = detectProvider(mail.from.address);
  // Subject carries the strongest signal; body confirms. Cap the body so a
  // long digest cannot bury the decision under quoted job descriptions.
  const haystack = `${mail.subject ?? ""}\n${mail.from.address ?? ""}\n${bodyText.slice(0, 6000)}`;

  for (const rule of RULES) {
    if (rule.none?.some((r) => r.test(haystack))) continue;
    if (rule.all && !rule.all.every((r) => r.test(haystack))) continue;

    const hit = rule.any?.find((r) => r.test(haystack));
    if (rule.any && !hit) continue;

    // A known ATS sender makes any classification more trustworthy.
    const confidence = Math.min(1, rule.confidence + (provider ? 0.05 : 0));
    return {
      kind: rule.kind,
      provider,
      confidence: Math.round(confidence * 100) / 100,
      signal: `${rule.label}: ${hit?.source ?? "regra"}`,
    };
  }

  return { kind: "unknown", provider, confidence: 0, signal: null };
}
