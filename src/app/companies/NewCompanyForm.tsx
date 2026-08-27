"use client";

import { useActionState } from "react";
import { createCompanyAction, type FormState } from "@/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";

const initial: FormState = {};

export function NewCompanyForm() {
  const [state, action] = useActionState(createCompanyAction, initial);
  return (
    <form action={action}>
      {state.error && <div className="alert alert-error">{state.error}</div>}
      <label className="field">
        <span>Company name</span>
        <input type="text" name="name" required placeholder="Acme Retail" />
      </label>
      <SubmitButton pendingLabel="Creating…">Create company</SubmitButton>
    </form>
  );
}
