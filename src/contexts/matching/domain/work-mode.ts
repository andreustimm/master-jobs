export const WORK_MODES = ["remote", "hybrid", "onsite"] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const WORK_MODE_ALIASES: Record<WorkMode, readonly string[]> = {
  remote: ["remote", "remoto", "fully remote", "remote-first", "remote first", "telecommute"],
  hybrid: ["hybrid", "híbrido", "hibrido", "híbrida", "hibrida"],
  onsite: ["onsite", "on-site", "on site", "presencial"],
};

export function readWorkMode(value: string | undefined): WorkMode | undefined {
  return WORK_MODES.find((mode) => mode === value);
}
