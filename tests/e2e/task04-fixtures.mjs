export const TASK04_FIXTURES = Object.freeze({
  resetExpiredToken: "task04-reset-expired",
  resetConsumedToken: "task04-reset-consumed",
  resetRaceToken: "task04-reset-race",
  loginExpiredToken: "task04-login-expired",
  loginRaceToken: "task04-login-race",
  closedJobId: 900000004,
  deletedJobId: 900000005,
  /**
   * Vaga exclusiva do funil. Mover status é irreversível quando o destino é
   * terminal, então este cenário não pode emprestar uma vaga que outra
   * verificação lê depois.
   */
  funnelJobId: 900000006,
  /**
   * Vaga já arquivada com candidatura: prova que o histórico sobrevive ao fim
   * do anúncio. Separada da vaga do funil porque esta nunca muda de estágio.
   */
  archivedJobId: 900000007,
  referralContactId: 903000000,
  referralCompany: "Task 04 Typical Lab",
});
