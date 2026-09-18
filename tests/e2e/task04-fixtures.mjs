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
  referralContactId: 903000000,
  referralCompany: "Task 04 Typical Lab",
});
