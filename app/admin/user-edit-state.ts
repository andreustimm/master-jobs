import type { Role } from "../../src/contexts/auth/index.ts";

export const EDITABLE_ROLES = ["admin", "candidate", "recruiter"] as const satisfies readonly Role[];

type Assert<T extends true> = T;
/** Falha no typecheck se o domínio ganhar um papel que a modal não oferece. */
export type EditableRolesCoverDomain = Assert<
  Exclude<Role, (typeof EDITABLE_ROLES)[number]> extends never ? true : false
>;

export type UserEditErrorCode =
  | "invalidEmail"
  | "nameRequired"
  | "rolesRequired"
  | "lastAdmin"
  | "unexpected";

export type UserEditActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; code: UserEditErrorCode };

export const INITIAL_USER_EDIT_STATE: UserEditActionState = { status: "idle" };
