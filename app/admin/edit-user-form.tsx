"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { CircleAlert, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { Role, UserSummary } from "../../src/contexts/auth/index.ts";
import { updateUserAction } from "./actions";
import {
  EDITABLE_ROLES,
  INITIAL_USER_EDIT_STATE,
  type UserEditActionState,
  type UserEditErrorCode,
} from "./user-edit-state";
import { USER_MODAL_BOX } from "./user-modal-styles";

export type UserEditLabels = {
  title: string;
  close: string;
  email: string;
  fullName: string;
  fullNameHint: string;
  roles: string;
  roleLabels: Record<Role, string>;
  cancel: string;
  save: string;
  saving: string;
  success: string;
  dismissNotification: string;
  errors: Record<UserEditErrorCode, string>;
};

const USER_EDIT_SAVED_EVENT = "master-jobs:user-edit-saved";

export function EditUserForm({
  user,
  labels,
}: {
  user: UserSummary;
  labels: UserEditLabels;
}) {
  const id = `user-edit-${user.id}`;
  const [error, setError] = useState<UserEditErrorCode | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [closedError, setClosedError] = useState<UserEditErrorCode | null>(null);
  const [draftFullName, setDraftFullName] = useState(user.fullName ?? "");
  const [draftEmail, setDraftEmail] = useState(user.email);
  const [draftRoles, setDraftRoles] = useState<Role[]>(user.roles);
  const isOpen = useRef(false);
  const openGeneration = useRef(0);

  function resetDraft() {
    setDraftFullName(user.fullName ?? "");
    setDraftEmail(user.email);
    setDraftRoles(user.roles);
  }

  useEffect(() => {
    function selectNotice(event: Event) {
      const savedUserId = (event as CustomEvent<number>).detail;
      setShowSuccess(savedUserId === user.id);
      setClosedError(null);
    }

    window.addEventListener(USER_EDIT_SAVED_EVENT, selectNotice);
    return () => window.removeEventListener(USER_EDIT_SAVED_EVENT, selectNotice);
  }, [user.id]);

  useEffect(() => {
    if (!isOpen.current) {
      setDraftFullName(user.fullName ?? "");
      setDraftEmail(user.email);
      setDraftRoles(user.roles);
    }
  }, [id, user.email, user.fullName, user.roles]);

  const [, formAction, pending] = useActionState(
    async (previousState: UserEditActionState, formData: FormData) => {
      setError(null);
      setClosedError(null);
      window.dispatchEvent(new CustomEvent(USER_EDIT_SAVED_EVENT, { detail: -1 }));
      const submittedOpenGeneration = openGeneration.current;
      const result = await updateUserAction(previousState, formData);
      const belongsToCurrentOpening =
        openGeneration.current === submittedOpenGeneration;
      const popover = document.getElementById(id);
      const popoverIsOpen = popover?.matches(":popover-open") ?? false;

      if (result.status === "error" && belongsToCurrentOpening) {
        if (popoverIsOpen) {
          setError(result.code);
        } else {
          window.dispatchEvent(new CustomEvent(USER_EDIT_SAVED_EVENT, { detail: -1 }));
          setClosedError(result.code);
        }
      } else if (result.status === "success") {
        if (popover && popoverIsOpen && belongsToCurrentOpening) {
          popover.hidePopover();
        }
        // Uma única notificação por página: cada formulário escuta o mesmo
        // evento e só a conta recém-salva permanece visível.
        window.dispatchEvent(new CustomEvent(USER_EDIT_SAVED_EVENT, { detail: user.id }));
      }

      return result;
    },
    INITIAL_USER_EDIT_STATE,
  );

  function clearModalFeedback() {
    setError(null);
    setClosedError(null);
  }

  const noticeMessage = showSuccess
    ? labels.success
    : closedError
      ? labels.errors[closedError]
      : null;
  const noticeIsError = closedError !== null;

  return (
    <>
      {noticeMessage && (
        <div
          data-testid="user-edit-notice"
          role={noticeIsError ? "alert" : "status"}
          aria-live={noticeIsError ? "assertive" : "polite"}
          style={{
            top: "max(var(--spacing-md), env(safe-area-inset-top))",
            right: "max(var(--spacing-md), env(safe-area-inset-right))",
            width:
              "min(calc(100vw - max(var(--spacing-md), env(safe-area-inset-left)) - max(var(--spacing-md), env(safe-area-inset-right))), 24rem)",
          }}
          className={cn(
            "fixed z-50 flex items-start gap-3",
            "rounded-xl border bg-card px-4 py-3 text-card-foreground shadow-lg",
            noticeIsError ? "border-[var(--bad)]" : "border-[var(--good)]",
          )}
        >
          {noticeIsError ? (
            <CircleAlert aria-hidden="true" className="mt-1 size-5 shrink-0 text-destructive" />
          ) : (
            <CheckCircle2 aria-hidden="true" className="mt-1 size-5 shrink-0 text-[var(--good)]" />
          )}
          <p className="type-body-sm min-w-0 flex-1">{noticeMessage}</p>
          <button
            type="button"
            data-testid="user-edit-notice-dismiss"
            aria-label={labels.dismissNotification}
            onClick={() => {
              setShowSuccess(false);
              setClosedError(null);
            }}
            className={cn(
              "inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-action)]",
              "text-muted-foreground hover:bg-muted hover:text-foreground",
              "focus-visible:outline-2 focus-visible:outline-[var(--primary-text)]",
            )}
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
      )}

      <div
        id={id}
        popover="auto"
        className={USER_MODAL_BOX}
        onToggle={(event) => {
          clearModalFeedback();
          const opened = event.currentTarget.matches(":popover-open");
          isOpen.current = opened;
          if (opened) {
            openGeneration.current += 1;
          } else {
            resetDraft();
          }
        }}
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--hairline)] bg-card px-5 py-6">
          <div className="min-w-0">
            <h2 className="type-display-xs leading-tight">{labels.title}</h2>
            <p data-user-content className="type-caption-sm mt-1 truncate text-muted-foreground">
              {user.email}
            </p>
          </div>
          <button
            type="button"
            popoverTarget={id}
            popoverTargetAction="hide"
            aria-label={labels.close}
            data-testid="user-edit-close"
            onClick={clearModalFeedback}
            className={cn(
              "inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-action)]",
              "text-muted-foreground hover:bg-muted hover:text-foreground",
              "focus-visible:outline-2 focus-visible:outline-[var(--primary-text)]",
            )}
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </header>

        <form
          action={formAction}
          onReset={(event) => {
            // O React reseta o form quando uma Server Action termina. Uma
            // resposta antiga não pode apagar o rascunho de uma nova abertura.
            event.preventDefault();
          }}
          className="grid gap-4 px-5 py-6"
        >
          <input type="hidden" name="userId" value={user.id} />

          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-name`}>{labels.fullName}</Label>
            <Input
              id={`${id}-name`}
              name="fullName"
              type="text"
              maxLength={120}
              required
              autoComplete="off"
              value={draftFullName}
              onChange={(event) => setDraftFullName(event.target.value)}
            />
            <p className="type-meta text-muted-foreground">{labels.fullNameHint}</p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-email`}>{labels.email}</Label>
            <Input
              id={`${id}-email`}
              name="email"
              type="email"
              required
              autoComplete="off"
              value={draftEmail}
              onChange={(event) => setDraftEmail(event.target.value)}
            />
          </div>

          <fieldset>
            <legend className="type-micro mb-1.5 text-muted-foreground">{labels.roles}</legend>
            <div className="flex flex-wrap gap-3">
              {EDITABLE_ROLES.map((role) => (
                <label key={role} className="flex min-h-11 cursor-pointer items-center gap-2 type-caption-sm">
                  <input
                    type="checkbox"
                    name="roles"
                    value={role}
                    checked={draftRoles.includes(role)}
                    onChange={(event) => {
                      setDraftRoles((current) =>
                        event.target.checked
                          ? [...current, role]
                          : current.filter((currentRole) => currentRole !== role),
                      );
                    }}
                    className="cursor-pointer"
                  />
                  {labels.roleLabels[role]}
                </label>
              ))}
            </div>
          </fieldset>

          {error && (
            <p role="alert" aria-live="assertive" className="type-caption-sm text-destructive">
              {labels.errors[error]}
            </p>
          )}

          <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              popoverTarget={id}
              popoverTargetAction="hide"
              onClick={clearModalFeedback}
              className="min-h-11"
              data-testid="user-edit-cancel"
            >
              {labels.cancel}
            </Button>
            <Button type="submit" disabled={pending} className="min-h-11" data-testid="user-edit-submit">
              {pending ? labels.saving : labels.save}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
