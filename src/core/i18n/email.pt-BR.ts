/**
 * E-mails da conta.
 *
 * Parte do dicionário de `pt-BR.ts`; o par em inglês é `email.en.ts`.
 */
export const emailPtBR = {
  /**
   * E-mails da conta (#464, ADR-011). Texto puro, uma ação por mensagem. Montados
   * pelos construtores `account-emails.ts` do contexto auth; nunca levam token
   * de provedor, dado de perfil nem dado de outra pessoa.
   */
  email: {
    signature: "— Master Jobs",
    providerGoogle: "Google",
    providerLinkedin: "LinkedIn",
    codeSubject: "Seu código de confirmação do Master Jobs",
    codeIntro: "Use este código para confirmar o seu cadastro no Master Jobs:",
    codeExpiry: "O código vale {minutes} minutos e serve uma vez só.",
    codeIgnore:
      "Se não foi você quem pediu, ignore este e-mail: nenhuma conta é criada sem o código.",
    welcomeSubject: "Boas-vindas ao Master Jobs",
    welcomeIntro: "Sua conta no Master Jobs está pronta.",
    welcomeCandidate:
      "Seu perfil de candidato já tem o currículo que você enviou. As vagas passam a ser pontuadas contra ele.",
    welcomeRecruiter:
      "Sua conta de recrutador começa sem candidatos: quem é candidato no Master Jobs é quem concede acesso ao próprio perfil.",
    welcomeSignIn: "Para entrar: {url}",
    existsSubject: "Tentativa de cadastro no Master Jobs",
    existsIntro:
      "Alguém tentou criar uma conta no Master Jobs com este e-mail, mas ele já tem uma conta.",
    existsSignIn: "Para entrar: {url}",
    existsRecover: "Esqueceu a senha? Recupere o acesso em: {url}",
    existsIgnore: "Se não foi você, ignore este e-mail: nada mudou na sua conta.",
    linkedSubject: "{provider} foi ligado à sua conta do Master Jobs",
    unlinkedSubject: "{provider} foi desligado da sua conta do Master Jobs",
    linkedBody: "O login com {provider} foi ligado à sua conta em {at} (UTC), {actor}.",
    unlinkedBody: "O login com {provider} foi desligado da sua conta em {at} (UTC), {actor}.",
    actorSelf: "por você, na tela da conta",
    actorAutomatic: "automaticamente, no seu primeiro login com {provider}",
    actorAdmin: "por um administrador",
    noticeIgnore:
      "Se não reconhece esta alteração, recupere a senha e escreva para contato@mastertimm.com.br.",
    recoverySubject: "Recuperar o acesso ao Master Jobs",
    recoveryIntro: "Alguém pediu para recuperar a senha desta conta.",
    recoveryExpiry: "O link vale {minutes} minutos e serve uma vez só.",
    recoveryIgnore: "Se não foi você, ignore: nada muda enquanto o link não for usado.",
    // Acesso do recrutador (#465). Montados por `recruiter-emails.ts`; nunca
    // levam currículo, funil, notas, piso salarial nem contato do perfil.
    recruiterScope:
      "Com o acesso você vê o funil de {candidate} (só leitura), o currículo atual como foi enviado e pode sugerir vagas. Notas, piso salarial, contatos do perfil e análises privadas nunca são compartilhados.",
    recruiterInviteSubject: "{candidate} convidou você para acompanhar a busca no Master Jobs",
    recruiterInviteIntro: "{candidate} quer compartilhar a busca de emprego com você no Master Jobs.",
    recruiterInviteValidity: "O link vale até {date} (UTC) e serve uma vez só:",
    recruiterInviteSameEmail:
      "Crie a conta ou entre com este mesmo e-mail que recebeu o convite. Com outro endereço, o acesso não é liberado.",
    recruiterInviteNeedsRecruiter: "O acesso exige uma conta de recrutador.",
    recruiterInviteIgnore: "Se não conhece {candidate}, ignore este e-mail: nada é liberado sem o cadastro.",
    recruiterGrantedSubject: "{candidate} deu acesso a você no Master Jobs",
    recruiterGrantedIntro: "{candidate} deu a você acesso ao perfil no Master Jobs.",
    recruiterNoEnd: "Sem data de fim: o acesso vale até a pessoa candidata revogar.",
    recruiterEndsAt: "O acesso termina em {date} ({tz}).",
    recruiterOpenLink: "Para abrir: {url}",
    recruiterEndChangedSubject: "{candidate} mudou o prazo do seu acesso no Master Jobs",
    recruiterEndChangedIntro: "{candidate} mudou a data de fim do seu acesso.",
    recruiterNoLongerEnds: "O acesso não termina mais em uma data.",
    recruiterEndedSubject: "Seu acesso ao perfil de {candidate} terminou",
    recruiterEndedByCandidate: "{candidate} encerrou o seu acesso ao perfil no Master Jobs.",
    recruiterEndedByAdmin: "O seu acesso ao perfil de {candidate} foi encerrado pela administração do serviço.",
    recruiterEndedExpired: "O período de acesso ao perfil de {candidate} terminou.",
    recruiterEndedAfter: "As vagas que você sugeriu continuam com a pessoa candidata.",
    recruiterDigestSubject: "{recruiter} sugeriu vagas para você",
    recruiterDigestIntro: "{recruiter} sugeriu {count} vaga(s) para você no Master Jobs:",
    recruiterDigestItem: "• {title} — {company}",
    recruiterDigestDecide: "Aceite ou recuse em: {url}",
    recruiterDigestFunnel: "Nada entra no seu funil sem você aceitar.",
  },
} as const;
