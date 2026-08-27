"use client";

import { useActionState } from "react";
import { loginAction, type FormState } from "@/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";

const initial: FormState = {};

export function LoginForm() {
  const [state, action] = useActionState(loginAction, initial);

  return (
    <form action={action}>
      {state.error && <div className="alert alert-error">{state.error}</div>}
      <label className="field">
        <span>Email</span>
        <input type="email" name="email" autoComplete="email" required autoFocus />
      </label>
      <label className="field">
        <span>Password</span>
        <input type="password" name="password" autoComplete="current-password" required />
      </label>
      <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
