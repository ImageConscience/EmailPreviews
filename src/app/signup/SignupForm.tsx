"use client";

import { useActionState } from "react";
import { signupAction, type FormState } from "@/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";

const initial: FormState = {};

export function SignupForm({
  inviteToken,
  inviteCompany,
  inviteEmail,
}: {
  inviteToken?: string;
  inviteCompany?: string;
  inviteEmail?: string;
}) {
  const [state, action] = useActionState(signupAction, initial);

  return (
    <form action={action}>
      {state.error && <div className="alert alert-error">{state.error}</div>}
      {inviteToken && <input type="hidden" name="inviteToken" value={inviteToken} />}

      <label className="field">
        <span>Your name</span>
        <input type="text" name="name" autoComplete="name" required autoFocus />
      </label>
      <label className="field">
        <span>Email</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          defaultValue={inviteEmail}
          readOnly={Boolean(inviteEmail)}
        />
        {inviteEmail && <span className="hint">Your invitation was sent to this address.</span>}
      </label>
      <label className="field">
        <span>Password</span>
        <input type="password" name="password" autoComplete="new-password" required minLength={8} />
        <span className="hint">At least 8 characters.</span>
      </label>

      {inviteToken ? (
        <div className="alert alert-ok">You will join {inviteCompany} as a collaborator.</div>
      ) : (
        <label className="field">
          <span>Company name</span>
          <input type="text" name="companyName" required placeholder="Acme Retail" />
          <span className="hint">
            The store your templates and content sheets belong to. You can invite teammates later.
          </span>
        </label>
      )}

      <SubmitButton pendingLabel="Creating account…">Create account</SubmitButton>
    </form>
  );
}
