import type { pipelinePtBR } from "./pipeline.pt-BR.ts";
import type { Translated } from "./shape.ts";

/**
 * Application pipeline: stages, channels and referrals.
 *
 * Part of the `en.ts` dictionary; typed against `pipeline.pt-BR.ts`, so a missing key is a
 * compile error.
 */
export const pipelineEn: Translated<typeof pipelinePtBR> = {
  channels: {
    direct: "direct",
    ats: "ATS",
    referral: "referral",
    recruiter: "recruiter",
    agency: "agency",
  },
  pipeline: {
    title: "Pipeline",
    open: "open",
    noApplications: "Nothing in the pipeline yet.",
    startWith: "Start with the",
    jobsList: "job list",
    appliedOn: "applied on {date}",
    nextAction: "next: {action}",
    jobClosed: "job closed",
    jobArchived: "job archived",
    allStages: "all",
    unknownStage: "Unknown stage; showing the whole pipeline.",
    noneInStage: "No applications in this stage.",
    broaden: "broaden search",
    broadenHint:
      "Also finds Portuguese and English synonyms and titles with similar spelling. It does not understand the meaning of a sentence yet.",
    broadenHintSpelling: "Also finds titles with similar spelling. It does not understand the meaning of a sentence yet.",
    companyAll: "all companies",
    channel: "channel",
    channelAll: "all channels",
    noneMatching: "No applications match these filters.",
    clearFilters: "clear filters",
    suggestedByRecruiter: "suggested by a recruiter",
  },
  referrals: {
    title: "Referrals",
    companies: "company/companies",
    via: "via",
  },
};
